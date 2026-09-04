import time
import uuid
import jwt as pyjwt
import pytest
from datetime import datetime, timezone
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, MagicMock, patch
from app.main import app
from app.core.config import settings
from app.db.session import get_db
from app.db.models import Subscription

TEST_USER_ID = "00000000-0000-0000-0000-000000000001"


def credit_sub_result(credits=9999):
    """A MagicMock execute-result yielding a well-funded subscription, so
    spend_credits() in POST /cover-letters passes without touching a real DB."""
    r = MagicMock()
    r.scalar_one_or_none.return_value = Subscription(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), plan="premium", status="active",
        credits_remaining=credits, credits_allotment=credits, current_period_end=None,
    )
    return r


def make_auth_header():
    payload = {
        "sub": TEST_USER_ID,
        "email": "test@test.com",
        "aud": "authenticated",
        "exp": int(time.time()) + 3600,
    }
    token = pyjwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def make_mock_db():
    mock_session = MagicMock()
    mock_session.execute = AsyncMock()
    mock_session.commit = AsyncMock()
    mock_session.refresh = AsyncMock()
    mock_session.flush = AsyncMock()
    mock_session.add = MagicMock()
    mock_session.delete = AsyncMock()

    async def _override():
        yield mock_session

    return _override, mock_session


@pytest.mark.asyncio
async def test_generate_creates_pending_row_and_returns_202():
    from app.db.models import Resume, JobDescription

    override, mock_session = make_mock_db()
    resume = Resume(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), title="R", content={}, template_id="ats_clean",
    )
    jd = JobDescription(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), title="Backend Engineer", raw_text="...", parsed={},
    )
    resume_result = MagicMock()
    resume_result.scalar_one_or_none.return_value = resume
    jd_result = MagicMock()
    jd_result.scalar_one_or_none.return_value = jd
    mock_session.execute = AsyncMock(side_effect=[resume_result, jd_result, credit_sub_result()])

    async def fake_refresh(obj):
        obj.id = obj.id or uuid.uuid4()
        obj.created_at = datetime.now(timezone.utc)

    mock_session.refresh = fake_refresh

    # ASGITransport runs BackgroundTasks synchronously, so
    # _run_cover_letter_background actually executes during this request and
    # opens its own AsyncSessionLocal() — fake it out the same way the
    # neighboring background-task tests do, or it'll hit a real DB.
    bg_session = MagicMock()
    bg_result = MagicMock()
    bg_result.scalar_one_or_none.return_value = None
    bg_session.execute = AsyncMock(return_value=bg_result)
    bg_session.commit = AsyncMock()
    bg_session.flush = AsyncMock()
    bg_session.add = MagicMock()

    class _FakeSessionContextManager:
        async def __aenter__(self):
            return bg_session

        async def __aexit__(self, *exc_info):
            return False

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.cover_letters.get_ai_provider", return_value=AsyncMock()), patch(
            "app.routers.cover_letters.AsyncSessionLocal", new=lambda: _FakeSessionContextManager()
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(
                    "/cover-letters",
                    json={"resume_id": str(resume.id), "jd_id": str(jd.id)},
                    headers=make_auth_header(),
                )
        assert r.status_code == 202
        body = r.json()
        assert body["status"] == "pending"
        assert "cover_letter_id" in body
        mock_session.add.assert_called_once()
        added = mock_session.add.call_args.args[0]
        assert added.status == "pending"
        assert added.resume_id == resume.id
        assert added.jd_id == jd.id
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_generate_deducts_three_credits():
    from app.db.models import Resume, JobDescription

    override, mock_session = make_mock_db()
    resume = Resume(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), title="R", content={}, template_id="ats_clean",
    )
    jd = JobDescription(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), title="Backend Engineer", raw_text="...", parsed={},
    )
    resume_result = MagicMock()
    resume_result.scalar_one_or_none.return_value = resume
    jd_result = MagicMock()
    jd_result.scalar_one_or_none.return_value = jd
    sub_result = credit_sub_result(credits=50)
    sub = sub_result.scalar_one_or_none()
    mock_session.execute = AsyncMock(side_effect=[resume_result, jd_result, sub_result])

    async def fake_refresh(obj):
        obj.id = obj.id or uuid.uuid4()
        obj.created_at = datetime.now(timezone.utc)

    mock_session.refresh = fake_refresh

    bg_session = MagicMock()
    bg_result = MagicMock()
    bg_result.scalar_one_or_none.return_value = None
    bg_session.execute = AsyncMock(return_value=bg_result)
    bg_session.commit = AsyncMock()
    bg_session.flush = AsyncMock()
    bg_session.add = MagicMock()

    class _FakeSessionContextManager:
        async def __aenter__(self):
            return bg_session

        async def __aexit__(self, *exc_info):
            return False

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.cover_letters.get_ai_provider", return_value=AsyncMock()), patch(
            "app.routers.cover_letters.AsyncSessionLocal", new=lambda: _FakeSessionContextManager()
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(
                    "/cover-letters",
                    json={"resume_id": str(resume.id), "jd_id": str(jd.id)},
                    headers=make_auth_header(),
                )
        assert r.status_code == 202
        assert sub.credits_remaining == 47  # cover_letter costs 3
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_generate_refunds_credits_when_pipeline_fails():
    from app.db.models import Resume, JobDescription

    override, mock_session = make_mock_db()
    resume = Resume(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), title="R", content={}, template_id="ats_clean",
    )
    jd = JobDescription(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), title="Backend Engineer", raw_text="...", parsed={},
    )
    resume_result = MagicMock()
    resume_result.scalar_one_or_none.return_value = resume
    jd_result = MagicMock()
    jd_result.scalar_one_or_none.return_value = jd
    sub_result = credit_sub_result(credits=50)
    sub = sub_result.scalar_one_or_none()
    mock_session.execute = AsyncMock(side_effect=[resume_result, jd_result, sub_result])

    async def fake_refresh(obj):
        obj.id = obj.id or uuid.uuid4()
        obj.created_at = datetime.now(timezone.utc)

    mock_session.refresh = fake_refresh

    from app.db.models import CoverLetter

    created_letter = CoverLetter(
        user_id=resume.user_id, resume_id=resume.id, jd_id=jd.id, humanize_level=50, status="pending",
    )

    def fake_add(obj):
        if isinstance(obj, CoverLetter) and obj.id is None:
            obj.id = uuid.uuid4()
            created_letter.id = obj.id

    mock_session.add = MagicMock(side_effect=fake_add)

    refund_sub = Subscription(
        id=uuid.uuid4(), user_id=resume.user_id, plan="premium", status="active",
        credits_remaining=47, credits_allotment=50, current_period_end=None,
    )
    refund_sub_result = MagicMock()
    refund_sub_result.scalar_one_or_none.return_value = refund_sub
    bg_letter_result = MagicMock()
    bg_letter_result.scalar_one_or_none.side_effect = lambda: created_letter
    bg_session = MagicMock()
    bg_session.execute = AsyncMock(side_effect=[bg_letter_result, refund_sub_result])
    bg_session.commit = AsyncMock()
    bg_session.flush = AsyncMock()

    class _FakeSessionContextManager:
        async def __aenter__(self):
            return bg_session

        async def __aexit__(self, *exc_info):
            return False

    pipeline_mock = AsyncMock(side_effect=RuntimeError("LLM provider timed out"))

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.cover_letters.get_ai_provider", return_value=AsyncMock()), patch(
            "app.routers.cover_letters.analyze_jd_match", new=pipeline_mock
        ), patch(
            "app.routers.cover_letters.AsyncSessionLocal", new=lambda: _FakeSessionContextManager()
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(
                    "/cover-letters",
                    json={"resume_id": str(resume.id), "jd_id": str(jd.id)},
                    headers=make_auth_header(),
                )
        assert r.status_code == 202
        assert created_letter.status == "failed"
        assert refund_sub.credits_remaining == 50  # 47 + the 3-credit cost refunded
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_generate_404_when_resume_or_jd_not_owned():
    override, mock_session = make_mock_db()
    empty_result = MagicMock()
    empty_result.scalar_one_or_none.return_value = None
    mock_session.execute = AsyncMock(side_effect=[empty_result, empty_result])

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.post(
                "/cover-letters",
                json={"resume_id": str(uuid.uuid4()), "jd_id": str(uuid.uuid4())},
                headers=make_auth_header(),
            )
        assert r.status_code == 404
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_get_cover_letter_returns_completed_content():
    from app.db.models import CoverLetter

    override, mock_session = make_mock_db()
    letter = CoverLetter(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID),
        resume_id=uuid.uuid4(), jd_id=uuid.uuid4(),
        content="Dear Hiring Manager,...", status="completed",
        humanize_level=50, created_at=datetime.now(timezone.utc),
    )
    result = MagicMock()
    result.scalar_one_or_none.return_value = letter
    mock_session.execute = AsyncMock(return_value=result)

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/cover-letters/{letter.id}", headers=make_auth_header())
        assert r.status_code == 200
        assert r.json()["status"] == "completed"
        assert r.json()["content"] == "Dear Hiring Manager,..."
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_get_cover_letter_404_when_not_found():
    override, mock_session = make_mock_db()
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    mock_session.execute = AsyncMock(return_value=result)

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/cover-letters/{uuid.uuid4()}", headers=make_auth_header())
        assert r.status_code == 404
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_list_cover_letters_returns_only_current_user():
    override, mock_session = make_mock_db()
    result = MagicMock()
    result.scalars.return_value.all.return_value = []
    mock_session.execute = AsyncMock(return_value=result)

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/cover-letters", headers=make_auth_header())
        assert r.status_code == 200
        assert r.json() == []
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_update_cover_letter_saves_edited_content():
    from app.db.models import CoverLetter

    override, mock_session = make_mock_db()
    letter = CoverLetter(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID),
        resume_id=uuid.uuid4(), jd_id=uuid.uuid4(),
        content="old text", status="completed",
        humanize_level=50, created_at=datetime.now(timezone.utc),
    )
    result = MagicMock()
    result.scalar_one_or_none.return_value = letter
    mock_session.execute = AsyncMock(return_value=result)

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.patch(
                f"/cover-letters/{letter.id}",
                json={"content": "edited text"},
                headers=make_auth_header(),
            )
        assert r.status_code == 200
        assert r.json()["content"] == "edited text"
        assert letter.content == "edited text"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_delete_cover_letter():
    from app.db.models import CoverLetter

    override, mock_session = make_mock_db()
    letter = CoverLetter(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID),
        resume_id=uuid.uuid4(), jd_id=uuid.uuid4(),
        created_at=datetime.now(timezone.utc),
    )
    result = MagicMock()
    result.scalar_one_or_none.return_value = letter
    mock_session.execute = AsyncMock(return_value=result)

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.delete(f"/cover-letters/{letter.id}", headers=make_auth_header())
        assert r.status_code == 204
        mock_session.delete.assert_called_once_with(letter)
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_generate_pdf_returns_data_url_and_persists_in_background():
    import base64
    from app.db.models import CoverLetter, Resume

    class _FakeSessionContextManager:
        def __init__(self, session):
            self._session = session

        async def __aenter__(self):
            return self._session

        async def __aexit__(self, *exc_info):
            return False

    override, mock_session = make_mock_db()
    letter = CoverLetter(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID),
        resume_id=uuid.uuid4(), jd_id=uuid.uuid4(),
        content="Dear Hiring Manager,\n\nBody.\n\nSincerely,\nJane Doe",
        status="completed", created_at=datetime.now(timezone.utc),
    )
    resume = Resume(
        id=letter.resume_id, user_id=uuid.UUID(TEST_USER_ID), title="R",
        content={"contact": {"name": "Jane Doe", "email": "jane@example.com"}},
        template_id="ats_clean",
    )
    letter_result = MagicMock()
    letter_result.scalar_one_or_none.return_value = letter
    resume_result = MagicMock()
    resume_result.scalar_one_or_none.return_value = resume
    mock_session.execute = AsyncMock(side_effect=[letter_result, resume_result])

    bg_session = MagicMock()
    bg_letter_result = MagicMock()
    bg_letter_result.scalar_one_or_none.return_value = letter
    bg_session.execute = AsyncMock(return_value=bg_letter_result)
    bg_session.commit = AsyncMock()
    session_factory = MagicMock(side_effect=lambda: _FakeSessionContextManager(bg_session))

    app.dependency_overrides[get_db] = override
    try:
        with patch(
            "app.routers.cover_letters.generate_letter_pdf", return_value=b"%PDF-fake"
        ) as mock_gen, patch(
            "app.routers.cover_letters.upload_letter_pdf",
            new=AsyncMock(return_value="cover-letters/user/letter.pdf"),
        ) as mock_upload, patch(
            "app.routers.cover_letters.AsyncSessionLocal", new=session_factory
        ), patch(
            "app.routers.cover_letters._supabase", return_value=MagicMock()
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(f"/cover-letters/{letter.id}/pdf", headers=make_auth_header())
        assert r.status_code == 200
        body = r.json()
        assert body["signed_url"] == "data:application/pdf;base64," + base64.b64encode(b"%PDF-fake").decode()
        mock_gen.assert_called_once()
        mock_upload.assert_called_once()
        assert letter.pdf_url == "cover-letters/user/letter.pdf"
    finally:
        app.dependency_overrides.pop(get_db, None)

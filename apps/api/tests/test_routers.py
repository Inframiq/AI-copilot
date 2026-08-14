import pytest
import time
import uuid
import jwt as pyjwt
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, MagicMock, patch
from app.main import app
from app.core.config import settings
from app.db.session import get_db


TEST_USER_ID = "00000000-0000-0000-0000-000000000001"


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
    """Return an async generator that yields a mock AsyncSession."""
    mock_session = MagicMock()
    mock_session.execute = AsyncMock()
    mock_session.commit = AsyncMock()
    mock_session.refresh = AsyncMock()
    mock_session.flush = AsyncMock()
    mock_session.add = MagicMock()
    mock_session.add_all = MagicMock()
    mock_session.delete = AsyncMock()

    async def _override():
        yield mock_session

    return _override, mock_session


@pytest.mark.asyncio
async def test_health_is_public():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_list_resumes_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/resumes")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_list_resumes_returns_200_with_valid_token():
    override, mock_session = make_mock_db()
    # execute returns an object with scalars().all() = []
    mock_scalars = MagicMock()
    mock_scalars.all.return_value = []
    mock_result = MagicMock()
    mock_result.scalars.return_value = mock_scalars
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/resumes", headers=make_auth_header())
        assert r.status_code == 200
        assert r.json() == []
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_create_resume_returns_201():
    override, mock_session = make_mock_db()

    # Simulate what db.refresh does: populate the resume fields
    from app.db.models import Resume
    from datetime import datetime, timezone

    created_resume = Resume(
        id=uuid.UUID("00000000-0000-0000-0000-000000000002"),
        user_id=uuid.UUID(TEST_USER_ID),
        title="My Resume",
        content={},
        template_id="ats_clean",
        pdf_url=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )

    async def fake_refresh(obj):
        obj.id = created_resume.id
        obj.user_id = created_resume.user_id
        obj.title = created_resume.title
        obj.content = created_resume.content
        obj.template_id = created_resume.template_id
        obj.pdf_url = created_resume.pdf_url
        obj.created_at = created_resume.created_at
        obj.updated_at = created_resume.updated_at

    mock_session.refresh = fake_refresh

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.post(
                "/resumes",
                json={"title": "My Resume"},
                headers=make_auth_header(),
            )
        assert r.status_code == 201
        data = r.json()
        assert data["title"] == "My Resume"
        assert data["template_id"] == "ats_clean"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_create_resume_with_jd_id_links_new_resume_to_the_jd():
    """First "Save as new" for a JD that has no linked resume yet — creates a
    resume as normal and links JobDescription.tailored_resume_id to it."""
    from app.db.models import Resume, JobDescription
    from datetime import datetime, timezone

    jd_id = uuid.uuid4()
    jd_row = JobDescription(
        id=jd_id, user_id=uuid.UUID(TEST_USER_ID), title="Acme JD", raw_text="...", tailored_resume_id=None
    )

    override, mock_session = make_mock_db()
    jd_result = MagicMock()
    jd_result.scalar_one_or_none.return_value = jd_row
    mock_session.execute = AsyncMock(return_value=jd_result)

    created_resume = Resume(
        id=uuid.uuid4(),
        user_id=uuid.UUID(TEST_USER_ID),
        title="Resume — Acme",
        content={},
        template_id="ats_clean",
        pdf_url=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )

    async def fake_refresh(obj):
        obj.id = created_resume.id
        obj.created_at = created_resume.created_at
        obj.updated_at = created_resume.updated_at

    mock_session.refresh = fake_refresh

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.post(
                "/resumes",
                json={"title": "Resume — Acme", "jd_id": str(jd_id)},
                headers=make_auth_header(),
            )
        assert r.status_code == 201
        assert r.json()["title"] == "Resume — Acme"
        # The newly created resume gets linked back onto the JD.
        assert jd_row.tailored_resume_id == created_resume.id
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_create_resume_with_jd_id_overwrites_the_already_linked_resume():
    """Re-tailoring the same JD and clicking "Save as new" again must
    overwrite the resume already linked to it, not create a duplicate."""
    from app.db.models import Resume, JobDescription
    from datetime import datetime, timezone

    jd_id = uuid.uuid4()
    existing_resume_id = uuid.uuid4()
    jd_row = JobDescription(
        id=jd_id,
        user_id=uuid.UUID(TEST_USER_ID),
        title="Acme JD",
        raw_text="...",
        tailored_resume_id=existing_resume_id,
    )
    existing_resume = Resume(
        id=existing_resume_id,
        user_id=uuid.UUID(TEST_USER_ID),
        title="Old Tailored Title",
        content={"old": True},
        template_id="ats_clean",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )

    override, mock_session = make_mock_db()
    jd_result = MagicMock()
    jd_result.scalar_one_or_none.return_value = jd_row
    resume_result = MagicMock()
    resume_result.scalar_one_or_none.return_value = existing_resume
    mock_session.execute = AsyncMock(side_effect=[jd_result, resume_result])

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.post(
                "/resumes",
                json={
                    "title": "Resume — Acme v2",
                    "jd_id": str(jd_id),
                    "content": {"new": True},
                },
                headers=make_auth_header(),
            )
        assert r.status_code == 201
        data = r.json()
        # Same resume id — overwritten in place, not a new row.
        assert data["id"] == str(existing_resume_id)
        assert data["title"] == "Resume — Acme v2"
        assert data["content"] == {"new": True}
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_get_resume_404_when_not_found():
    override, mock_session = make_mock_db()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(
                f"/resumes/{uuid.uuid4()}",
                headers=make_auth_header(),
            )
        assert r.status_code == 404
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_delete_resume_204():
    from app.db.models import Resume
    from datetime import datetime, timezone

    override, mock_session = make_mock_db()
    mock_result = MagicMock()
    existing = Resume(
        id=uuid.uuid4(),
        user_id=uuid.UUID(TEST_USER_ID),
        title="Old",
        content={},
        template_id="ats_clean",
        pdf_url=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    mock_result.scalar_one_or_none.return_value = existing
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.delete(
                f"/resumes/{existing.id}",
                headers=make_auth_header(),
            )
        assert r.status_code == 204
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_list_jds_returns_200_with_valid_token():
    override, mock_session = make_mock_db()
    from app.db.models import JobDescription
    from datetime import datetime, timezone

    jd = JobDescription(
        id=uuid.UUID("00000000-0000-0000-0000-000000000003"),
        user_id=uuid.UUID(TEST_USER_ID),
        title="Senior Engineer",
        raw_text="We need a senior engineer.",
        parsed={"required": ["Python"], "nice_to_have": ["Docker"]},
        status="applied",
        created_at=datetime.now(timezone.utc),
    )
    mock_scalars = MagicMock()
    mock_scalars.all.return_value = [jd]
    mock_result = MagicMock()
    mock_result.scalars.return_value = mock_scalars
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/jd", headers=make_auth_header())
        assert r.status_code == 200
        body = r.json()
        assert len(body) == 1
        assert body[0]["title"] == "Senior Engineer"
        assert body[0]["parsed_skills"] == ["Python", "Docker"]
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_list_jds_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/jd")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_get_jd_404_when_not_found():
    override, mock_session = make_mock_db()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(
                f"/jd/{uuid.uuid4()}",
                headers=make_auth_header(),
            )
        assert r.status_code == 404
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_update_jd_status_sets_status():
    from app.db.models import JobDescription
    from datetime import datetime, timezone

    override, mock_session = make_mock_db()
    jd = JobDescription(
        id=uuid.uuid4(),
        user_id=uuid.UUID(TEST_USER_ID),
        title="Senior Engineer",
        raw_text="...",
        parsed={},
        status="applied",
        created_at=datetime.now(timezone.utc),
    )
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = jd
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.patch(
                f"/jd/{jd.id}/status",
                json={"status": "offer"},
                headers=make_auth_header(),
            )
        assert r.status_code == 200
        assert r.json()["status"] == "offer"
        assert jd.status == "offer"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_update_jd_status_rejects_invalid_value():
    override, mock_session = make_mock_db()
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.patch(
                f"/jd/{uuid.uuid4()}/status",
                json={"status": "not-a-real-status"},
                headers=make_auth_header(),
            )
        assert r.status_code == 422
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_update_jd_status_404_when_not_owned():
    override, mock_session = make_mock_db()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.patch(
                f"/jd/{uuid.uuid4()}/status",
                json={"status": "offer"},
                headers=make_auth_header(),
            )
        assert r.status_code == 404
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_get_questions_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get(f"/ai/sessions/{uuid.uuid4()}/questions")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_get_questions_returns_list():
    override, mock_session = make_mock_db()
    mock_scalars = MagicMock()
    mock_scalars.all.return_value = []
    mock_result = MagicMock()
    mock_result.scalars.return_value = mock_scalars
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(
                f"/ai/sessions/{uuid.uuid4()}/questions",
                headers=make_auth_header(),
            )
        assert r.status_code == 200
        assert r.json() == []
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_mark_question_practiced_sets_practiced_at():
    from app.db.models import PrepQuestion

    override, mock_session = make_mock_db()
    question = PrepQuestion(
        id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        topic="System Design",
        question="How would you scale this?",
        answer_framework="Discuss horizontal scaling...",
        is_gap_based=True,
        order_index=0,
        practiced_at=None,
    )
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = question
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.patch(
                f"/ai/questions/{question.id}/practice",
                headers=make_auth_header(),
            )
        assert r.status_code == 200
        assert r.json()["practiced_at"] is not None
        assert question.practiced_at is not None
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_mark_question_practiced_404_when_not_owned():
    override, mock_session = make_mock_db()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.patch(
                f"/ai/questions/{uuid.uuid4()}/practice",
                headers=make_auth_header(),
            )
        assert r.status_code == 404
    finally:
        app.dependency_overrides.pop(get_db, None)

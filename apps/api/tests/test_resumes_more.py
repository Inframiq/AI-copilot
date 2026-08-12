import io
import time
import uuid
import jwt as pyjwt
import pytest
from datetime import datetime, timezone
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, MagicMock, patch
from app.main import app
from app.core.config import settings
from app.core.rate_limit import limiter
from app.db.session import get_db
from app.db.models import Resume

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
    mock_session = MagicMock()
    mock_session.execute = AsyncMock()
    mock_session.commit = AsyncMock()
    mock_session.refresh = AsyncMock()
    mock_session.add = MagicMock()
    mock_session.delete = AsyncMock()

    async def _override():
        yield mock_session

    return _override, mock_session


class _FakeSessionContextManager:
    """Mimics `async with AsyncSessionLocal() as session`."""

    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *exc_info):
        return False


def make_mock_session_factory(resume):
    """Fake replacement for AsyncSessionLocal used by the background PDF-persist task."""
    session = MagicMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = resume
    session.execute = AsyncMock(return_value=mock_result)
    session.commit = AsyncMock()
    factory = MagicMock(side_effect=lambda: _FakeSessionContextManager(session))
    return factory, session


def make_resume(**overrides):
    defaults = dict(
        id=uuid.uuid4(),
        user_id=uuid.UUID(TEST_USER_ID),
        title="My Resume",
        content={"contact": {"name": "Test"}, "experience": [], "education": [], "skills": []},
        template_id="ats_clean",
        pdf_url=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    defaults.update(overrides)
    return Resume(**defaults)


# ── PATCH /resumes/{id} ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_update_resume_patches_fields():
    override, mock_session = make_mock_db()
    resume = make_resume()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = resume
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.patch(
                f"/resumes/{resume.id}",
                json={"title": "Updated Title"},
                headers=make_auth_header(),
            )
        assert r.status_code == 200
        assert r.json()["title"] == "Updated Title"
        assert resume.title == "Updated Title"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_update_resume_404_when_not_found():
    override, mock_session = make_mock_db()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.patch(
                f"/resumes/{uuid.uuid4()}",
                json={"title": "X"},
                headers=make_auth_header(),
            )
        assert r.status_code == 404
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_update_resume_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.patch(f"/resumes/{uuid.uuid4()}", json={"title": "X"})
    assert r.status_code == 401


# ── POST /resumes/{id}/pdf ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_generate_pdf_returns_signed_url():
    import base64

    override, mock_session = make_mock_db()
    resume = make_resume()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = resume
    mock_session.execute.return_value = mock_result
    session_factory, background_session = make_mock_session_factory(resume)

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.resumes.generate_pdf", return_value=b"%PDF-fake") as mock_gen, patch(
            "app.routers.resumes.upload_pdf", new=AsyncMock(return_value="resumes/user/resume.pdf")
        ) as mock_upload, patch(
            "app.routers.resumes.AsyncSessionLocal", new=session_factory
        ), patch(
            "app.routers.resumes._supabase", return_value=MagicMock()
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(
                    f"/resumes/{resume.id}/pdf",
                    json={"template_id": "ats_modern"},
                    headers=make_auth_header(),
                )
        assert r.status_code == 200
        body = r.json()
        assert body["signed_url"] == "data:application/pdf;base64," + base64.b64encode(b"%PDF-fake").decode()
        assert body["expires_in"] is None
        mock_gen.assert_called_once()
        assert resume.template_id == "ats_modern"
        # Storage persistence happens in a background task, after the response is sent.
        mock_upload.assert_called_once()
        assert resume.pdf_url == "resumes/user/resume.pdf"
        background_session.commit.assert_called_once()
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_generate_pdf_rejects_invalid_template():
    override, mock_session = make_mock_db()
    resume = make_resume()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = resume
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.post(
                f"/resumes/{resume.id}/pdf",
                json={"template_id": "not-a-real-template"},
                headers=make_auth_header(),
            )
        assert r.status_code == 422  # pydantic Literal validation
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_generate_pdf_404_when_resume_not_found():
    override, mock_session = make_mock_db()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.post(f"/resumes/{uuid.uuid4()}/pdf", headers=make_auth_header())
        assert r.status_code == 404
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── POST /resumes/parse-upload ───────────────────────────────────────────────

_FAKE_PDF_BYTES = b"%PDF-1.4\n%fake minimal pdf content for magic-byte check\n"


@pytest.mark.asyncio
async def test_parse_upload_creates_resume():
    limiter.reset()
    override, mock_session = make_mock_db()

    created = make_resume(title="Test Candidate's Resume", content={"contact": {"name": "Test Candidate"}})

    async def fake_refresh(obj):
        obj.id = created.id
        obj.created_at = created.created_at
        obj.updated_at = created.updated_at

    mock_session.refresh = fake_refresh

    app.dependency_overrides[get_db] = override
    try:
        mock_sb = MagicMock()
        with patch(
            "app.routers.resumes.extract_text", return_value="Test Candidate\nSenior Engineer\n..."
        ), patch(
            "app.routers.resumes.parse_resume_text",
            new=AsyncMock(
                return_value={
                    "contact": {"name": "Test Candidate", "email": "t@t.com"},
                    "experience": [],
                    "education": [],
                    "skills": [],
                }
            ),
        ), patch(
            "app.routers.resumes._supabase", return_value=mock_sb
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(
                    "/resumes/parse-upload",
                    files={"file": ("resume.pdf", io.BytesIO(_FAKE_PDF_BYTES), "application/pdf")},
                    data={"template_id": "ats_clean"},
                    headers=make_auth_header(),
                )
        assert r.status_code == 201
        body = r.json()
        assert body["title"] == "Test Candidate's Resume"
        # The original PDF bytes are stored untouched, before AI parsing runs.
        mock_sb.storage.from_.assert_called_with("resumes")
        upload_call = mock_sb.storage.from_.return_value.upload.call_args
        assert upload_call.args[1] == _FAKE_PDF_BYTES
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_parse_upload_rejects_docx():
    """DOCX/DOC is no longer accepted — the original file is stored untouched
    and shown verbatim in Preview, so there's no conversion path for it."""
    limiter.reset()
    override, mock_session = make_mock_db()
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.post(
                "/resumes/parse-upload",
                files={
                    "file": (
                        "resume.docx",
                        io.BytesIO(b"PK\x03\x04fake docx content"),
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    )
                },
                data={"template_id": "ats_clean"},
                headers=make_auth_header(),
            )
        assert r.status_code == 400
        assert "PDF" in r.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_parse_upload_fails_when_storage_upload_fails():
    """If the original file can't be stored, the whole upload must fail
    rather than creating a Resume row with no master copy behind it."""
    limiter.reset()
    override, mock_session = make_mock_db()
    app.dependency_overrides[get_db] = override
    try:
        mock_sb = MagicMock()
        mock_sb.storage.from_.return_value.upload.side_effect = Exception("storage down")
        with patch("app.routers.resumes._supabase", return_value=mock_sb):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(
                    "/resumes/parse-upload",
                    files={"file": ("resume.pdf", io.BytesIO(_FAKE_PDF_BYTES), "application/pdf")},
                    data={"template_id": "ats_clean"},
                    headers=make_auth_header(),
                )
        assert r.status_code == 502
        mock_session.add.assert_not_called()
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_parse_upload_rejects_bad_magic_bytes():
    limiter.reset()
    override, mock_session = make_mock_db()
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.post(
                "/resumes/parse-upload",
                files={"file": ("resume.pdf", io.BytesIO(b"not a real pdf at all"), "application/pdf")},
                data={"template_id": "ats_clean"},
                headers=make_auth_header(),
            )
        assert r.status_code == 400
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_parse_upload_rejects_unsupported_extension():
    limiter.reset()
    override, mock_session = make_mock_db()
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.post(
                "/resumes/parse-upload",
                files={"file": ("resume.txt", io.BytesIO(b"plain text resume"), "text/plain")},
                data={"template_id": "ats_clean"},
                headers=make_auth_header(),
            )
        assert r.status_code == 400
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_parse_upload_times_out_cleanly_on_slow_parse(monkeypatch):
    """A pathological file that makes extract_text hang must not hang the request."""
    import time
    from app.routers import resumes as resumes_module

    monkeypatch.setattr(resumes_module, "_PARSE_TIMEOUT_SECONDS", 0.05)

    def slow_extract_text(*args, **kwargs):
        time.sleep(1)
        return "should never get here"

    limiter.reset()
    override, mock_session = make_mock_db()
    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.resumes.extract_text", side_effect=slow_extract_text), patch(
            "app.routers.resumes._supabase", return_value=MagicMock()
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(
                    "/resumes/parse-upload",
                    files={"file": ("resume.pdf", io.BytesIO(_FAKE_PDF_BYTES), "application/pdf")},
                    data={"template_id": "ats_clean"},
                    headers=make_auth_header(),
                )
        assert r.status_code == 422
        assert "too long" in r.json()["detail"].lower()
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── GET /resumes/{id}/original ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_original_file_returns_signed_url():
    override, mock_session = make_mock_db()
    resume = make_resume(
        original_file_path="resumes/user/rid/original.pdf",
        original_file_name="my_resume.pdf",
    )
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = resume
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        with patch(
            "app.routers.resumes.get_signed_url", return_value="https://signed.example/original.pdf"
        ), patch("app.routers.resumes._supabase", return_value=MagicMock()):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.get(f"/resumes/{resume.id}/original", headers=make_auth_header())
        assert r.status_code == 200
        body = r.json()
        assert body["signed_url"] == "https://signed.example/original.pdf"
        assert body["file_name"] == "my_resume.pdf"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_get_original_file_404_when_no_original():
    override, mock_session = make_mock_db()
    resume = make_resume(original_file_path=None, original_file_name=None)
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = resume
    mock_session.execute.return_value = mock_result

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/resumes/{resume.id}/original", headers=make_auth_header())
        assert r.status_code == 404
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_parse_upload_requires_auth():
    limiter.reset()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post(
            "/resumes/parse-upload",
            files={"file": ("resume.pdf", io.BytesIO(_FAKE_PDF_BYTES), "application/pdf")},
        )
    assert r.status_code == 401

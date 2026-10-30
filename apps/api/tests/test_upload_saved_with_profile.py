"""The Profile's upload is saved with the profile, never before it.

Replace (or a first upload) on the Profile reads the PDF with the model
(POST /resumes/read-upload) and fills the form; nothing is stored. The
résumé is written by POST /resumes/save-upload when Save Profile is
pressed. Leaving unsaved used to leave the new résumé in place anyway: the
old parse-upload wrote the row and its file as soon as it had read them."""
import io
import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient

from app.core.rate_limit import limiter
from app.db.session import get_db
from app.main import app
from app.services import sandbox
from app.services.resume_parser import ResumeUnreadable
from tests.test_resumes_more import _FAKE_PDF_BYTES, TEST_USER_ID, make_auth_header, make_mock_db, make_resume

PARSED = {
    "contact": {"name": "Test Candidate"}, "experience": [], "education": [], "skills": [],
    "unplaced": [{"heading": "Key Responsibilities", "points": ["Ran the team"]}],
}
OLD_PATH = f"resumes/{TEST_USER_ID}/rid/original.pdf"


@pytest.fixture(autouse=True)
def room_for_resumes():
    with patch("app.routers.resumes._ensure_room_for_a_new_resume", new=AsyncMock()) as room:
        yield room


async def _post(path, session, storage, data, parse=None, extract=None, raise_errors=True):
    limiter.reset()

    async def override():
        yield session

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.resumes._supabase", return_value=storage), \
             patch("app.routers.resumes.sandbox.extract_pdf_text", side_effect=extract, return_value="Test Candidate"), \
             patch("app.routers.resumes.get_ai_provider", return_value=MagicMock()), \
             patch("app.routers.resumes.parse_resume_text", new=parse or AsyncMock(return_value=dict(PARSED))):
            transport = ASGITransport(app=app, raise_app_exceptions=raise_errors)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                return await client.post(
                    path,
                    files={"file": ("resume.pdf", io.BytesIO(_FAKE_PDF_BYTES), "application/pdf")},
                    data=data, headers=make_auth_header(),
                )
    finally:
        app.dependency_overrides.pop(get_db, None)


def _bucket(storage):
    return storage.storage.from_.return_value


def _removed(storage) -> list[str]:
    return [p for c in _bucket(storage).remove.call_args_list for p in c.args[0]]


def _finding(existing):
    """A session whose lookups find this résumé (None: not the caller's)."""
    _, session = make_mock_db()
    found = MagicMock()
    found.scalar_one_or_none.return_value = existing
    found.scalars.return_value.all.return_value = []
    session.execute = AsyncMock(return_value=found)
    return session


# ── read-upload: read, charged, nothing stored ──────────────────────────────

@pytest.mark.asyncio
async def test_reading_an_upload_stores_nothing(ledger):
    existing = make_resume(original_file_path=OLD_PATH, content={"contact": {"name": "Old"}})
    session, storage = _finding(existing), MagicMock()
    r = await _post("/resumes/read-upload", session, storage, {"resume_id": str(existing.id)})

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["title"] == "Test Candidate's Resume"
    assert body["content"]["contact"] == {"name": "Test Candidate"} and "unplaced" not in body["content"]
    assert body["unplaced"] == [{"heading": "Key Responsibilities", "points": ["Ran the team"]}]
    # The résumé being replaced is untouched; no file stored, no row added.
    assert existing.content == {"contact": {"name": "Old"}} and existing.original_file_path == OLD_PATH
    _bucket(storage).upload.assert_not_called()
    session.add.assert_not_called()
    # The model ran: one credit, kept.
    assert ledger.spent == ["parse_resume"] and ledger.refunded == []


@pytest.mark.asyncio
async def test_a_read_that_fails_gives_the_credit_back(ledger):
    r = await _post("/resumes/read-upload", _finding(None), MagicMock(), {},
                    parse=AsyncMock(side_effect=ResumeUnreadable("x")))
    assert r.status_code == 502
    assert ledger.spent == ["parse_resume"] and ledger.refunded == ["parse_resume"]


@pytest.mark.asyncio
async def test_reading_for_someone_elses_resume_is_404_before_any_charge(ledger):
    session, parse = _finding(None), AsyncMock(return_value=dict(PARSED))
    r = await _post("/resumes/read-upload", session, MagicMock(), {"resume_id": str(uuid.uuid4())}, parse=parse)
    assert r.status_code == 404 and r.json() == {"detail": "Resume not found"}
    assert ledger.spent == []
    parse.assert_not_called()


@pytest.mark.asyncio
async def test_a_first_upload_with_no_room_is_refused_before_any_charge(ledger, room_for_resumes):
    room_for_resumes.side_effect = HTTPException(status_code=409, detail="full")
    parse = AsyncMock(return_value=dict(PARSED))
    r = await _post("/resumes/read-upload", _finding(None), MagicMock(), {}, parse=parse)
    assert r.status_code == 409
    assert ledger.spent == []
    parse.assert_not_called()


# ── save-upload: stored when the profile is saved, free ─────────────────────

def _content(**extra):
    return json.dumps({"contact": {"name": "Test Candidate"}, "headline": "Data Analyst", "skills": [], **extra})


@pytest.mark.asyncio
async def test_saving_replaces_the_resume_and_its_file_without_a_charge(ledger):
    existing = make_resume(original_file_path=OLD_PATH, original_file_name="old.pdf")
    storage = MagicMock()
    r = await _post("/resumes/save-upload", _finding(existing), storage, {
        "resume_id": str(existing.id), "template_id": "ats_modern", "content": _content(),
    })

    assert r.status_code == 200, r.text
    stored = _bucket(storage).upload.call_args.args[0]
    assert stored.startswith(f"resumes/{TEST_USER_ID}/{existing.id}/original-") and stored != OLD_PATH
    assert existing.original_file_path == stored and existing.original_file_name == "resume.pdf"
    assert existing.content["headline"] == "Data Analyst" and existing.template_id == "ats_modern"
    assert existing.title == "Test Candidate's Resume"
    assert _removed(storage) == [OLD_PATH]
    assert ledger.spent == []


@pytest.mark.asyncio
async def test_saving_a_first_upload_makes_a_new_resume(ledger, room_for_resumes):
    session, storage = _finding(None), MagicMock()
    r = await _post("/resumes/save-upload", session, storage, {"content": _content()}, raise_errors=False)

    # The mock session gives the new row no defaults to answer with; what was
    # saved is what counts.
    saved = session.add.call_args.args[0]
    assert saved.user_id == uuid.UUID(TEST_USER_ID) and saved.content["headline"] == "Data Analyst"
    assert saved.original_file_path == _bucket(storage).upload.call_args.args[0]
    assert saved.original_file_path.startswith(f"resumes/{TEST_USER_ID}/{saved.id}/")
    # Checked up front and again, locked, in the transaction that inserts it.
    assert room_for_resumes.await_count == 2
    assert ledger.spent == []
    assert r.status_code in (201, 500)


@pytest.mark.asyncio
async def test_the_saved_content_is_checked_like_any_resume_save(ledger):
    existing = make_resume(original_file_path=OLD_PATH)
    r = await _post("/resumes/save-upload", _finding(existing), MagicMock(), {
        "resume_id": str(existing.id), "content": _content(summary="Led “growth”—fast\x00"),
    })
    assert r.status_code == 200, r.text
    # Keyboard text, as PATCH /resumes saves it; the NUL dropped.
    assert existing.content["summary"] == 'Led "growth" - fast'


@pytest.mark.parametrize("content", ["not json", "[1, 2]", json.dumps({"summary": "x" * 300_000})],
                         ids=["not-json", "not-an-object", "past-the-cap"])
@pytest.mark.asyncio
async def test_unreadable_or_oversized_content_is_refused_and_nothing_stored(ledger, content):
    existing = make_resume(original_file_path=OLD_PATH)
    storage = MagicMock()
    r = await _post("/resumes/save-upload", _finding(existing), storage,
                    {"resume_id": str(existing.id), "content": content})
    assert r.status_code == 422
    _bucket(storage).upload.assert_not_called()
    assert existing.original_file_path == OLD_PATH


@pytest.mark.asyncio
async def test_saving_over_someone_elses_resume_is_404_and_nothing_stored(ledger):
    storage = MagicMock()
    r = await _post("/resumes/save-upload", _finding(None), storage,
                    {"resume_id": str(uuid.uuid4()), "content": _content()})
    assert r.status_code == 404 and r.json() == {"detail": "Resume not found"}
    _bucket(storage).upload.assert_not_called()


@pytest.mark.asyncio
async def test_the_file_goes_through_the_sandbox_again_before_it_is_stored(ledger):
    existing = make_resume(original_file_path=OLD_PATH)
    storage = MagicMock()
    r = await _post("/resumes/save-upload", _finding(existing), storage,
                    {"resume_id": str(existing.id), "content": _content()},
                    extract=sandbox.SandboxRejected("This PDF carries active content."))
    assert r.status_code == 422 and r.json() == {"detail": "This PDF carries active content."}
    _bucket(storage).upload.assert_not_called()
    assert existing.original_file_path == OLD_PATH


@pytest.mark.asyncio
async def test_a_failed_save_removes_the_file_it_stored(ledger):
    existing = make_resume(original_file_path=OLD_PATH)
    session, storage = _finding(existing), MagicMock()
    session.commit = AsyncMock(side_effect=RuntimeError("database down"))
    r = await _post("/resumes/save-upload", session, storage,
                    {"resume_id": str(existing.id), "content": _content()}, raise_errors=False)
    assert r.status_code == 500
    assert _removed(storage) == [_bucket(storage).upload.call_args.args[0]]

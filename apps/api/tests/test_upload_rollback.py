"""A résumé upload that fails part-way leaves nothing behind (test DB-004).

The upload is several steps: charge a credit, read the PDF, store the file,
parse it, save the row. Until the row is committed, a failure gives the
credit back and removes the file it stored. Replacing a résumé stores the new
file under its own name, so the old résumé keeps its file until the new one
is saved."""
import io
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.rate_limit import limiter
from app.db.session import get_db
from app.main import app
from app.services.resume_parser import ResumeUnreadable
from tests.test_resumes_more import _FAKE_PDF_BYTES, TEST_USER_ID, make_auth_header, make_mock_db, make_resume

PARSED = {"contact": {"name": "Test Candidate"}, "experience": [], "education": [], "skills": []}
OLD_PATH = f"resumes/{TEST_USER_ID}/rid/original.pdf"


@pytest.fixture(autouse=True)
def room_for_resumes():
    with patch("app.routers.resumes._ensure_room_for_a_new_resume", new=AsyncMock()):
        yield


async def _upload(mock_session, parse, storage, data=None, raise_errors=True):
    limiter.reset()

    async def override():
        yield mock_session

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.resumes._supabase", return_value=storage), \
             patch("app.routers.resumes.sandbox.extract_pdf_text", return_value="Test Candidate"), \
             patch("app.routers.resumes.parse_resume_text", new=parse):
            transport = ASGITransport(app=app, raise_app_exceptions=raise_errors)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                return await client.post(
                    "/resumes/parse-upload",
                    files={"file": ("resume.pdf", io.BytesIO(_FAKE_PDF_BYTES), "application/pdf")},
                    data={"template_id": "ats_clean", **(data or {})},
                    headers=make_auth_header(),
                )
    finally:
        app.dependency_overrides.pop(get_db, None)


def _stored(storage) -> str:
    return storage.storage.from_.return_value.upload.call_args.args[0]


def _removed(storage) -> list[str]:
    return [p for c in storage.storage.from_.return_value.remove.call_args_list for p in c.args[0]]


def _replacing(existing):
    """A session whose first lookup finds the résumé being replaced."""
    _, session = make_mock_db()
    found = MagicMock()
    found.scalar_one_or_none.return_value = existing
    session.execute = AsyncMock(return_value=found)
    return session


@pytest.mark.asyncio
async def test_a_failed_parse_removes_the_stored_file_and_refunds(ledger):
    _, session = make_mock_db()
    storage = MagicMock()
    r = await _upload(session, AsyncMock(side_effect=ResumeUnreadable("x")), storage)

    assert r.status_code == 502
    session.add.assert_not_called()
    assert _removed(storage) == [_stored(storage)]
    assert ledger.spent == ["parse_resume"] and ledger.refunded == ["parse_resume"]


@pytest.mark.asyncio
async def test_a_failed_save_removes_the_stored_file_and_refunds(ledger):
    _, session = make_mock_db()
    no_titles = MagicMock()
    no_titles.scalars.return_value.all.return_value = []
    session.execute = AsyncMock(return_value=no_titles)
    # The charge commits, saving the row fails, the refund commits.
    session.commit = AsyncMock(side_effect=[None, RuntimeError("database down"), None])
    storage = MagicMock()
    r = await _upload(session, AsyncMock(return_value=PARSED), storage, raise_errors=False)

    assert r.status_code == 500
    assert _removed(storage) == [_stored(storage)]
    assert ledger.refunded == ["parse_resume"]


@pytest.mark.asyncio
async def test_a_failed_replace_leaves_the_old_resume_and_its_file_alone(ledger):
    existing = make_resume(original_file_path=OLD_PATH, original_file_name="old.pdf")
    storage = MagicMock()
    r = await _upload(_replacing(existing), AsyncMock(side_effect=ResumeUnreadable("x")), storage,
                      data={"resume_id": str(existing.id)})

    assert r.status_code == 502
    assert _stored(storage) != OLD_PATH, "the new file must not overwrite the old one"
    assert existing.original_file_path == OLD_PATH and existing.original_file_name == "old.pdf"
    assert _removed(storage) == [_stored(storage)]
    assert ledger.refunded == ["parse_resume"]


@pytest.mark.asyncio
async def test_a_replace_drops_the_old_file_once_the_new_one_is_saved(ledger):
    existing = make_resume(original_file_path=OLD_PATH, original_file_name="old.pdf")
    storage = MagicMock()
    r = await _upload(_replacing(existing), AsyncMock(return_value=PARSED), storage,
                      data={"resume_id": str(existing.id)})

    assert r.status_code == 200
    assert existing.original_file_path == _stored(storage) != OLD_PATH
    assert _removed(storage) == [OLD_PATH]
    assert ledger.refunded == []


@pytest.mark.asyncio
async def test_a_failure_after_the_save_undoes_nothing(ledger):
    _, session = make_mock_db()
    no_titles = MagicMock()
    no_titles.scalars.return_value.all.return_value = []
    session.execute = AsyncMock(return_value=no_titles)
    session.refresh = AsyncMock(side_effect=RuntimeError("connection dropped"))
    storage = MagicMock()
    await _upload(session, AsyncMock(return_value=PARSED), storage, raise_errors=False)

    # The row is committed and points at the file: both stay, and the credit was spent on a real upload.
    assert _removed(storage) == []
    assert ledger.refunded == []



@pytest.mark.asyncio
async def test_replacing_someone_elses_resume_is_404_before_anything_is_charged(ledger):
    """The Replace flow names the résumé to overwrite by id (test ATK-010).
    Another user's id must look exactly like one that doesn't exist: looked up
    under the caller's own id only, refused before a credit is spent, the
    file read, or anything stored."""
    import uuid

    someone_elses = uuid.uuid4()
    session = _replacing(None)  # the owner-scoped lookup finds nothing
    storage, parse = MagicMock(), AsyncMock(return_value=PARSED)
    r = await _upload(session, parse, storage, data={"resume_id": str(someone_elses)})

    assert r.status_code == 404 and r.json() == {"detail": "Resume not found"}
    lookup = session.execute.call_args_list[0].args[0].compile().params.values()
    assert someone_elses in lookup and uuid.UUID(TEST_USER_ID) in lookup
    assert ledger.spent == []
    parse.assert_not_called()
    storage.storage.from_.return_value.upload.assert_not_called()
    session.add.assert_not_called()

"""Deleting a record removes the files stored for it (test DB-004).

Storage held 26 files nothing pointed at: PDFs of résumés deleted before
their files were cleaned up, and uploads whose parse failed. These cover the
paths that still leaked: a deleted cover letter, a deleted job description
(its letters go by cascade), and a PDF rendered in the background for a
record deleted meanwhile."""
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.db.models import CoverLetter, JobDescription
from app.db.session import get_db
from app.main import app
from tests.test_cover_letters import TEST_USER_ID, make_auth_header, make_mock_db

LETTER_PDF = f"cover-letters/{TEST_USER_ID}/letter.pdf"


def _removed(storage) -> list[str]:
    return [p for c in storage.storage.from_.return_value.remove.call_args_list for p in c.args[0]]


async def _delete(path: str, session) -> int:
    async def override():
        yield session

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            return (await client.delete(path, headers=make_auth_header())).status_code
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_deleting_a_cover_letter_removes_its_pdf():
    _, session = make_mock_db()
    letter = CoverLetter(id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), jd_id=uuid.uuid4(),
                         pdf_url=LETTER_PDF, created_at=datetime.now(timezone.utc))
    found = MagicMock()
    found.scalar_one_or_none.return_value = letter
    session.execute = AsyncMock(return_value=found)
    storage = MagicMock()
    with patch("app.routers.cover_letters._supabase", return_value=storage):
        assert await _delete(f"/cover-letters/{letter.id}", session) == 204
    assert _removed(storage) == [LETTER_PDF]


@pytest.mark.asyncio
async def test_deleting_a_job_removes_its_cover_letters_pdfs():
    _, session = make_mock_db()
    jd = JobDescription(id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), title="J", raw_text="x", parsed={})
    found = MagicMock()
    found.scalar_one_or_none.return_value = jd
    letters = MagicMock()
    letters.scalars.return_value.all.return_value = [LETTER_PDF]
    session.execute = AsyncMock(side_effect=[found, letters])
    storage = MagicMock()
    with patch("app.routers.cover_letters._supabase", return_value=storage):
        assert await _delete(f"/jd/{jd.id}", session) == 204
    session.delete.assert_called_once_with(jd)
    assert _removed(storage) == [LETTER_PDF]


class _Session:
    def __init__(self, execute_result):
        self.execute = AsyncMock(return_value=execute_result)
        self.commit = AsyncMock()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


@pytest.mark.asyncio
async def test_a_resume_pdf_rendered_after_the_resume_was_deleted_is_removed():
    from app.routers import resumes

    gone = MagicMock(rowcount=0)
    storage = MagicMock()
    path = f"resumes/{TEST_USER_ID}/r.pdf"
    with patch.object(resumes, "_supabase", return_value=storage), \
         patch.object(resumes, "upload_pdf", new=AsyncMock(return_value=path)), \
         patch.object(resumes, "AsyncSessionLocal", new=lambda: _Session(gone)):
        await resumes._persist_pdf_to_storage(b"%PDF", TEST_USER_ID, uuid.uuid4())
    assert _removed(storage) == [path]


@pytest.mark.asyncio
async def test_a_resume_pdf_for_a_resume_that_still_exists_is_kept():
    from app.routers import resumes

    storage = MagicMock()
    with patch.object(resumes, "_supabase", return_value=storage), \
         patch.object(resumes, "upload_pdf", new=AsyncMock(return_value="resumes/u/r.pdf")), \
         patch.object(resumes, "AsyncSessionLocal", new=lambda: _Session(MagicMock(rowcount=1))):
        await resumes._persist_pdf_to_storage(b"%PDF", TEST_USER_ID, uuid.uuid4())
    assert _removed(storage) == []


@pytest.mark.asyncio
async def test_a_letter_pdf_rendered_after_the_letter_was_deleted_is_removed():
    from app.routers import cover_letters

    missing = MagicMock()
    missing.scalar_one_or_none.return_value = None
    storage = MagicMock()
    with patch.object(cover_letters, "_supabase", return_value=storage), \
         patch.object(cover_letters, "upload_letter_pdf", new=AsyncMock(return_value=LETTER_PDF)), \
         patch.object(cover_letters, "AsyncSessionLocal", new=lambda: _Session(missing)):
        await cover_letters._persist_letter_pdf_to_storage(b"%PDF", TEST_USER_ID, uuid.uuid4())
    assert _removed(storage) == [LETTER_PDF]

"""POST /resumes/{id}/html — the document the Studio edits inline.

Returns the same HTML string generate_pdf feeds to WeasyPrint, so what the
user edits is by construction what exports. No second template path.
"""
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.db.session import get_db
from app.db.models import Resume
from tests.test_jd_and_tailor_endpoints import make_auth_header, make_mock_db, TEST_USER_ID

RESUME_ID = uuid.uuid4()


def _resume():
    return Resume(
        id=RESUME_ID, user_id=uuid.UUID(TEST_USER_ID), title="R",
        content={"contact": {"name": "Jane"}, "experience": [], "education": [], "skills": []},
        template_id="ats_clean", line_spacing=1.25, paragraph_spacing=12,
        font_choice="sans", accent_color=None,
    )


async def _post(body=None, row_value="default"):
    override, session = make_mock_db()
    row = MagicMock()
    row.scalar_one_or_none.return_value = _resume() if row_value == "default" else row_value
    session.execute = AsyncMock(return_value=row)
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            return await c.post(
                f"/resumes/{RESUME_ID}/html", json=body or {}, headers=make_auth_header(),
            )
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_returns_rendered_html():
    r = await _post()
    assert r.status_code == 200, r.text
    assert "<html" in r.json()["html"].lower()


@pytest.mark.asyncio
async def test_the_html_contains_the_resume_content():
    r = await _post()
    assert "Jane" in r.json()["html"]


@pytest.mark.asyncio
async def test_a_content_override_is_rendered_instead_of_the_saved_resume():
    body = {"content": {"contact": {"name": "Override Name"}, "experience": [],
                        "education": [], "skills": []}}
    r = await _post(body)
    assert "Override Name" in r.json()["html"]


@pytest.mark.asyncio
async def test_it_rejects_an_unknown_template():
    r = await _post({"template_id": "not_a_template"})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_it_404s_for_a_resume_the_caller_does_not_own():
    r = await _post(row_value=None)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_it_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post(f"/resumes/{RESUME_ID}/html", json={})
    assert r.status_code in (401, 403)

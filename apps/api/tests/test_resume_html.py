"""POST /resumes/{id}/html — the document the Studio edits inline.

Returns the same HTML string generate_pdf feeds to WeasyPrint, so what the
user edits is by construction what exports. No second template path.
"""
import re
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
        heading_size_delta=-1, body_size_delta=-1,
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


# ── Presentation overrides ──────────────────────────────────────────────────
# The Studio's Type and Spacing controls send these. They have to reach the
# render, or the panel looks broken: the user moves a slider and the document
# does not move.


@pytest.mark.asyncio
async def test_a_spacing_override_is_rendered_instead_of_the_saved_one():
    r = await _post({"line_spacing": 1.6, "paragraph_spacing": 24})
    assert "line-height: 1.6" in r.json()["html"]


@pytest.mark.asyncio
async def test_no_paragraph_spacing_at_all_is_honoured():
    """Zero is a real value the Custom slider can produce.

    `body.paragraph_spacing or resume.paragraph_spacing` silently swapped it
    for the saved 12: the slider went to zero and nothing moved.
    """
    r = await _post({"paragraph_spacing": 0})
    html = r.json()["html"]
    assert "margin: 4px 0 0px" in html
    assert "margin: 4px 0 12px" not in html


@pytest.mark.asyncio
async def test_a_font_override_is_rendered():
    r = await _post({"font_choice": "serif"})
    assert "Georgia" in r.json()["html"]


@pytest.mark.asyncio
async def test_the_saved_values_still_apply_when_nothing_is_overridden():
    r = await _post()
    assert "line-height: 1.25" in r.json()["html"]


# ── Text size ───────────────────────────────────────────────────────────────
# The saved row above is Small/Small, so a request that reaches the render
# produces something different from one that silently falls back to the row.


def _body_pt(html: str) -> float:
    """The body rule's size — the one unambiguous signal of the step in force.

    Anchored at the start of its line: the templates carry comments that
    mention "body", and an unanchored search walks past them.
    """
    m = re.search(
        r"^\s*body\s*\{[^}]*font-size:\s*([\d.]+)pt",
        html.split("</style>")[0], re.M,
    )
    assert m, "no body font-size"
    return float(m.group(1))


@pytest.mark.asyncio
async def test_the_requested_text_size_reaches_the_render():
    """Reported as: standard -> small works, small -> standard does not.

    The size fields were declared on ResumeUpdate but not on this route's
    PdfGenerateRequest, so Pydantic dropped them and the endpoint always
    rendered the row's saved size. The preview then followed the debounced
    autosave rather than the control, which is a race: whichever landed
    first won.
    """
    r = await _post({"body_size_delta": 0})
    assert _body_pt(r.json()["html"]) == 11  # standard, as asked — not the row's small


@pytest.mark.asyncio
async def test_each_step_is_honoured_in_both_directions():
    small = (await _post({"body_size_delta": -1})).json()["html"]
    standard = (await _post({"body_size_delta": 0})).json()["html"]
    large = (await _post({"body_size_delta": 1})).json()["html"]
    assert small != standard != large
    # The recommended band, one step each: 10 / 11 / 12.
    assert (_body_pt(small), _body_pt(standard), _body_pt(large)) == (10, 11, 12)


@pytest.mark.asyncio
async def test_headings_are_requested_separately_from_the_body():
    r = await _post({"heading_size_delta": 1, "body_size_delta": 0})
    html = r.json()["html"]
    assert "font-size: 17pt" in html  # name 16 -> 17
    assert _body_pt(html) == 11  # body untouched


@pytest.mark.asyncio
async def test_omitting_the_size_still_uses_the_saved_one():
    """Omission is not the same as standard: the résumé keeps its choice."""
    r = await _post({"line_spacing": 1.5})
    assert _body_pt(r.json()["html"]) == 10  # the row's own small step

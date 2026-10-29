"""The guarantee: no curly quote, long dash, odd space or fancy bullet in a
user's text reaches a saved résumé, letter or JD, or an exported PDF —
whether the model wrote it, the user pasted it, or an upload carried it.
Code checks only; no model is called.

The templates' own separators (the "\u00b7" between fields, the "\u2013" between
dates) are design and stay; what is checked is that the text put INTO a
résumé prints exactly as its plain_text() form would.
"""
import copy
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel

from app.db.models import JobDescription, TailoringSession
from app.db.session import get_db
from app.main import app
from app.schemas.cover_letter import CoverLetterOut, CoverLetterUpdate
from app.schemas.jd import JDCompanyUpdate, JDCreate, JDTitleUpdate
from app.schemas.resume import ResumeCreate, ResumeOut, ResumeUpdate
from app.services.pdf import (
    ALLOWED_TEMPLATES,
    TEMPLATES_REQUIRING_PHOTO,
    _render_letter_html,
    generate_pdf,
    render_resume_html,
)
from app.services.pdf_text import extract_text_from_pdf
from app.services.plain_text import plain_deep
from tests.test_jd_and_tailor_endpoints import TEST_USER_ID, make_auth_header, make_mock_db
from tests.test_pdf import trusted_settings, _with_trusted_photo  # noqa: F401

# One of every kind plain_text replaces, in a line of ordinary text.
AI = (
    "\u201cOwned\u201d Jane\u2019s rollout\u2014cut cost 20%\u2026 "
    "\u2022 API \u2192 UI \u2713 10\u00a0teams\u2009x\u202fy Py\u200bthon \u00b7 2019\u20132021 "
    "&nbsp;&mdash;&rsquo;"
)
# Never in a template's own markup, so never in a render of plain text. (The
# templates do draw "\u00b7", "\u2013", "&mdash;" and, in Modern's contact line, a
# non-breaking space \u2014 design, kept; the equality checks cover those.)
NEVER = ["\u201c", "\u201d", "\u2019", "\u2026", "\u2192", "\u2713",
         "\u2009", "\u202f", "\u200b", "&rsquo;"]


def _resume(text: str) -> dict:
    """A résumé with the text in every field a template prints."""
    return {
        "contact": {"name": "Jane " + text[:20], "email": "j@x.com", "phone": "+1 555",
                    "location": text[:30], "photo_url": None},
        "headline": text, "summary": text, "objective": text,
        "experience": [{
            "company": text[:40], "title": text[:40], "location": text[:20],
            "start": "Jan 2020", "end": "Present", "bullets": [text, text],
            "projects": [{"client": text[:30], "name": text[:30], "role": text[:20],
                          "domain": text[:20], "start": "Jan 2021", "end": "Present",
                          "bullets": [text]}],
        }],
        "projects": [{"name": text[:30], "tech_stack": text[:40], "bullets": [text]}],
        "education": [{"institution": text[:40], "degree": text[:40], "year": "2019",
                       "gpa": "8.6/10", "honors": text[:40]}],
        "skills": ["Python", text[:20]],
        "languages": [{"name": text[:10], "level": text[:10]}],
        "certifications": [text], "awards": [text], "achievements": [text],
        "leadership": [text], "volunteer": [text], "interests": [text[:30]],
    }


DIRTY = _resume(AI)


def _no_ai_characters(text: str) -> None:
    for ch in NEVER:
        assert ch not in text, f"{ch!r} reached the output"


# ── PDF ──────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("template", sorted(ALLOWED_TEMPLATES))
def test_a_resume_renders_as_its_plain_text(template, avatar_store, trusted_settings):
    content = copy.deepcopy(DIRTY)
    if template in TEMPLATES_REQUIRING_PHOTO:
        content = _with_trusted_photo(content, avatar_store)
    html = render_resume_html(copy.deepcopy(content), template)
    assert html == render_resume_html(plain_deep(content), template)
    _no_ai_characters(html)


def test_the_exported_pdf_carries_none_of_it():
    text = extract_text_from_pdf(generate_pdf(copy.deepcopy(DIRTY), "ats_clean"))
    assert text == extract_text_from_pdf(generate_pdf(plain_deep(DIRTY), "ats_clean"))
    _no_ai_characters(text)


def test_a_letter_renders_as_its_plain_text():
    contact = {"name": "Jane\u00a0Doe", "email": "j@x.com"}
    html = _render_letter_html(contact, "1 Jan 2026", AI)
    assert html == _render_letter_html(plain_deep(contact), "1 Jan 2026", plain_deep(AI))
    _no_ai_characters(html)


# ── What is saved, and what is read back ─────────────────────────────────────

def test_every_resume_write_and_read_is_plain():
    plain = plain_deep(DIRTY)
    assert ResumeCreate(title=AI[:200], content=DIRTY).content == plain
    assert ResumeCreate(title=AI[:200], content=DIRTY).title == plain_deep(AI[:200])
    assert ResumeUpdate(content=DIRTY).content == plain
    out = ResumeOut(
        id=uuid.uuid4(), user_id=uuid.uuid4(), title=AI[:200], content=DIRTY,
        template_id="ats_clean", line_spacing=1.25, paragraph_spacing=12, font_choice="sans",
        accent_color=None, pdf_url=None, original_file_name=None,
        created_at="2026-01-01T00:00:00Z", updated_at="2026-01-01T00:00:00Z",
    )
    assert out.content == plain and out.title == plain_deep(AI[:200])


def test_every_letter_and_jd_write_is_plain():
    assert CoverLetterUpdate(content=AI, title=AI[:100]).content == plain_deep(AI)
    letter = CoverLetterOut(
        id=uuid.uuid4(), resume_id=None, jd_id=uuid.uuid4(), tailoring_session_id=None,
        content=AI, humanize_level=50, pdf_url=None, status="completed",
        created_at="2026-01-01T00:00:00Z", title=AI[:100],
    )
    assert letter.content == plain_deep(AI) and letter.title == plain_deep(AI[:100])
    jd = JDCreate(raw_text=AI, title=AI[:100], company_name=AI[:100])
    assert (jd.title, jd.company_name) == (plain_deep(AI[:100]), plain_deep(AI[:100]))
    assert JDTitleUpdate(title=AI[:100]).title == plain_deep(AI[:100])
    assert JDCompanyUpdate(company_name=AI[:100]).company_name == plain_deep(AI[:100])


@pytest.mark.asyncio
async def test_a_pasted_jd_is_saved_plain_and_still_finds_its_older_copy():
    override, mock_session = make_mock_db()
    no_match = MagicMock()
    no_match.scalars.return_value.first.return_value = None
    mock_session.execute.return_value = no_match

    async def fake_refresh(obj):
        obj.id, obj.status = uuid.uuid4(), "not_applied"
        obj.created_at = datetime.now(timezone.utc)

    mock_session.refresh = fake_refresh
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.post("/jd", json={"raw_text": AI, "title": "Engineer"}, headers=make_auth_header())
        assert r.status_code == 201
        saved = mock_session.add.call_args.args[0]
        assert isinstance(saved, JobDescription)
        assert saved.raw_text == plain_deep(AI).strip()
        # The duplicate lookup tries the text as pasted too: a JD saved
        # before plain_text existed still holds it.
        lookup = mock_session.execute.call_args_list[0].args[0]
        params = lookup.compile().params
        assert {AI.strip(), plain_deep(AI).strip()} <= {
            v for value in params.values() for v in (value if isinstance(value, (list, tuple, set)) else [value])
        }
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_a_tailoring_run_saved_before_reads_back_plain():
    override, mock_session = make_mock_db()
    row = TailoringSession(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), resume_id=uuid.uuid4(), jd_id=uuid.uuid4(),
        status="completed", tailored_content=DIRTY,
        ats_fixes=[{"id": "f1", "type": "bullet", "gap": "x", "text": AI}],
    )
    result = MagicMock()
    result.scalar_one_or_none.return_value = row
    mock_session.execute = AsyncMock(return_value=result)
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/ai/sessions/{row.id}", headers=make_auth_header())
        body = r.json()
        assert body["tailored_content"] == plain_deep(DIRTY)
        assert body["ats_fixes"][0]["text"] == plain_deep(AI)
    finally:
        app.dependency_overrides.pop(get_db, None)


# ── What the model writes ────────────────────────────────────────────────────

class _Bullet(BaseModel):
    text: str
    reasons: list[str]


class _Answer(BaseModel):
    bullets: list[_Bullet]
    note: str | None = None
    score: int = 0


@pytest.mark.asyncio
async def test_every_structured_model_answer_arrives_plain():
    from app.services.ai_engine import openai_provider
    from app.services.ai_engine.openai_provider import OpenAIProvider

    provider = OpenAIProvider(api_key="k", fast_model="m", premium_model="m",
                              standard_model="m", max_output_tokens=100, research_model="m")
    answer = _Answer(bullets=[_Bullet(text=AI, reasons=[AI])], note=AI, score=3)
    response = MagicMock(output_parsed=answer, usage=None, output=[])
    provider._client = MagicMock()
    provider._client.responses.parse = AsyncMock(return_value=response)
    original_budget = openai_provider.ensure_ai_budget
    openai_provider.ensure_ai_budget = AsyncMock()
    try:
        got = await provider.complete_structured("s", "u", _Answer)
        web, _ = await provider.complete_structured_with_web("s", "u", _Answer)
    finally:
        openai_provider.ensure_ai_budget = original_budget
    for result in (got, web):
        assert result.bullets[0].text == plain_deep(AI)
        assert result.bullets[0].reasons == [plain_deep(AI)]
        assert result.note == plain_deep(AI) and result.score == 3

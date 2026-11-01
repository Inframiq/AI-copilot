"""POST /resumes/{id}/ats-check — what an ATS reads out of the export.

Renders exactly what the download would, extracts its text and returns it
with services/ats_check.py's findings. Persists nothing, runs no model.
"""
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient, ASGITransport

pytest.importorskip("weasyprint")

from app.main import app  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.db.models import Resume  # noqa: E402
from tests.test_jd_and_tailor_endpoints import make_auth_header, make_mock_db, TEST_USER_ID  # noqa: E402

RESUME_ID = uuid.uuid4()
CONTENT = {
    "contact": {"name": "Jane Doe", "email": "jane@example.com", "phone": "+1 555 010 0100",
                "linkedin": "linkedin.com/in/janedoe", "linkedin_label": "LinkedIn"},
    "summary": "Backend engineer building payment systems for retail banks.",
    "experience": [{"title": "Engineer", "company": "Acme", "start": "06/2022", "end": "current",
                    "bullets": ["Responsible for the billing service."]}],
    "education": [{"degree": "B.S. Computer Science", "institution": "State U", "year": "2021", "gpa": "3.8"}],
    "skills": ["Python", "Go"],
}


def _resume(**overrides):
    return Resume(
        id=RESUME_ID, user_id=uuid.UUID(TEST_USER_ID), title="R", content=CONTENT,
        template_id="ats_clean", line_spacing=1.15, paragraph_spacing=12, font_choice="sans",
        accent_color=None, heading_size_delta=0, body_size_delta=0, page_size="A4",
        **overrides,
    )


async def _post(body=None, row_value="default", headers=None):
    override, session = make_mock_db()
    row = MagicMock()
    row.scalar_one_or_none.return_value = _resume() if row_value == "default" else row_value
    session.execute = AsyncMock(return_value=row)
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            return await c.post(
                f"/resumes/{RESUME_ID}/ats-check", json=body or {},
                headers=make_auth_header() if headers is None else headers,
            ), session
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_returns_the_extracted_text_and_findings():
    r, _ = await _post()
    assert r.status_code == 200, r.text
    data = r.json()
    lines = [line for line in data["text"].splitlines() if line.strip()]
    assert lines[0].strip() == "Jane Doe"
    # Printed as the address, dates tidied — what the parser now receives.
    assert "linkedin.com/in/janedoe" in data["text"]
    assert "Jun 2022" in data["text"] and "Present" in data["text"]
    assert data["page_count"] == 1
    ids = {f["id"] for f in data["findings"]}
    assert {"filler", "gpa-scale"} <= ids
    assert not [f for f in data["findings"] if f["level"] == "error"], data["findings"]


@pytest.mark.asyncio
async def test_a_content_override_is_checked_instead_of_the_saved_resume():
    r, _ = await _post({"content": {**CONTENT, "contact": {"name": "Override Name"}}})
    data = r.json()
    assert "Override Name" in data["text"]
    assert {"email-missing", "phone-missing"} <= {f["id"] for f in data["findings"]}


@pytest.mark.asyncio
async def test_it_persists_nothing():
    r, session = await _post({"template_id": "ats_modern", "page_size": "Letter"})
    assert r.status_code == 200
    session.commit.assert_not_called()


@pytest.mark.asyncio
async def test_a_photo_template_without_a_photo_is_a_409():
    r, _ = await _post({"template_id": "ats_portrait"})
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_it_404s_for_a_resume_the_caller_does_not_own():
    r, _ = await _post(row_value=None)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_it_rejects_an_unknown_template_and_page_size():
    assert (await _post({"template_id": "nope"}))[0].status_code == 422
    assert (await _post({"page_size": "Tabloid"}))[0].status_code == 422


@pytest.mark.asyncio
async def test_it_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post(f"/resumes/{RESUME_ID}/ats-check", json={})
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_it_runs_no_model_and_spends_no_credits():
    with patch("app.routers.resumes.spend_credits") as spend, \
         patch("app.routers.resumes.get_ai_provider") as provider:
        r, _ = await _post()
    assert r.status_code == 200
    spend.assert_not_called()
    provider.assert_not_called()


def _jd_row(user_id=TEST_USER_ID, parsed="default"):
    from app.db.models import JobDescription
    agent1 = {
        "exact_technical_tools": ["Kubernetes"], "methodologies_and_frameworks": [],
        "domain_expertise_themes": [], "seniority_indicators": [], "ats_filter_phrases": [],
        "target_job_titles": ["Platform Engineer"], "importance": {"kubernetes": "high"},
    }
    return JobDescription(id=uuid.uuid4(), user_id=uuid.UUID(user_id), raw_text="jd",
                          parsed={"agent1": agent1} if parsed == "default" else parsed)


async def _post_with_jd(jd_row):
    override, session = make_mock_db()
    resume_row, jd_result = MagicMock(), MagicMock()
    resume_row.scalar_one_or_none.return_value = _resume()
    jd_result.scalar_one_or_none.return_value = jd_row
    session.execute = AsyncMock(side_effect=[resume_row, jd_result])
    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            return await c.post(
                f"/resumes/{RESUME_ID}/ats-check?jd_id={uuid.uuid4()}",
                json={"content": {**CONTENT, "skills": ["Python", "Go", "Kubernetes"]}},
                headers=make_auth_header(),
            )
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_with_a_jd_the_tailoring_checks_run_on_its_stored_analysis():
    with patch("app.routers.resumes.get_ai_provider") as provider:
        r = await _post_with_jd(_jd_row())
    assert r.status_code == 200, r.text
    ids = {f["id"] for f in r.json()["findings"]}
    assert {"skill-not-shown", "title-not-mentioned"} <= ids
    provider.assert_not_called()


@pytest.mark.asyncio
async def test_a_jd_never_analysed_adds_nothing_and_calls_no_model():
    with patch("app.routers.resumes.get_ai_provider") as provider:
        r = await _post_with_jd(_jd_row(parsed={}))
    assert r.status_code == 200
    assert not {"skill-not-shown", "title-not-mentioned"} & {f["id"] for f in r.json()["findings"]}
    provider.assert_not_called()


@pytest.mark.asyncio
async def test_someone_elses_jd_is_a_404():
    # The query filters on the caller's id, so another user's JD reads as none.
    r = await _post_with_jd(None)
    assert r.status_code == 404

"""JDOut.parsed_skills — the JD page's "Skills from JD" list.

It used to come from a separate legacy LLM call (extract_jd_skills) whose
output sat beside Agent 1's on the same page and disagreed with it: a skill
could appear under "Skills from JD" yet in neither the Matched nor the Not
Matched column. Same JD, two extractions, one extra paid call per JD created.
It now derives from Agent 1, so the page shows one consistent set.
"""
from app.schemas.jd import JDOut
import uuid
from datetime import datetime, timezone


def _jd(parsed):
    return JDOut(
        id=uuid.uuid4(), user_id=uuid.uuid4(), title="T", raw_text="x",
        parsed=parsed, status="saved", created_at=datetime.now(timezone.utc),
    )


def test_it_derives_from_agent1_when_present():
    jd = _jd({"agent1": {
        "exact_technical_tools": ["Python"],
        "methodologies_and_frameworks": ["CI/CD"],
        "ats_filter_phrases": ["infrastructure as code"],
        "nice_to_have_skills": ["Go"],
        "domain_expertise_themes": [], "seniority_indicators": [],
        "core_responsibilities": [], "target_job_titles": [], "importance": {},
    }})
    assert jd.parsed_skills == ["Python", "CI/CD", "infrastructure as code", "Go"]


def test_it_does_not_leak_responsibilities_or_themes_into_the_chip_list():
    """Those are sentences, not skills — they would read as garbage chips."""
    jd = _jd({"agent1": {
        "exact_technical_tools": ["Python"], "methodologies_and_frameworks": [],
        "ats_filter_phrases": [], "nice_to_have_skills": [],
        "domain_expertise_themes": ["distributed systems"],
        "seniority_indicators": ["5+ years"],
        "core_responsibilities": ["own end-to-end delivery of the checkout pipeline"],
        "target_job_titles": ["Senior Engineer"], "importance": {},
    }})
    assert jd.parsed_skills == ["Python"]


def test_it_falls_back_to_the_legacy_shape_for_older_rows():
    jd = _jd({"required": ["Python"], "nice_to_have": ["Go"]})
    assert jd.parsed_skills == ["Python", "Go"]


def test_agent1_wins_when_a_row_carries_both():
    jd = _jd({
        "required": ["Stale"], "nice_to_have": [],
        "agent1": {
            "exact_technical_tools": ["Fresh"], "methodologies_and_frameworks": [],
            "ats_filter_phrases": [], "nice_to_have_skills": [],
            "domain_expertise_themes": [], "seniority_indicators": [],
            "core_responsibilities": [], "target_job_titles": [], "importance": {},
        },
    })
    assert jd.parsed_skills == ["Fresh"]


def test_an_unanalysed_jd_has_no_skills_rather_than_guessing():
    assert _jd({}).parsed_skills == []
    assert _jd(None).parsed_skills == []


def test_duplicates_across_agent1_buckets_are_collapsed():
    jd = _jd({"agent1": {
        "exact_technical_tools": ["Python"], "methodologies_and_frameworks": [],
        "ats_filter_phrases": ["Python"], "nice_to_have_skills": [],
        "domain_expertise_themes": [], "seniority_indicators": [],
        "core_responsibilities": [], "target_job_titles": [], "importance": {},
    }})
    assert jd.parsed_skills == ["Python"]


# ── Creating a JD no longer costs a model call ──────────────────────────────
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.db.session import get_db
from tests.test_jd_and_tailor_endpoints import make_auth_header, make_mock_db


@pytest.mark.asyncio
async def test_creating_a_jd_makes_no_model_call():
    """The only reason it ever did was the legacy extractor, whose output the
    JD page no longer uses. Agent 1 runs later, on Analyze, and feeds both the
    chip list and the match columns."""
    from app.db.models import JobDescription
    from datetime import datetime, timezone as _tz

    override, mock_session = make_mock_db()
    # The dedup lookup must find nothing, or the route short-circuits and
    # returns the "existing" row instead of creating one.
    no_match = MagicMock()
    no_match.scalar_one_or_none.return_value = None
    no_match.scalars.return_value.first.return_value = None
    mock_session.execute = AsyncMock(return_value=no_match)

    async def fake_refresh(obj):
        obj.id = uuid.uuid4()
        obj.created_at = datetime.now(_tz.utc)
        obj.status = "saved"

    mock_session.refresh = fake_refresh

    app.dependency_overrides[get_db] = override
    try:
        # The router no longer imports get_ai_provider at all, so patch the
        # factory itself and assert nothing ever reached for a provider.
        with patch("app.services.ai_engine.factory.get_ai_provider") as factory:
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                r = await c.post("/jd", json={"raw_text": "Need Python and Kubernetes."},
                                 headers=make_auth_header())
        assert r.status_code in (200, 201), r.text
        assert r.json()["parsed_skills"] == []
        factory.assert_not_called()
    finally:
        app.dependency_overrides.pop(get_db, None)

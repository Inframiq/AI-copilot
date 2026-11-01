"""The job post's soft skills, years and advanced degree (the ATS reference's
job-match table, section 9), and the résumé-quality checks (its Part B).

All of it is read in code: no model runs, nothing is charged, and the
requirements never reach a model's input.
"""
import uuid
from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.services.ats import score_content
from app.services.ats_check import check_text
from app.services.jd_requirements import (
    JdRequirements,
    read_requirements,
    requirement_signals,
    resume_years,
    with_requirements,
)
from app.services.tailoring import JDAnalysis

TODAY = date(2026, 11, 1)


def _analysis(**overrides) -> JDAnalysis:
    base = dict(
        exact_technical_tools=["Python"], methodologies_and_frameworks=[], domain_expertise_themes=[],
        seniority_indicators=[], ats_filter_phrases=[], core_responsibilities=[], target_job_titles=[],
        nice_to_have_skills=[], importance={},
    )
    return JDAnalysis(**(base | overrides))


# ── Reading the post ────────────────────────────────────────────────────────

@pytest.mark.parametrize("text, years", [
    ("5+ years of professional software development experience", 5),
    ("3-5 yrs experience in data engineering", 3),
    ("Minimum of three years' experience in analytics", 3),
    ("Experience: 4 to 6 years", 4),
    ("5+ years of experience overall; 2+ years experience with AWS", 5),
    ("two years of hands-on experience", 2),
    ("5+ years of industry experience", 5),
    # No "experience", still stated as a floor or opening a requirement line.
    ("- 5+ years building production backend services", 5),
    ("- 3+ years managing engineering teams\n- Lead a team of 8-12 engineers", 3),
    ("At least 4 years in a sales role", 4),
    ("Requirements:\n• 2 years of Java", 2),
    # A company talking about itself.
    ("Acme has 20+ years in the industry. 3+ years of experience required.", 3),
    ("Serving clients for over 15 years with care.", None),
    ("Freshers welcome. 0-1 years.", None),
    ("We have been in business for 10 years.", None),
    ("Proficiency in Python and SQL", None),
])
def test_years_come_from_the_post_floor(text, years):
    assert read_requirements(text).min_years == years


@pytest.mark.parametrize("text, degree", [
    ("Master's degree in Computer Science or a related field.", "master"),
    ("M.Tech or MBA required.", "master"),
    ("PhD in Machine Learning.", "doctorate"),
    ("PhD or Master's in Statistics required.", "master"),
    # An alternative, a preference or "equivalent" is no requirement.
    ("Bachelor's or Master's degree in CS.", None),
    ("M.S. or B.S. in Computer Science.", None),
    ("Bachelor's degree required. Master's preferred.", None),
    ("PhD is a plus.", None),
    ("Master's degree or equivalent experience.", None),
    ("B.Tech in any branch.", None),
    ("Must be in office three days a week.", None),
])
def test_an_advanced_degree_only_when_required(text, degree):
    assert read_requirements(text).advanced_degree == degree


def test_soft_skills_in_the_order_the_post_names_them():
    text = "A team player with strong communication skills, a problem-solving mindset and attention to detail."
    assert read_requirements(text).soft_skills == ["teamwork", "communication", "problem solving", "attention to detail"]


def test_words_that_merely_occur_are_not_soft_skills():
    text = "Flexible hours. Must be in office. Leading fintech company. We present a great culture."
    assert read_requirements(text).soft_skills == []


def test_with_requirements_reads_once():
    a = with_requirements(_analysis(), "Strong communication skills")
    assert a.requirements.soft_skills == ["communication"]
    assert with_requirements(a, "Leadership required").requirements.soft_skills == ["communication"]


# ── Years on the résumé ─────────────────────────────────────────────────────

def test_years_merge_overlaps_and_skip_internships():
    content = {"experience": [
        {"title": "Engineer", "company": "A", "start": "Jan 2020", "end": "Dec 2022"},
        {"title": "Senior Engineer", "company": "B", "start": "Jun 2022", "end": "Present"},
        {"title": "Software Intern", "company": "C", "start": "Jan 2018", "end": "Dec 2019"},
    ]}
    # Jan 2020 – Nov 2026, counted once: 83 months.
    assert resume_years(content, TODAY) == 6.9


def test_years_unknown_when_no_date_reads_and_zero_with_no_roles():
    assert resume_years({"experience": [{"title": "E", "start": "Summer", "end": ""}]}, TODAY) is None
    assert resume_years({"experience": []}, TODAY) == 0.0
    assert resume_years({"experience": [{"title": "Intern", "start": "Jan 2025", "end": "Jun 2025"}]}, TODAY) == 0.0


# ── Scoring ─────────────────────────────────────────────────────────────────

CONTENT = {
    "skills": ["Python"],
    "experience": [{"title": "Engineer", "company": "A", "start": "Jan 2023", "end": "Present",
                    "bullets": ["Led a team of four building Python services"]}],
    "education": [{"degree": "B.Tech Computer Science", "year": "2022"}],
}


def test_no_requirements_scores_exactly_as_before():
    """A JD analysed before this existed (or a test double) carries none:
    the score is unchanged, so nothing old shifts on its own."""
    before = score_content(CONTENT, _analysis(), {}).ats_score
    assert score_content(CONTENT, _analysis(requirements=JdRequirements()), {}).ats_score == before == 100


def test_requirements_move_the_score_by_their_weights():
    req = JdRequirements(soft_skills=["leadership", "negotiation"], min_years=8, advanced_degree="master")
    signals = requirement_signals(CONTENT, req, TODAY)
    assert signals == [(0.5, "matched"), (0.5, "missing"), (1.5, "missing"), (1.5, "missing")]
    # Python (1.0) + leadership (0.5) of 1.0 + 0.5 + 0.5 + 1.5 + 1.5.
    assert score_content(CONTENT, _analysis(requirements=req), {}).ats_score == round(100 * 1.5 / 5.0)


def test_many_soft_skills_share_one_budget():
    req = JdRequirements(soft_skills=["communication", "teamwork", "leadership", "negotiation",
                                      "creativity", "prioritization", "mentoring", "ownership"])
    weights = [w for w, _ in requirement_signals(CONTENT, req, TODAY)]
    assert sum(weights) == pytest.approx(2.0)


def test_a_degree_in_progress_is_partial():
    content = {**CONTENT, "education": [{"degree": "M.Tech", "year": "Expected May 2027"}]}
    assert requirement_signals(content, JdRequirements(advanced_degree="master"), TODAY) == [(1.5, "partial")]


def test_unreadable_dates_leave_years_out_rather_than_fail_them():
    content = {**CONTENT, "experience": [{"title": "E", "start": "Summer", "end": "Fall", "bullets": []}]}
    assert requirement_signals(content, JdRequirements(min_years=3), TODAY) == []


def test_requirements_never_reach_a_model():
    """Every model payload carries jd_analysis.model_dump(): the reading
    must not be in it, or a prompt input changed without anyone agreeing."""
    a = with_requirements(_analysis(), "5+ years of experience. Master's degree. Strong communication.")
    assert a.requirements.min_years == 5
    assert "requirements" not in a.model_dump()
    assert "requirements" not in a.model_dump_json()


@pytest.mark.asyncio
async def test_analysis_reads_requirements_on_the_cached_path_too():
    from app.services.tailoring import analyze_jd_match

    provider = MagicMock()
    result = await analyze_jd_match(
        CONTENT, "Need 8+ years of experience and strong negotiation skills.", provider,
        cached_jd_analysis=_analysis(), cached_semantic_verdicts={},
    )
    assert result.jd_analysis.requirements == JdRequirements(soft_skills=["negotiation"], min_years=8)
    assert result.ats_score < 100
    provider.assert_not_called()


# ── project-score re-scores on the session's own footing ────────────────────

def _session(stored_requirements):
    from app.db.models import JobDescription, TailoringSession

    jd = JobDescription(
        id=uuid.uuid4(), user_id=uuid.UUID(_user()), title="T",
        raw_text="Python. 10+ years of experience.",
        parsed={"agent1": _analysis().model_dump(), "semantic": {"fingerprint": "x", "verdicts": {}}},
        status="applied",
    )
    sess = TailoringSession(
        id=uuid.uuid4(), user_id=uuid.UUID(_user()), jd_id=jd.id, status="completed", ats_score=100,
        matched_skills=[], missing_skills=[], company_keywords=[], suggested_skills=[], ats_fixes=[],
        tailored_content=CONTENT,
        score_verdicts={"before": {}, "after": {}, "requirements": stored_requirements},
    )
    return sess, jd


def _user():
    from tests.test_jd_and_tailor_endpoints import TEST_USER_ID
    return TEST_USER_ID


async def _project(sess, jd):
    from app.db.session import get_db
    from app.main import app
    from tests.test_jd_and_tailor_endpoints import make_auth_header, make_mock_db

    override, mock_session = make_mock_db()
    res, jd_res = MagicMock(), MagicMock()
    res.scalar_one_or_none.return_value = sess
    jd_res.scalar_one_or_none.return_value = jd
    mock_session.execute = AsyncMock(side_effect=[res, jd_res])
    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.get_ai_provider", return_value=MagicMock()):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post("/ai/project-score", json={"session_id": str(sess.id), "accepted_fix_ids": []},
                                      headers=make_auth_header())
    finally:
        app.dependency_overrides.pop(get_db, None)
    assert r.status_code == 200, r.text
    return r.json()["projected_score"]


@pytest.mark.asyncio
async def test_project_score_uses_the_requirements_its_session_scored_with():
    sess, jd = _session(JdRequirements(min_years=10).model_dump())
    # Python matched (1.0); 3.8 years of 10 missing (1.5).
    assert await _project(sess, jd) == 40


@pytest.mark.asyncio
async def test_a_session_from_before_requirements_is_rescored_without_them():
    """Its "before" was scored without them; projecting with them would
    show a jump the user's edits never made."""
    sess, jd = _session(None)
    assert await _project(sess, jd) == 100


# ── The ATS check, against a post and on its own ────────────────────────────

def test_check_against_jd_says_what_falls_short():
    from app.services.ats_check import check_against_jd

    a = with_requirements(
        _analysis(),
        "10+ years of experience. Master's degree in CS required. Strong negotiation and leadership skills.",
    )
    findings = {f.id: f.message for f in check_against_jd(CONTENT, a)}
    assert findings["soft-skill-not-shown"] == (
        "The job asks for negotiation, and no point shows it. Where it is true, show it in a point."
    )
    assert "10+ years" in findings["years-short"]
    assert findings["degree-missing"] == "The job asks for a master's degree; Education shows none."


TEXT = "Asha Rao\na@x.com | +91 98765 43210"


def _quality(content, **kw):
    base = {"contact": {"name": "Asha Rao", "email": "a@x.com", "phone": "+91 98765 43210"},
            "skills": ["Python"], "education": [{"degree": "B.Tech", "year": "2022"}]}
    return {(f.id, f.field) for f in check_text(base | content, TEXT, **kw) if f.level == "warning"}


def _job(*bullets):
    return {"experience": [{"title": "Engineer", "company": "A", "start": "Jan 2023", "end": "Present",
                            "bullets": list(bullets)}]}


def test_strong_points_raise_no_quality_warnings():
    found = _quality(_job(
        "Built a billing service handling 2 million payments a month",
        "Cut deploy time from 40 minutes to 6 by moving builds to cached runners",
        "Led four engineers through a Postgres 16 upgrade with zero downtime",
    ))
    assert found == set()


def test_points_without_numbers():
    found = _quality(_job(
        "Built the billing service for retail customers",
        "Moved builds onto cached runners for the whole team",
        "Upgraded the main Postgres cluster without downtime",
    ))
    assert ("few-numbers", None) in found


def test_weak_openers_passive_voice_and_first_person():
    found = _quality(_job(
        "Helped the team ship 3 releases each quarter",
        "The API was redesigned to cut latency by 30%",
        "I built my own test harness covering 200 cases",
    ))
    assert ("weak-opener", "experience.0.bullets.0") in found
    assert ("passive-voice", "experience.0.bullets.1") in found
    assert ("first-person", "experience.0.bullets.2") in found


def test_responsible_for_keeps_its_own_finding_only():
    found = _quality(_job("Responsible for 3 payment services in production"))
    assert ("filler", "experience.0.bullets.0") in found
    assert ("weak-opener", "experience.0.bullets.0") not in found


def test_passive_voice_skips_adjectives():
    found = _quality(_job("Was responsible for 3 services", "Is based in 2 offices across India"))
    assert not {f for f in found if f[0] == "passive-voice"}


def test_buzzwords_repeated_openers_and_length():
    long_point = "Developed " + " ".join(["the service"] * 22)
    found = _quality({
        "summary": "Passionate, results-driven engineer.",
        **_job("Developed 1 tool", "Developed 2 tools for the data team", "Developed 3 tools for finance",
               "Developed 4 tools for the support team", long_point),
    })
    assert ("buzzwords", None) in found
    assert ("repeated-opener", "experience.0.bullets.0") in found
    assert ("point-too-short", "experience.0.bullets.0") in found
    assert ("point-too-long", "experience.0.bullets.4") in found


def test_page_count_by_template_set():
    one = _job("Built 2 services for the payments team")
    assert ("too-long", None) in _quality(one, template_id="student_clean", page_count=2)
    assert ("too-long", None) not in _quality(one, template_id="ats_clean", page_count=2)
    assert ("too-long", None) in _quality(one, template_id="ats_clean", page_count=3)


def test_missing_sections():
    found = {(f.id, f.field) for f in check_text({"contact": {"name": "Asha Rao"}}, TEXT)}
    assert {("skills-missing", "skills"), ("education-missing", "education"), ("work-missing", "experience")} <= found


def test_quality_checks_are_never_errors():
    """They are writing points: a parser loses nothing over them, and the
    template guard tests (errors only) must stay about readability."""
    content = {"contact": {"name": "Asha Rao", "email": "a@x.com", "phone": "+91 98765 43210"},
               "summary": "I am a passionate go-getter.",
               **_job("Helped", "Was given 1 task", "my work")}
    quality = {"few-numbers", "weak-opener", "repeated-opener", "passive-voice", "first-person", "buzzwords",
               "point-too-long", "point-too-short", "too-long", "skills-missing", "education-missing", "work-missing"}
    for f in check_text(content, TEXT, "student_clean", 3):
        if f.id in quality:
            assert f.level == "warning", f

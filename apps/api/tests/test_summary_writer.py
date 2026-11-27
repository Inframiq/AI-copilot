"""The professional summary writer (services/summary_writer.py): the facts
code works out, the checks that decide whether a draft starts switched on,
the retry, and its place in the tailoring run."""
from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.summary_writer import (
    SummaryDraft, summary_facts, summary_problems, write_summary,
)
from app.services.tailoring import JDAnalysis

TODAY = date(2026, 11, 23)

JAVA = {
    "contact": {"name": "Test Candidate", "phone": "+91 98765 43210"},
    "headline": "Software Engineer | Java, Spring Boot",
    "experience": [
        {"company": "Infosys", "title": "Senior Systems Engineer", "start": "Jul 2021", "end": "Present",
         "bullets": ["Built REST APIs for the inventory system used by 400 stores.",
                     "Cut the nightly stock sync from 3 hours to 40 minutes."]},
        {"company": "Wipro", "title": "Project Engineer", "start": "Jun 2019", "end": "Jun 2021",
         "bullets": ["Maintained Java batch jobs for an insurance client."]},
    ],
    "skills": ["Java", "Spring Boot", "Kafka", "Oracle"],
}
DA = {
    "experience": [{"company": "Acme", "title": "Data Analyst", "start": "Jan 2022", "end": "Present",
                    "bullets": ["Gathered reporting requirements from 5 business teams.",
                                "Built Power BI dashboards on SQL Server."]}],
    "skills": ["SQL", "Power BI"],
}


def _jd(titles, tools=(), methods=(), resp=()):
    return JDAnalysis(
        exact_technical_tools=list(tools), methodologies_and_frameworks=list(methods),
        domain_expertise_themes=[], seniority_indicators=[], ats_filter_phrases=[],
        target_job_titles=list(titles), core_responsibilities=list(resp),
    )


def _facts(content):
    with patch("app.services.jd_requirements.date") as d:
        d.today.return_value = TODAY
        return summary_facts(content)


# ── facts: years and career stage come from code, not the model ─────────────

def test_years_and_stage_from_the_job_dates():
    f = _facts(JAVA)
    assert f.years == 7.5 and f.years_phrase == "7+ years"
    assert f.stage == "mid" and (f.min_words, f.max_words) == (50, 65)


@pytest.mark.parametrize("content,stage", [
    ({"experience": [], "education": [{"degree": "B.Tech"}]}, "fresher"),
    ({"experience": [{"title": "Software Intern", "start": "May 2025", "end": "Jul 2025"}]}, "fresher"),
    (DA, "early"),
    ({"experience": [{"title": "Director of Operations", "start": "Jan 2020", "end": "Present"}]}, "senior"),
    ({"experience": [{"title": "Plant Manager", "start": "Jan 2008", "end": "Present"}]}, "senior"),
])
def test_career_stage_sets_the_word_band(content, stage):
    assert _facts(content).stage == stage


def test_no_years_phrase_under_a_year_or_without_dates():
    assert _facts({"experience": [{"title": "Intern", "start": "May 2025", "end": "Jul 2025"}]}).years_phrase == ""
    assert _facts({"experience": [{"title": "Analyst"}]}).years_phrase == ""


# ── checks ───────────────────────────────────────────────────────────────────

GOOD = (
    "Senior Systems Engineer with 7+ years building Java services for retail and insurance clients. "
    "Built REST APIs used by 400 stores and cut the nightly stock sync from 3 hours to 40 minutes. "
    "Brings Java, Spring Boot and Kafka to backend work."
)


def test_a_clean_summary_passes():
    assert summary_problems(GOOD, JAVA, _facts(JAVA), _jd(["Backend Engineer"], ["Java", "Kafka"])) == []


@pytest.mark.parametrize("text,reason", [
    (GOOD.replace("7+ years", "10+ years"), "more than the job dates"),
    (GOOD.replace("400 stores", "450 stores"), "number that isn't on the résumé: 450"),
    (GOOD.replace("Kafka to", "Kafka and Docker to"), "names Docker"),
    (GOOD.replace("Senior Systems Engineer", "Principal Engineer"), "level (principal)"),
    (GOOD.replace("Brings", "I bring"), '"I"'),
    (GOOD.replace("Brings", "Results-driven, brings"), "filler words: results-driven"),
    (GOOD + " Maintained Java batch jobs for an insurance client across many releases."
     " Works with Oracle and Spring Boot every day on the inventory system for stores."
     " Reviews code for the team.", "over the 65-word limit"),
    (GOOD.replace(". Built", "\nBuilt"), "single paragraph"),
    ("Engineer.", "too short"),
])
def test_each_check_names_its_problem(text, reason):
    jd = _jd(["Backend Engineer"], ["Java", "Kafka", "Docker"])
    problems = summary_problems(text, JAVA, _facts(JAVA), jd)
    assert any(reason in p for p in problems), problems


def test_words_lifted_from_the_posting_are_flagged():
    jd = _jd(["Backend Engineer"], ["Java"], resp=["Design payment microservices"])
    text = GOOD.replace("to backend work", "to designing payment microservices")
    problems = summary_problems(text, JAVA, _facts(JAVA), jd)
    assert any("designing" in p and "microservices" in p for p in problems), problems


def test_a_different_job_opens_with_the_candidates_own_role():
    jd = _jd(["Business Analyst"], ["SQL"], resp=["Gather requirements"])
    own = ("Data Analyst with 4+ years gathering reporting requirements from 5 business teams. "
           "Built Power BI dashboards on SQL Server. Moving into Business Analyst work, bringing SQL.")
    claimed = own.replace("Data Analyst with", "Business Analyst with", 1)
    assert summary_problems(own, DA, _facts(DA), jd) == []
    assert any("target job title" in p for p in summary_problems(claimed, DA, _facts(DA), jd))
    # the same job under another name may open with the post's wording
    assert not any("target job title" in p for p in summary_problems(claimed, DA, _facts(DA), jd, same_role=True))


def test_numbers_and_later_words_are_not_read_as_a_level():
    text = GOOD.replace("Senior Systems Engineer with 7+ years", "Systems Engineer with 7+ years leading 2 staff")
    content = {**JAVA, "experience": [{**JAVA["experience"][0], "title": "Systems Engineer"}] + JAVA["experience"][1:]}
    assert not any("level" in p for p in summary_problems(text, content, _facts(content), None))


def test_contact_details_are_not_evidence():
    text = GOOD.replace("400 stores", "98765 stores")
    assert any("98765" in p for p in summary_problems(text, JAVA, _facts(JAVA), None))


# ── the writer: one retry with the problems, never raises ───────────────────

def _provider(*drafts):
    p = MagicMock()
    p.complete_structured = AsyncMock(side_effect=list(drafts))
    return p


@pytest.mark.asyncio
async def test_a_refused_draft_is_retried_with_its_problems():
    bad = SummaryDraft(summary=GOOD.replace("400 stores", "450 stores"))
    p = _provider(bad, SummaryDraft(summary=GOOD))
    r = await write_summary(JAVA, p, _jd(["Backend Engineer"], ["Java"]))
    assert r.text == GOOD and r.problems == []
    retry_payload = p.complete_structured.call_args_list[1].args[1]
    assert "<fix_these>" in retry_payload and "450" in retry_payload
    assert p.complete_structured.call_args_list[0].kwargs["model_tier"] == "premium"


@pytest.mark.asyncio
async def test_still_refused_after_the_retry_comes_back_with_its_problems():
    bad = SummaryDraft(summary=GOOD.replace("400 stores", "450 stores"))
    r = await write_summary(JAVA, _provider(bad, bad), None)
    assert r.text and any("450" in x for x in r.problems)


@pytest.mark.asyncio
async def test_a_model_failure_gives_no_summary():
    p = MagicMock()
    p.complete_structured = AsyncMock(side_effect=RuntimeError("down"))
    r = await write_summary(JAVA, p, None)
    assert r.text == "" and r.problems == []


@pytest.mark.asyncio
async def test_the_model_never_sees_contact_details():
    p = _provider(SummaryDraft(summary=GOOD))
    await write_summary(JAVA, p, None)
    payload = p.complete_structured.call_args.args[1]
    assert "Test Candidate" not in payload and "98765" not in payload


# ── in the tailoring run ─────────────────────────────────────────────────────

def _pipeline_provider(summary_drafts):
    from app.services.tailoring import (
        GapFillerOutput, InterviewQuestionsWrapper, MappingPlan, WriterOutput, _JDAnalysisWire,
    )
    responses = {
        _JDAnalysisWire: _jd(["Backend Engineer"], ["Java", "Kafka"]),
        MappingPlan: MappingPlan(mapping_plan=[], plausible_skills_to_add=[]),
        WriterOutput: WriterOutput(rewritten_bullets=[], updated_skills=[]),
        GapFillerOutput: GapFillerOutput(),
        InterviewQuestionsWrapper: InterviewQuestionsWrapper(questions=[]),
    }
    drafts = list(summary_drafts)
    p = MagicMock()

    async def fake(system, user, schema, **kw):
        if schema is SummaryDraft:
            return drafts.pop(0)
        return responses[schema]

    p.complete_structured = AsyncMock(side_effect=fake)
    return p


def _db():
    s = MagicMock()
    r = MagicMock()
    r.scalars.return_value.all.return_value = []
    s.execute = AsyncMock(return_value=r)
    s.commit = AsyncMock()
    return s


@pytest.mark.asyncio
async def test_tailoring_puts_a_checked_summary_in_the_tailored_resume():
    from app.services.tailoring import run_tailoring_pipeline
    result = await run_tailoring_pipeline(
        JAVA, "Backend Engineer, Java, Kafka", 50, _pipeline_provider([SummaryDraft(summary=GOOD)]), _db(),
    )
    assert result.tailored_content["summary"] == GOOD
    assert not any(r["bullet_id"] == "summary" for r in result.reverted_bullets)


@pytest.mark.asyncio
async def test_tailoring_flags_a_summary_the_checks_refused():
    from app.services.tailoring import run_tailoring_pipeline
    bad = SummaryDraft(summary=GOOD.replace("400 stores", "450 stores"))
    result = await run_tailoring_pipeline(
        JAVA, "Backend Engineer, Java, Kafka", 50, _pipeline_provider([bad, bad]), _db(),
    )
    assert result.tailored_content["summary"] == bad.summary
    flag = next(r for r in result.reverted_bullets if r["bullet_id"] == "summary")
    assert any("450" in x for x in flag["reasons"])


# ── POST /ai/write-summary: the Builder's button, 3 credits ─────────────────

from httpx import ASGITransport, AsyncClient

from app.core.credits import CREDIT_COSTS
from app.db.session import get_db
from app.main import app
from tests.test_jd_and_tailor_endpoints import TEST_USER_ID, make_auth_header, make_mock_db


async def _post_summary(ledger, content, provider, credits=50):
    ledger.set(TEST_USER_ID, credits)
    override, _ = make_mock_db()
    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.get_ai_provider", return_value=provider):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post("/ai/write-summary", json={"content": content}, headers=make_auth_header())
    finally:
        app.dependency_overrides.pop(get_db, None)
    return r, ledger.balance(TEST_USER_ID)


def test_write_summary_costs_three_credits():
    assert CREDIT_COSTS["write_summary"] == 3


@pytest.mark.asyncio
async def test_write_summary_charges_and_returns_the_draft(ledger):
    p = _provider(SummaryDraft(summary=GOOD))
    r, balance = await _post_summary(ledger, JAVA, p)
    assert r.status_code == 200 and r.json() == {"summary": GOOD, "problems": []}
    assert balance == 50 - 3
    assert "Test Candidate" not in p.complete_structured.call_args.args[1]


@pytest.mark.asyncio
async def test_write_summary_returns_a_refused_draft_with_its_problems(ledger):
    bad = SummaryDraft(summary=GOOD.replace("400 stores", "450 stores"))
    r, balance = await _post_summary(ledger, JAVA, _provider(bad, bad))
    assert r.status_code == 200 and any("450" in x for x in r.json()["problems"])
    assert balance == 47


@pytest.mark.asyncio
async def test_write_summary_refunds_when_the_model_fails(ledger):
    p = MagicMock()
    p.complete_structured = AsyncMock(side_effect=RuntimeError("down"))
    r, balance = await _post_summary(ledger, JAVA, p)
    assert r.status_code == 503 and "credits were returned" in r.json()["detail"]
    assert balance == 50


@pytest.mark.asyncio
async def test_write_summary_needs_something_to_write_from(ledger):
    p = _provider(SummaryDraft(summary=GOOD))
    r, balance = await _post_summary(ledger, {"skills": ["Java"]}, p)
    assert r.status_code == 422 and balance == 50
    p.complete_structured.assert_not_called()


@pytest.mark.asyncio
async def test_write_summary_out_of_credits(ledger):
    p = _provider(SummaryDraft(summary=GOOD))
    r, balance = await _post_summary(ledger, JAVA, p, credits=2)
    assert r.status_code == 402 and balance == 2
    p.complete_structured.assert_not_called()


# ── the review's "Rewrite for this job": the same endpoint with session_id ──

from fastapi import HTTPException

SESSION_ID = "11111111-1111-1111-1111-111111111111"


async def _post_for_job(ledger, provider, lookup):
    ledger.set(TEST_USER_ID, 50)
    override, _ = make_mock_db()
    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.get_ai_provider", return_value=provider), \
             patch("app.routers.ai._completed_session_jd", lookup):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(
                    "/ai/write-summary", json={"content": JAVA, "session_id": SESSION_ID},
                    headers=make_auth_header(),
                )
    finally:
        app.dependency_overrides.pop(get_db, None)
    return r, ledger.balance(TEST_USER_ID)


@pytest.mark.asyncio
async def test_rewrite_for_this_job_writes_for_the_runs_job(ledger):
    jd = _jd(["Senior Java Developer"], ["Java", "Kafka"])
    lookup = AsyncMock(return_value=(None, None, jd))
    p = _provider(SummaryDraft(summary=GOOD))
    r, balance = await _post_for_job(ledger, p, lookup)
    assert r.status_code == 200 and balance == 47
    assert str(lookup.call_args.args[2]) == SESSION_ID
    payload = p.complete_structured.call_args.args[1]
    assert '"target_role": "Senior Java Developer"' in payload


@pytest.mark.asyncio
async def test_rewrite_for_another_users_run_is_refused_for_free(ledger):
    lookup = AsyncMock(side_effect=HTTPException(status_code=404, detail="Completed session not found"))
    p = _provider(SummaryDraft(summary=GOOD))
    r, balance = await _post_for_job(ledger, p, lookup)
    assert r.status_code == 404 and balance == 50
    p.complete_structured.assert_not_called()


# ── the review's Humanize / custom rewrite: same writer, same checks ─────────
# 2026-11-24, the user's call: these used to be a 1-credit fast rewrite with
# no fact checks; now they rework the summary on the card through the
# summary writer, 3 credits.

from app.services.summary_writer import SUMMARY_SYSTEM, Rework, rework_request


@pytest.fixture(autouse=True)
def _fresh_rate_limit():
    # This file posts to /ai/write-summary (10 a minute) more than ten times.
    from app.core.rate_limit import limiter
    limiter.reset()
    yield
    limiter.reset()


async def _post_rework(ledger, provider, body, credits=50):
    ledger.set(TEST_USER_ID, credits)
    override, _ = make_mock_db()
    app.dependency_overrides[get_db] = override
    jd = _jd(["Senior Java Developer"], ["Java", "Kafka"])
    try:
        with patch("app.routers.ai.get_ai_provider", return_value=provider), \
             patch("app.routers.ai._completed_session_jd", AsyncMock(return_value=(None, None, jd))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(
                    "/ai/write-summary",
                    json={"content": JAVA, "session_id": SESSION_ID, **body},
                    headers=make_auth_header(),
                )
    finally:
        app.dependency_overrides.pop(get_db, None)
    return r, ledger.balance(TEST_USER_ID)


@pytest.mark.asyncio
async def test_a_custom_rewrite_reworks_the_card_summary_under_the_rules(ledger):
    p = _provider(SummaryDraft(summary=GOOD))
    r, balance = await _post_rework(ledger, p, {
        "rework": "custom", "current": "Engineer who builds APIs.", "instruction": "Mention Kafka first.",
    })
    assert r.status_code == 200 and r.json() == {"summary": GOOD, "problems": []}
    assert balance == 47
    system, payload = p.complete_structured.call_args.args[:2]
    # The system prompt is the one every summary uses, untouched.
    assert system == SUMMARY_SYSTEM
    assert "<current_summary>\nEngineer who builds APIs.\n</current_summary>" in payload
    assert "<candidate_request>\nMention Kafka first.\n</candidate_request>" in payload
    assert "keep to the rules" in payload


@pytest.mark.asyncio
async def test_a_rework_that_breaks_a_rule_is_retried_then_returned_with_its_problems(ledger):
    bad = SummaryDraft(summary=GOOD.replace("400 stores", "450 stores"))
    p = _provider(bad, bad)
    r, balance = await _post_rework(ledger, p, {
        "rework": "custom", "current": "Engineer.", "instruction": "Say 450 stores.",
    })
    assert r.status_code == 200 and any("450" in x for x in r.json()["problems"])
    assert p.complete_structured.call_count == 2 and balance == 47
    retry = p.complete_structured.call_args_list[1].args[1]
    assert "<candidate_request>" in retry and "<fix_these>" in retry


@pytest.mark.asyncio
async def test_humanize_sends_the_natural_wording_request(ledger):
    p = _provider(SummaryDraft(summary=GOOD))
    r, _ = await _post_rework(ledger, p, {"rework": "humanize", "current": "Engineer.", "humanize_level": 20})
    assert r.status_code == 200
    assert rework_request("humanize", 20) in p.complete_structured.call_args.args[1]
    assert rework_request("humanize", 20) != rework_request("humanize", 80)


@pytest.mark.parametrize("body", [
    {"rework": "humanize", "current": "   "},
    {"rework": "custom", "current": "Engineer.", "instruction": "  "},
])
@pytest.mark.asyncio
async def test_a_rework_with_nothing_to_work_on_is_refused_for_free(ledger, body):
    p = _provider(SummaryDraft(summary=GOOD))
    r, balance = await _post_rework(ledger, p, body)
    assert r.status_code == 422 and balance == 50
    p.complete_structured.assert_not_called()


@pytest.mark.asyncio
async def test_an_unknown_rework_mode_is_refused(ledger):
    p = _provider(SummaryDraft(summary=GOOD))
    r, balance = await _post_rework(ledger, p, {"rework": "rewrite", "current": "Engineer."})
    assert r.status_code == 422 and balance == 50


@pytest.mark.asyncio
async def test_a_fresh_summary_has_no_rework_block():
    p = _provider(SummaryDraft(summary=GOOD))
    await write_summary(JAVA, p, None)
    assert "<candidate_request>" not in p.complete_structured.call_args.args[1]
    p = _provider(SummaryDraft(summary=GOOD))
    await write_summary(JAVA, p, None, rework=Rework("Engineer.", "Shorter."))
    assert "<candidate_request>\nShorter.\n</candidate_request>" in p.complete_structured.call_args.args[1]


@pytest.mark.asyncio
async def test_the_old_one_call_summary_rewrite_is_closed(ledger):
    """rewrite-bullet used to rewrite the summary for 1 credit with no
    checks; it now refuses before charging."""
    ledger.set(TEST_USER_ID, 50)
    override, _ = make_mock_db()
    app.dependency_overrides[get_db] = override
    p = MagicMock()
    p.complete = AsyncMock(return_value="Anything.")
    try:
        with patch("app.routers.ai.get_ai_provider", return_value=p):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                for mode in ("rewrite", "humanize", "custom"):
                    r = await client.post("/ai/rewrite-bullet", json={
                        "bullet_text": "Engineer.", "mode": mode, "field": "summary",
                        "custom_instruction": "x",
                    }, headers=make_auth_header())
                    assert r.status_code == 422
    finally:
        app.dependency_overrides.pop(get_db, None)
    assert ledger.balance(TEST_USER_ID) == 50
    p.complete.assert_not_called()


# ── POST /ai/check-summary: the user's own summary against the guide, free ──

from app.services.summary_writer import style_problems

# The summary from the tester's screenshot (Kaggle ACCOUNTANT/14491649).
FLEXIBLE = (
    "Flexible accountant who adapts seamlessly to constantly evolving accounting processes and technology. "
    "Seasoned staff accountant with ten year background in accounting. Core competencies include detailed "
    "oriented, organized, and as well as excellent communication and time management skills. Handles tasks "
    "with accuracy and efficiency. Passionate and motivated, with a drive for excellence."
)


def test_the_guide_names_the_filler_in_a_users_own_summary():
    problems = style_problems(FLEXIBLE, _facts(JAVA))
    assert problems == ["uses filler words: detailed oriented, motivated, passionate, seasoned"]


def test_the_guide_leaves_a_clean_summary_alone_and_skips_fact_checks():
    # Its own figures and titles are the candidate's: not checked here.
    assert style_problems(GOOD.replace("400 stores", "450 stores"), _facts(JAVA)) == []
    assert style_problems("", _facts(JAVA)) == []


async def _check(ledger, body):
    ledger.set(TEST_USER_ID, 50)
    override, _ = make_mock_db()
    app.dependency_overrides[get_db] = override
    p = _provider()
    try:
        with patch("app.routers.ai.get_ai_provider", return_value=p):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post("/ai/check-summary", json=body, headers=make_auth_header())
    finally:
        app.dependency_overrides.pop(get_db, None)
    p.complete_structured.assert_not_called()
    return r, ledger.balance(TEST_USER_ID)


@pytest.mark.asyncio
async def test_check_summary_is_free_and_runs_no_model(ledger):
    r, balance = await _check(ledger, {"content": JAVA, "summary": "I am a " + FLEXIBLE})
    assert r.status_code == 200 and balance == 50
    body = r.json()
    assert '"I", "my" or "we"' in body["problems"][0]
    assert "seasoned" in body["problems"][1]
    assert body["min_words"] >= 30 and body["max_words"] <= 70


@pytest.mark.asyncio
async def test_check_summary_cleans_broken_encoding_first(ledger):
    r, _ = await _check(ledger, {"content": JAVA, "summary": GOOD.replace(" with", "\u00c2 with")})
    assert r.status_code == 200 and r.json()["problems"] == []


@pytest.mark.asyncio
async def test_check_summary_needs_sign_in():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post("/ai/check-summary", json={"content": JAVA, "summary": GOOD})
    assert r.status_code in (401, 403)

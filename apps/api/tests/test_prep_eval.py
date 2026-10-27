"""The interview prep eval: its check for answers that state details the
résumé never said, and the runner's wiring (with a fake provider — the live
run costs money and is a deliberate command, see evals/prep_runner.py)."""
import pytest

from app.services.eval_metrics import prep_set_report, unmarked_details
from app.services.tailoring import (
    InterviewQuestionData, InterviewQuestionsWrapper, JDMatchAnalysis, PrepAnswerData, PrepAnswersWrapper,
)
from evals.runner import Fixture
from tests.test_tailoring import make_jd_analysis, make_provider_dispatching_by_schema

RESUME = {
    "experience": [{
        "company": "Northwind Retail",
        "bullets": ["Migrated the checkout database from MySQL to PostgreSQL with zero downtime across 4M records"],
    }],
}
KNOWN = "Northwind Retail Migrated the checkout database from MySQL to PostgreSQL with zero downtime"


def test_an_invented_technique_stated_as_done_is_caught():
    # From a real set: none of this is on the résumé.
    answer = "Context: You used dual writes and change data capture to keep both databases in sync."
    assert set(unmarked_details(answer, KNOWN)) == {"dual writes", "change data capture"}


def test_an_invented_tool_mid_sentence_is_caught():
    answer = "Your choice: Automated builds and tests with Jenkins pipelines."
    assert unmarked_details(answer, KNOWN) == ["Jenkins"]


def test_a_detail_offered_as_an_example_is_not():
    answer = "Your choice: Describe the sequence; for example, dual writes, if that was your approach."
    assert unmarked_details(answer, KNOWN) == []


def test_a_hypothetical_design_answer_is_not():
    answer = "Approach: You would use caching and retries to keep latency under budget."
    assert unmarked_details(answer, KNOWN) == []


def test_what_the_resume_says_is_not():
    answer = "Context: At Northwind Retail you migrated from MySQL to PostgreSQL with zero downtime."
    assert unmarked_details(answer, KNOWN) == []


def test_a_sentence_start_is_not_taken_for_a_tool():
    answer = "Result: Delivered on time. Leadership agreed."
    assert unmarked_details(answer, KNOWN) == []


def test_set_report_counts_each_rule():
    questions = [
        {"question": "Why zero downtime over a maintenance window?",
         "likely_answer": "Context: You used dual writes."},
        {"question": "How did you do it, why, and what would break? And what next?",
         "likely_answer": "Situation: I led the migration."},
    ]
    report = prep_set_report(questions, RESUME)
    assert report["questions_total"] == 2
    assert report["answers_with_unmarked_details"] == 1
    assert report["unmarked_details"] == ["dual writes"]
    assert report["multi_ask_questions"] == 1
    assert report["first_person_answers"] == 1


@pytest.mark.asyncio
async def test_runner_scores_the_set_it_generates(monkeypatch):
    from evals import prep_runner

    async def fake_match(*args, **kwargs):
        return JDMatchAnalysis(jd_analysis=make_jd_analysis(), matched_skills=["PostgreSQL"],
                               missing_skills=["Kafka"], ats_score=50, company_keywords=[])

    monkeypatch.setattr(prep_runner, "analyze_jd_match", fake_match)
    provider = make_provider_dispatching_by_schema({
        InterviewQuestionsWrapper: InterviewQuestionsWrapper(questions=[
            InterviewQuestionData(source="overlap", basis="PostgreSQL", topic="Technical",
                                  question="Why zero downtime over a maintenance window?"),
        ]),
        PrepAnswersWrapper: PrepAnswersWrapper(answers=[
            PrepAnswerData(id=0, likely_answer="Context: You used dual writes.", follow_up="How?"),
        ]),
    })
    fixture = Fixture(name="f", description="d", jd_text="Need PostgreSQL.", resume_content=RESUME)

    out = await prep_runner.run_all([fixture], provider)

    row = out["fixtures"][0]
    assert row["questions_total"] == 1
    assert row["unmarked_details"] == ["dual writes"]
    assert out["aggregate"]["answers_with_unmarked_details"] == 1

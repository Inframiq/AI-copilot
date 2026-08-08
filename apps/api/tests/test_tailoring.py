import pytest
from unittest.mock import AsyncMock, MagicMock
from pydantic import BaseModel
from app.services.tailoring import (
    extract_jd_skills, ParsedJD,
    rewrite_bullets,
    generate_prep_questions, PrepQuestionData,
    run_tailoring_pipeline, TailoringResult,
)

def make_mock_provider(structured_return=None, complete_return=""):
    provider = MagicMock()
    provider.complete_structured = AsyncMock(return_value=structured_return)
    provider.complete = AsyncMock(return_value=complete_return)
    return provider

@pytest.mark.asyncio
async def test_extract_jd_skills_returns_parsed_jd():
    parsed = ParsedJD(required=["Python", "AWS"], nice_to_have=["Docker"])
    provider = make_mock_provider(structured_return=parsed)
    result = await extract_jd_skills("We need Python, AWS. Docker is a plus.", provider)
    assert isinstance(result, ParsedJD)
    assert "Python" in result.required

@pytest.mark.asyncio
async def test_rewrite_bullets_returns_dict():
    provider = make_mock_provider(complete_return='{"experience": [{"title": "Engineer", "bullets": ["Built APIs"]}]}')
    resume = {"experience": [{"title": "Engineer", "bullets": ["Built stuff"]}]}
    result = await rewrite_bullets(resume, ["Python"], 50, provider)
    assert isinstance(result, dict)

@pytest.mark.asyncio
async def test_generate_prep_questions_returns_list():
    questions = [PrepQuestionData(topic="AWS", question="How would you approach AWS?", answer_framework="Use STAR", is_gap_based=True, order_index=0)]
    provider = make_mock_provider(structured_return=MagicMock(questions=questions))
    result = await generate_prep_questions(["AWS"], {"experience": []}, provider)
    assert len(result) >= 1
    assert result[0].topic == "AWS"

@pytest.mark.asyncio
async def test_run_tailoring_pipeline_returns_result():
    parsed_jd = ParsedJD(required=["Python"], nice_to_have=[])
    questions_wrapper = MagicMock(questions=[
        PrepQuestionData(topic="AWS", question="Q?", answer_framework="A", is_gap_based=True, order_index=0)
    ])
    provider = MagicMock()
    provider.complete_structured = AsyncMock(side_effect=[parsed_jd, questions_wrapper])
    provider.complete = AsyncMock(return_value='{"experience": []}')
    resume = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}
    result = await run_tailoring_pipeline(resume, "Need Python and AWS exp.", 50, provider)
    assert isinstance(result, TailoringResult)
    assert result.ats_score >= 0

@pytest.mark.asyncio
async def test_run_tailoring_pipeline_dedupes_overlapping_skills():
    # "Python" appears in both required and nice_to_have — must not be
    # double-counted in the ats_score denominator or matched/missing lists
    parsed_jd = ParsedJD(required=["Python", "AWS"], nice_to_have=["python"])
    questions_wrapper = MagicMock(questions=[])
    provider = MagicMock()
    provider.complete_structured = AsyncMock(side_effect=[parsed_jd, questions_wrapper])
    provider.complete = AsyncMock(return_value='{"experience": []}')
    resume = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}]}
    result = await run_tailoring_pipeline(resume, "Need Python and AWS.", 50, provider)
    assert result.matched_skills.count("Python") == 1
    assert result.ats_score == 50  # 1 of 2 unique skills matched, not 1 of 3

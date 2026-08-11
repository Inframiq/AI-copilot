import pytest
from unittest.mock import AsyncMock, MagicMock
from app.services.tailoring import (
    extract_jd_skills, ParsedJD,
    generate_prep_questions, PrepQuestionData,
    run_tailoring_pipeline, TailoringResult,
    analyze_jd_match, JDMatchAnalysis,
    JDAnalysis, MappingPlan, BulletMapping,
    WriterOutput, RewrittenBullet, PrepQuestionsWrapper,
    _build_agent3_system,
)
from app.services.resume_spec import BANNED_GENERIC_PHRASES, HARD_LIMITS


def make_mock_provider(structured_return=None, complete_return=""):
    provider = MagicMock()
    provider.complete_structured = AsyncMock(return_value=structured_return)
    provider.complete = AsyncMock(return_value=complete_return)
    return provider


def make_provider_dispatching_by_schema(responses: dict[type, object]):
    """Real code calls provider.complete_structured(system, user, schema, model_tier=...)
    positionally for `schema` — dispatch on that instead of call order, since
    Agent 3 and generate_prep_questions run concurrently via asyncio.gather
    and their relative call order isn't guaranteed."""
    provider = MagicMock()

    async def fake_complete_structured(system, user, schema, model_tier="fast"):
        return responses[schema]

    provider.complete_structured = AsyncMock(side_effect=fake_complete_structured)
    return provider


def make_jd_analysis(**overrides) -> JDAnalysis:
    defaults = dict(
        exact_technical_tools=["Python"],
        methodologies_and_frameworks=[],
        domain_expertise_themes=[],
        seniority_indicators=[],
        ats_filter_phrases=[],
    )
    defaults.update(overrides)
    return JDAnalysis(**defaults)


@pytest.mark.asyncio
async def test_extract_jd_skills_returns_parsed_jd():
    parsed = ParsedJD(required=["Python", "AWS"], nice_to_have=["Docker"])
    provider = make_mock_provider(structured_return=parsed)
    result = await extract_jd_skills("We need Python, AWS. Docker is a plus.", provider)
    assert isinstance(result, ParsedJD)
    assert "Python" in result.required


@pytest.mark.asyncio
async def test_generate_prep_questions_returns_list():
    questions = [PrepQuestionData(topic="AWS", question="How would you approach AWS?", answer_framework="Use STAR", is_gap_based=True, order_index=0)]
    provider = make_mock_provider(structured_return=MagicMock(questions=questions))
    result = await generate_prep_questions(["AWS"], {"experience": []}, provider)
    assert len(result) >= 1
    assert result[0].topic == "AWS"


def test_agent3_system_prompt_enforces_length_and_bans_generic_phrases():
    """Agent 3's prompt is the only place bullet prose length is actually
    decided — this locks in the fix for "generated resumes are vague,
    overly verbose" without needing a real LLM call."""
    prompt = _build_agent3_system(50)
    bw = HARD_LIMITS["bullet_words"]
    assert str(bw["prefer_min"]) in prompt
    assert str(bw["prefer_max"]) in prompt
    assert str(bw["max"]) in prompt
    assert "hard maximum" in prompt.lower()
    for phrase in BANNED_GENERIC_PHRASES:
        assert phrase in prompt
    assert "NEVER FABRICATE" in prompt
    assert "do not invent" in prompt.lower()
    # No stray literal newline mid-sentence from a missing line-continuation.
    assert "should have — \nbullet-count" not in prompt
    assert "should have — bullet-count" in prompt


@pytest.mark.asyncio
async def test_analyze_jd_match_dedupes_overlapping_skills():
    # "Python" appears in both exact_technical_tools and ats_filter_phrases
    # (different casing) — must not be double-counted in the ats_score
    # denominator or matched/missing lists.
    jd_analysis = make_jd_analysis(
        exact_technical_tools=["Python", "AWS"],
        ats_filter_phrases=["python"],
    )
    provider = make_mock_provider(structured_return=jd_analysis)
    resume = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}

    result = await analyze_jd_match(resume, "Need Python and AWS.", provider)

    assert isinstance(result, JDMatchAnalysis)
    assert result.matched_skills.count("Python") == 1
    assert result.ats_score == 50  # 1 of 2 unique skills matched, not 1 of 3


@pytest.mark.asyncio
async def test_run_tailoring_pipeline_returns_result():
    responses = {
        JDAnalysis: make_jd_analysis(exact_technical_tools=["Python"]),
        MappingPlan: MappingPlan(
            mapping_plan=[
                BulletMapping(
                    original_bullet_id="exp0_b0",
                    original_text="Used Python",
                    target_jd_keywords_to_inject=["Python"],
                    preserved_metrics=[],
                    strategic_instruction="REINFORCE",
                )
            ],
            plausible_skills_to_add=[],
        ),
        WriterOutput: WriterOutput(
            rewritten_bullets=[RewrittenBullet(bullet_id="exp0_b0", rewritten_text="Leveraged Python extensively")],
            updated_skills=["Python"],
        ),
        PrepQuestionsWrapper: PrepQuestionsWrapper(
            questions=[PrepQuestionData(topic="AWS", question="Q?", answer_framework="A", is_gap_based=True, order_index=0)]
        ),
    }
    provider = make_provider_dispatching_by_schema(responses)
    resume = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}

    result = await run_tailoring_pipeline(resume, "Need Python and AWS exp.", 50, provider)

    assert isinstance(result, TailoringResult)
    assert result.ats_score >= 0
    assert result.tailored_content["experience"][0]["bullets"] == ["Leveraged Python extensively"]


@pytest.mark.asyncio
async def test_run_tailoring_pipeline_dedupes_overlapping_skills():
    # Same dedup guarantee as the analyze-only test above, but exercised
    # through the full tailoring pipeline.
    responses = {
        JDAnalysis: make_jd_analysis(
            exact_technical_tools=["Python", "AWS"],
            ats_filter_phrases=["python"],
        ),
        MappingPlan: MappingPlan(mapping_plan=[], plausible_skills_to_add=[]),
        WriterOutput: WriterOutput(rewritten_bullets=[], updated_skills=[]),
        PrepQuestionsWrapper: PrepQuestionsWrapper(questions=[]),
    }
    provider = make_provider_dispatching_by_schema(responses)
    resume = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}]}

    result = await run_tailoring_pipeline(resume, "Need Python and AWS.", 50, provider)

    assert result.matched_skills.count("Python") == 1
    assert result.ats_score == 50  # 1 of 2 unique skills matched, not 1 of 3

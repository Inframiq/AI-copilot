import pytest
from unittest.mock import AsyncMock, MagicMock
from app.services.tailoring import (
    run_tailoring_pipeline,
    JDAnalysis,
    MappingPlan,
    BulletMapping,
    WriterOutput,
    RewrittenBullet,
    SkillQuestionData,
    SkillQuestionsWrapper,
)


def make_provider_dispatching_by_schema(responses: dict[type, object]):
    """Real code calls provider.complete_structured(system, user, schema, model_tier=...)
    positionally for `schema` — dispatch on that instead of call order, since
    Agent 3 and generate_prep_questions run concurrently via asyncio.gather
    and their relative call order isn't guaranteed."""
    provider = MagicMock()

    async def fake_complete_structured(system, user, schema, **kwargs):
        return responses[schema]

    provider.complete_structured = AsyncMock(side_effect=fake_complete_structured)
    return provider


def make_mock_db_with_rows(rows):
    session = MagicMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = rows
    session.execute = AsyncMock(return_value=result)
    session.add = MagicMock()
    session.commit = AsyncMock()
    return session


@pytest.mark.asyncio
async def test_priority_skills_reach_agent2_payload():
    """Agent 2 must receive priority_skills_from_user in its payload so the
    prompt's override rule has something to act on."""
    captured_user_msg = {}

    async def fake_complete_structured(system, user, schema, **kwargs):
        if schema is MappingPlan:
            captured_user_msg["value"] = user
            return MappingPlan(mapping_plan=[], plausible_skills_to_add=[])
        if schema is JDAnalysis:
            return JDAnalysis(
                exact_technical_tools=["Python"],
                methodologies_and_frameworks=[],
                domain_expertise_themes=[],
                seniority_indicators=[],
                ats_filter_phrases=[],
            )
        if schema is WriterOutput:
            return WriterOutput(rewritten_bullets=[], updated_skills=["Python"])
        if schema is SkillQuestionsWrapper:
            return SkillQuestionsWrapper(questions=[])
        raise AssertionError(f"Unexpected schema: {schema}")

    provider = MagicMock()
    provider.complete_structured = AsyncMock(side_effect=fake_complete_structured)

    resume = {"experience": [{"title": "Eng", "bullets": ["Did Python stuff"]}], "skills": ["Python"]}
    db = make_mock_db_with_rows([])
    await run_tailoring_pipeline(
        resume, "Need Python and Kubernetes.", 50, provider, db,
        priority_skills=["Kubernetes"],
    )

    assert '"priority_skills_from_user": ["Kubernetes"]' in captured_user_msg["value"]


@pytest.mark.asyncio
async def test_suggested_skills_always_includes_priority_skills_even_if_agent2_omits_them():
    """Safety net: even if Agent 2's plausible_skills_to_add doesn't include
    a priority skill (prompt-following failure), the pipeline's returned
    suggested_skills must still contain it."""
    responses = {
        JDAnalysis: JDAnalysis(
            exact_technical_tools=["Python"],
            methodologies_and_frameworks=[],
            domain_expertise_themes=[],
            seniority_indicators=[],
            ats_filter_phrases=[],
        ),
        # Agent 2 "forgets" the priority skill — only returns its own pick.
        MappingPlan: MappingPlan(
            mapping_plan=[
                BulletMapping(
                    original_bullet_id="exp0_b0",
                    original_text="Did Python stuff",
                    target_jd_keywords_to_inject=["Python"],
                    preserved_metrics=[],
                    strategic_instruction="REINFORCE",
                )
            ],
            plausible_skills_to_add=["Docker"],
        ),
        WriterOutput: WriterOutput(
            rewritten_bullets=[RewrittenBullet(bullet_id="exp0_b0", rewritten_text="Used Python")],
            updated_skills=["Python"],
        ),
        SkillQuestionsWrapper: SkillQuestionsWrapper(questions=[]),
    }
    provider = make_provider_dispatching_by_schema(responses)

    resume = {"experience": [{"title": "Eng", "bullets": ["Did Python stuff"]}], "skills": ["Python"]}
    db = make_mock_db_with_rows([])
    result = await run_tailoring_pipeline(
        resume, "Need Python, Docker, and Kubernetes.", 50, provider, db,
        priority_skills=["Kubernetes", "docker"],  # lowercase "docker" — must dedupe case-insensitively against "Docker"
    )

    assert "Docker" in result.suggested_skills
    assert "Kubernetes" in result.suggested_skills
    # Case-insensitive dedupe: "docker" (priority) and "Docker" (Agent 2's own
    # pick) must not both appear.
    assert result.suggested_skills.count("Docker") + result.suggested_skills.count("docker") == 1


@pytest.mark.asyncio
async def test_no_priority_skills_falls_back_to_agent2_own_suggestions():
    """When the user picks nothing, behavior is unchanged from before this
    feature existed — suggested_skills is exactly Agent 2's own pick."""
    responses = {
        JDAnalysis: JDAnalysis(
            exact_technical_tools=["Python"],
            methodologies_and_frameworks=[],
            domain_expertise_themes=[],
            seniority_indicators=[],
            ats_filter_phrases=[],
        ),
        MappingPlan: MappingPlan(
            mapping_plan=[
                BulletMapping(
                    original_bullet_id="exp0_b0",
                    original_text="Did Python stuff",
                    target_jd_keywords_to_inject=["Python"],
                    preserved_metrics=[],
                    strategic_instruction="REINFORCE",
                )
            ],
            plausible_skills_to_add=["Docker"],
        ),
        WriterOutput: WriterOutput(
            rewritten_bullets=[RewrittenBullet(bullet_id="exp0_b0", rewritten_text="Used Python")],
            updated_skills=["Python"],
        ),
        SkillQuestionsWrapper: SkillQuestionsWrapper(questions=[]),
    }
    provider = make_provider_dispatching_by_schema(responses)

    resume = {"experience": [{"title": "Eng", "bullets": ["Did Python stuff"]}], "skills": ["Python"]}
    db = make_mock_db_with_rows([])
    result = await run_tailoring_pipeline(
        resume, "Need Python and Docker.", 50, provider, db,
        priority_skills=None,
    )

    assert result.suggested_skills == ["Docker"]

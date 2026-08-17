import pytest
from unittest.mock import AsyncMock, MagicMock
from app.services.tailoring import (
    extract_jd_skills, ParsedJD,
    get_or_generate_prep_questions, PrepQuestionData, SkillQuestionData, SkillQuestionsWrapper,
    JDQuestionData, JDQuestionsWrapper,
    run_tailoring_pipeline, TailoringResult,
    analyze_jd_match, JDMatchAnalysis,
    JDAnalysis, MappingPlan, BulletMapping,
    WriterOutput, RewrittenBullet,
    _build_agent3_system,
    _sanitize_skill_list, _looks_like_a_skill, _AGENT2_SYSTEM,
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

    async def fake_complete_structured(system, user, schema, **kwargs):
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
async def test_agent2_semantic_map_requests_premium_tier():
    # Agent 2 (JD+resume semantic mapping) is the one call in the pipeline
    # that requests the pricier model — every other agent still requests
    # "fast"/"pro" and lands on the budget model under OpenAIProvider. See
    # docs/ai-pipeline.md and OpenAIProvider._model_for for why.
    from app.services.tailoring import _agent2_semantic_map

    plan = MappingPlan(mapping_plan=[], plausible_skills_to_add=[])
    provider = make_mock_provider(structured_return=plan)

    await _agent2_semantic_map(make_jd_analysis(), {"experience": []}, provider)

    assert provider.complete_structured.call_args.kwargs["model_tier"] == "premium"


def make_mock_db_with_rows(rows):
    session = MagicMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = rows
    session.execute = AsyncMock(return_value=result)
    session.add = MagicMock()
    session.commit = AsyncMock()
    return session


@pytest.mark.asyncio
async def test_get_or_generate_prep_questions_returns_list():
    provider = make_mock_provider(
        structured_return=SkillQuestionsWrapper(
            questions=[
                SkillQuestionData(
                    skill="AWS", topic="Technical",
                    question="How would you approach AWS?", answer_framework="Use STAR",
                )
            ]
        )
    )
    db = make_mock_db_with_rows([])

    result = await get_or_generate_prep_questions(["AWS"], {"experience": []}, provider, db)

    assert len(result) == 1
    assert result[0].topic == "Technical"


@pytest.mark.asyncio
async def test_get_or_generate_prep_questions_adds_jd_specific_questions_when_jd_analysis_given():
    """Skill-bank questions alone don't reference this specific JD's domain/
    seniority — when jd_analysis is passed, a few fresh, uncached questions
    anchored to that JD's actual parsed themes should be added on top."""
    jd_analysis = make_jd_analysis(
        domain_expertise_themes=["fintech compliance"], seniority_indicators=["Staff+"],
    )
    provider = make_provider_dispatching_by_schema({
        SkillQuestionsWrapper: SkillQuestionsWrapper(questions=[
            SkillQuestionData(
                skill="aws", topic="Technical",
                question="Generic AWS question", answer_framework="Use STAR",
            ),
        ]),
        JDQuestionsWrapper: JDQuestionsWrapper(questions=[
            JDQuestionData(
                topic="Technical",
                question="How would you handle fintech compliance at Staff+ level?",
                answer_framework="Use STAR",
            ),
        ]),
    })
    db = make_mock_db_with_rows([])

    result = await get_or_generate_prep_questions(
        ["AWS"], {"experience": []}, provider, db,
        jd_analysis=jd_analysis, company_name="Acme Corp",
    )

    jd_specific = [q for q in result if not q.is_gap_based]
    gap_based = [q for q in result if q.is_gap_based]
    assert len(jd_specific) == 1
    assert jd_specific[0].question == "How would you handle fintech compliance at Staff+ level?"
    assert len(gap_based) == 1


@pytest.mark.asyncio
async def test_get_or_generate_prep_questions_skips_jd_specific_when_no_jd_analysis():
    """Backward-compatible default — omitting jd_analysis (as the one existing
    caller in this file still does) must not attempt a second LLM call or
    require a JDQuestionsWrapper response."""
    provider = make_mock_provider(
        structured_return=SkillQuestionsWrapper(
            questions=[
                SkillQuestionData(
                    skill="AWS", topic="Technical",
                    question="How would you approach AWS?", answer_framework="Use STAR",
                )
            ]
        )
    )
    db = make_mock_db_with_rows([])

    result = await get_or_generate_prep_questions(["AWS"], {"experience": []}, provider, db)

    assert all(q.is_gap_based for q in result)


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
        SkillQuestionsWrapper: SkillQuestionsWrapper(
            questions=[SkillQuestionData(skill="AWS", topic="Technical", question="Q?", answer_framework="A")]
        ),
    }
    provider = make_provider_dispatching_by_schema(responses)
    resume = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}
    db = make_mock_db_with_rows([])

    result = await run_tailoring_pipeline(resume, "Need Python and AWS exp.", 50, provider, db)

    assert isinstance(result, TailoringResult)
    assert result.ats_score >= 0
    assert result.tailored_content["experience"][0]["bullets"] == ["Leveraged Python extensively"]


@pytest.mark.asyncio
async def test_run_tailoring_pipeline_survives_prep_question_failure():
    # Real-world trigger: the model's structured-output JSON for prep
    # questions gets truncated (e.g. hits an output-token cap) and fails
    # Pydantic validation. That must not discard an otherwise-successful
    # bullet rewrite — prep questions are a bonus, the tailored resume is
    # the point of this call.
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
    }
    provider = MagicMock()

    async def fake_complete_structured(system, user, schema, **kwargs):
        if schema is SkillQuestionsWrapper:
            raise ValueError("Invalid JSON: EOF while parsing a string")
        return responses[schema]

    provider.complete_structured = AsyncMock(side_effect=fake_complete_structured)
    resume = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}
    db = make_mock_db_with_rows([])

    result = await run_tailoring_pipeline(resume, "Need Python and AWS exp.", 50, provider, db)

    assert isinstance(result, TailoringResult)
    assert result.tailored_content["experience"][0]["bullets"] == ["Leveraged Python extensively"]
    assert result.prep_questions == []


@pytest.mark.asyncio
async def test_run_tailoring_pipeline_reraises_agent3_failure():
    # Unlike prep questions, Agent 3 failing IS fatal — there is no tailored
    # resume to return without it, so this must still propagate.
    responses = {
        JDAnalysis: make_jd_analysis(exact_technical_tools=["Python"]),
        MappingPlan: MappingPlan(mapping_plan=[], plausible_skills_to_add=[]),
        SkillQuestionsWrapper: SkillQuestionsWrapper(questions=[]),
    }
    provider = MagicMock()

    async def fake_complete_structured(system, user, schema, **kwargs):
        if schema is WriterOutput:
            raise ValueError("Invalid JSON: EOF while parsing a string")
        return responses[schema]

    provider.complete_structured = AsyncMock(side_effect=fake_complete_structured)
    resume = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}
    db = make_mock_db_with_rows([])

    with pytest.raises(ValueError, match="Invalid JSON"):
        await run_tailoring_pipeline(resume, "Need Python and AWS exp.", 50, provider, db)


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
        SkillQuestionsWrapper: SkillQuestionsWrapper(questions=[]),
    }
    provider = make_provider_dispatching_by_schema(responses)
    resume = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}]}
    db = make_mock_db_with_rows([])

    result = await run_tailoring_pipeline(resume, "Need Python and AWS.", 50, provider, db)

    assert result.matched_skills.count("Python") == 1
    assert result.ats_score == 50  # 1 of 2 unique skills matched, not 1 of 3


# ── Skill sanitization ────────────────────────────────────────────────────────


def test_sanitize_skill_list_keeps_real_skill_names():
    skills = ["Python", "Serverless Architecture", "CI/CD", "Node.js", "Stakeholder Management"]
    assert _sanitize_skill_list(skills) == skills


def test_sanitize_skill_list_drops_process_narrative_masquerading_as_a_skill():
    skills = [
        "Python",
        "Managed a team of engineers to deliver projects on time",
        "Experience with cloud infrastructure and deployment processes",
        "Responsible for coordinating cross-functional stakeholders across the org",
        "AWS",
    ]
    result = _sanitize_skill_list(skills)
    assert result == ["Python", "AWS"]


def test_looks_like_a_skill_rejects_long_or_sentence_shaped_text():
    assert _looks_like_a_skill("Kubernetes") is True
    assert _looks_like_a_skill("Amazon Web Services") is True
    assert _looks_like_a_skill("Led a cross-functional team of five engineers.") is False
    assert _looks_like_a_skill("Knowledge of distributed systems design") is False
    assert _looks_like_a_skill("Built, deployed, and maintained microservices") is False


def test_agent2_prompt_skill_cap_is_internally_consistent():
    # Regression guard for the "15-skill cap" vs "6-skill cap" contradiction
    # that caused Agent 2 to under-return suggested skills.
    assert "6-skill cap" not in _AGENT2_SYSTEM
    assert "15-skill cap" in _AGENT2_SYSTEM


@pytest.mark.asyncio
async def test_write_cover_letter_passes_jd_and_resume_context_to_the_prompt():
    from app.services.tailoring import write_cover_letter, CoverLetterOutput

    provider = make_mock_provider(
        structured_return=CoverLetterOutput(
            body="Dear Hiring Manager,\n\nI am excited to apply...\n\nSincerely,\nJane Doe"
        )
    )
    jd_analysis = make_jd_analysis(
        exact_technical_tools=["Python", "AWS"],
        domain_expertise_themes=["distributed systems"],
    )
    resume_content = {
        "contact": {"name": "Jane Doe", "email": "jane@example.com"},
        "experience": [{"company": "Acme", "title": "Engineer", "bullets": ["Built APIs with Python"]}],
        "skills": ["Python", "AWS"],
    }

    result = await write_cover_letter(
        resume_content, jd_analysis, ["Python", "AWS"], "Senior Backend Engineer",
        "Acme Corp", 50, provider,
    )

    assert isinstance(result, CoverLetterOutput)
    assert "Jane Doe" in result.body
    provider.complete_structured.assert_called_once()
    call_args = provider.complete_structured.call_args
    sent_payload = call_args.args[1]
    assert "Senior Backend Engineer" in sent_payload
    assert "Acme Corp" in sent_payload
    assert "distributed systems" in sent_payload
    # resume_content must propagate faithfully into the sent payload (FACT LOCK depends on this)
    assert "Jane Doe" in sent_payload
    assert "jane@example.com" in sent_payload
    assert "Built APIs with Python" in sent_payload
    # matched_skills must pass through _sanitize_skill_list into the real sent payload
    assert "Python" in sent_payload
    assert "AWS" in sent_payload

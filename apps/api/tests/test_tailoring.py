import pytest
from unittest.mock import AsyncMock, MagicMock
from app.services.tailoring import (
    extract_jd_skills, ParsedJD,
    get_or_generate_prep_questions, PrepQuestionData, SkillQuestionData, SkillQuestionsWrapper,
    InterviewQuestionData, InterviewQuestionsWrapper,
    run_tailoring_pipeline, TailoringResult,
    analyze_jd_match, JDMatchAnalysis,
    JDAnalysis, MappingPlan, BulletMapping,
    WriterOutput, RewrittenBullet,
    _build_agent3_system,
    _sanitize_skill_list, _looks_like_a_skill, _AGENT2_SYSTEM,
    _cap_balanced, _MAX_PREP_QUESTIONS,
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
    session.add_all = MagicMock()
    session.commit = AsyncMock()
    return session


@pytest.mark.asyncio
async def test_get_or_generate_prep_questions_returns_real_questions_when_jd_analysis_given():
    """The real, personalized flow: questions come from Agent 4, grounded in
    this JD's parsed themes and the candidate's matched/missing skills —
    not from the shared, cross-user skill-name bank."""
    jd_analysis = make_jd_analysis(
        domain_expertise_themes=["fintech compliance"], seniority_indicators=["Staff+"],
        core_responsibilities=["Own the payments reconciliation pipeline"],
    )
    provider = make_provider_dispatching_by_schema({
        SkillQuestionsWrapper: SkillQuestionsWrapper(questions=[
            SkillQuestionData(
                skill="aws", topic="Technical",
                question="Generic AWS question", answer_framework="Use STAR",
            ),
        ]),
        InterviewQuestionsWrapper: InterviewQuestionsWrapper(questions=[
            InterviewQuestionData(
                source="requirement",
                basis="Own the payments reconciliation pipeline",
                topic="Technical",
                question="Tell me about a time you owned a reconciliation pipeline.",
                answer_framework="Use STAR",
            ),
            InterviewQuestionData(
                source="overlap",
                basis="AWS — built the payments ingestion service on AWS Lambda",
                topic="Technical",
                question="Walk me through how you built that AWS Lambda ingestion service.",
                answer_framework="Use STAR",
            ),
            InterviewQuestionData(
                source="gap",
                basis="Kubernetes",
                topic="Technical",
                question="Tell me about a time your Docker experience would carry over to Kubernetes.",
                answer_framework="Use STAR",
            ),
        ]),
    })
    db = make_mock_db_with_rows([])

    result = await get_or_generate_prep_questions(
        ["Kubernetes"], {"experience": []}, provider, db,
        jd_analysis=jd_analysis, company_name="Acme Corp", matched_skills=["AWS"],
    )

    assert len(result) == 3
    sources = {q.source for q in result}
    assert sources == {"requirement", "overlap", "gap"}
    gap_q = next(q for q in result if q.source == "gap")
    assert gap_q.is_gap_based is True
    assert gap_q.basis == "Kubernetes"
    req_q = next(q for q in result if q.source == "requirement")
    assert req_q.is_gap_based is False


def _make_interview_question(source: str, i: int) -> InterviewQuestionData:
    return InterviewQuestionData(
        source=source, basis=f"{source}-{i}", topic="Technical",
        question=f"{source} question {i}", answer_framework="Use STAR",
    )


def test_cap_balanced_returns_input_unchanged_when_under_limit():
    questions = [_make_interview_question("requirement", i) for i in range(5)]
    assert _cap_balanced(questions, _MAX_PREP_QUESTIONS) == questions


def test_cap_balanced_round_robins_across_categories_instead_of_dropping_one():
    # 10 requirement + 10 overlap + 10 gap, capped to 15 — a naive
    # front-truncation would keep only requirement questions and drop
    # overlap/gap entirely; round-robin must keep a mix of all three.
    questions = (
        [_make_interview_question("requirement", i) for i in range(10)]
        + [_make_interview_question("overlap", i) for i in range(10)]
        + [_make_interview_question("gap", i) for i in range(10)]
    )
    capped = _cap_balanced(questions, 15)
    assert len(capped) == 15
    sources = {q.source for q in capped}
    assert sources == {"requirement", "overlap", "gap"}
    counts = {s: sum(1 for q in capped if q.source == s) for s in sources}
    assert counts == {"requirement": 5, "overlap": 5, "gap": 5}


@pytest.mark.asyncio
async def test_get_or_generate_prep_questions_caps_at_fifteen():
    jd_analysis = make_jd_analysis(
        core_responsibilities=[f"Responsibility {i}" for i in range(10)],
    )
    provider = make_provider_dispatching_by_schema({
        SkillQuestionsWrapper: SkillQuestionsWrapper(questions=[]),
        InterviewQuestionsWrapper: InterviewQuestionsWrapper(
            questions=[_make_interview_question("requirement", i) for i in range(20)]
        ),
    })
    db = make_mock_db_with_rows([])

    result = await get_or_generate_prep_questions(
        [], {"experience": []}, provider, db, jd_analysis=jd_analysis,
    )

    assert len(result) == 15


@pytest.mark.asyncio
async def test_get_or_generate_prep_questions_returns_empty_when_no_jd_analysis():
    """There's no meaningful question to generate without a JD to ground it —
    omitting jd_analysis must not attempt the Agent 4 call (no
    InterviewQuestionsWrapper response is registered here, so a stray call
    would KeyError)."""
    provider = make_provider_dispatching_by_schema({
        SkillQuestionsWrapper: SkillQuestionsWrapper(questions=[
            SkillQuestionData(
                skill="aws", topic="Technical",
                question="Generic AWS question", answer_framework="Use STAR",
            ),
        ]),
    })
    db = make_mock_db_with_rows([])

    result = await get_or_generate_prep_questions(["AWS"], {"experience": []}, provider, db)

    assert result == []


@pytest.mark.asyncio
async def test_get_or_generate_prep_questions_survives_skill_bank_failure():
    """The skill bank is a best-effort side feature for a separate browse UI —
    a failure filling it must never take down the user's real questions."""
    jd_analysis = make_jd_analysis(core_responsibilities=["Own the pipeline"])
    provider = MagicMock()

    async def fake_complete_structured(system, user, schema, **kwargs):
        if schema is SkillQuestionsWrapper:
            raise RuntimeError("boom")
        return InterviewQuestionsWrapper(questions=[
            InterviewQuestionData(
                source="requirement", basis="Own the pipeline", topic="Technical",
                question="Tell me about a time you owned a pipeline.", answer_framework="Use STAR",
            ),
        ])

    provider.complete_structured = AsyncMock(side_effect=fake_complete_structured)
    db = make_mock_db_with_rows([])

    result = await get_or_generate_prep_questions(
        ["AWS"], {"experience": []}, provider, db, jd_analysis=jd_analysis,
    )

    assert len(result) == 1
    assert result[0].source == "requirement"


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


def test_agent3_system_prompt_embeds_seniority_signals_when_given():
    prompt = _build_agent3_system(50, seniority_indicators=["5+ years", "lead a team of 4"])
    assert "5+ years" in prompt
    assert "lead a team of 4" in prompt
    assert "SENIORITY-AWARE EMPHASIS" in prompt


def test_agent3_system_prompt_handles_missing_seniority_signals():
    prompt = _build_agent3_system(50, seniority_indicators=None)
    assert "none extracted for this JD" in prompt


def test_agent3_system_prompt_reframes_keyword_injection_as_byproduct():
    # Round-2 research finding: keyword injection must serve demonstrating
    # jd_responsibility_addressed, not be the goal itself — locks in the
    # reframed rule 1 so this doesn't silently regress back to raw injection.
    prompt = _build_agent3_system(50)
    assert "byproduct of demonstrating jd_responsibility_addressed" in prompt
    assert "PRESERVE SPECIFICS" in prompt


def test_agent2_system_prompt_requires_responsibility_first_reasoning():
    assert "RESPONSIBILITY-FIRST REASONING" in _AGENT2_SYSTEM
    assert "jd_responsibility_addressed" in _AGENT2_SYSTEM
    assert "core_responsibilities" in _AGENT2_SYSTEM


def test_bullet_mapping_reasoning_and_responsibility_fields_default_empty():
    bm = BulletMapping(
        original_bullet_id="exp0_b0", original_text="Did work",
        target_jd_keywords_to_inject=[], preserved_metrics=[],
        strategic_instruction="REINFORCE",
    )
    assert bm.reasoning == ""
    assert bm.jd_responsibility_addressed == ""


def test_rewritten_bullet_reasoning_field_defaults_empty():
    rb = RewrittenBullet(bullet_id="exp0_b0", rewritten_text="Did work well")
    assert rb.reasoning == ""


def test_jd_analysis_core_responsibilities_defaults_empty_list():
    analysis = make_jd_analysis()
    assert analysis.core_responsibilities == []


def test_banned_generic_phrases_includes_top_ai_tell_words():
    # 2026 research: "spearheaded"/"leveraged"/"orchestrated" are the most
    # independently-cited AI-generated-resume tells — "spearheaded" was
    # previously an example verb in this very prompt (fixed below).
    for word in ("spearheaded", "leveraged", "orchestrated"):
        assert word in BANNED_GENERIC_PHRASES


def test_agent3_system_prompt_does_not_model_a_banned_verb():
    prompt = _build_agent3_system(50)
    assert "Spearheaded" not in prompt


def test_agent3_system_prompt_does_not_mandate_quantification_on_every_bullet():
    prompt = _build_agent3_system(50)
    assert "not on every bullet" in prompt.lower()


@pytest.mark.asyncio
async def test_analyze_jd_match_dedupes_overlapping_skills():
    # "Python" appears in both exact_technical_tools and ats_filter_phrases
    # (different casing) — must not be double-counted in the ats_score
    # denominator or matched/missing lists.
    jd_analysis = make_jd_analysis(
        exact_technical_tools=["Python", "AWS"],
        ats_filter_phrases=["python"],
    )
    provider = make_semantic_provider(jd_analysis, {"AWS": "missing"})
    resume = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}

    result = await analyze_jd_match(resume, "Need Python and AWS.", provider)

    assert isinstance(result, JDMatchAnalysis)
    assert result.matched_skills.count("Python") == 1
    assert result.ats_score == 50  # 1 of 2 unique skills matched, not 1 of 3


# ── Hybrid ATS scoring: lexical pre-filter + LLM semantic verification ────────


def make_semantic_provider(jd_analysis, verdicts: dict[str, str]):
    """Provider that answers Agent 1 with *jd_analysis* and the semantic
    verification call with *verdicts* (phrase -> matched/partial/missing)."""
    from app.services.tailoring import SemanticMatchResult, SemanticVerdict

    provider = MagicMock()

    async def fake_complete_structured(system, user, schema, **kwargs):
        if schema is JDAnalysis:
            return jd_analysis
        if schema is SemanticMatchResult:
            return SemanticMatchResult(
                verdicts=[
                    SemanticVerdict(phrase=p, verdict=v) for p, v in verdicts.items()
                ]
            )
        raise KeyError(schema)

    provider.complete_structured = AsyncMock(side_effect=fake_complete_structured)
    return provider


@pytest.mark.asyncio
async def test_analyze_jd_match_recovers_paraphrased_skill_via_semantic_pass():
    # The resume clearly does both things, worded differently — the lexical
    # pass misses them, the semantic pass recovers them, score is 100.
    jd_analysis = make_jd_analysis(
        exact_technical_tools=["Python"],
        ats_filter_phrases=["revenue forecasting", "stakeholder management"],
    )
    provider = make_semantic_provider(
        jd_analysis,
        {"revenue forecasting": "matched", "stakeholder management": "matched"},
    )
    resume = {
        "experience": [{"title": "Analyst", "bullets": [
            "Used Python to forecast quarterly revenue for leadership",
            "Managed relationships with senior stakeholders across product and finance",
        ]}],
        "skills": ["Python"],
    }

    result = await analyze_jd_match(resume, "JD text", provider)

    assert result.ats_score == 100
    assert set(result.matched_skills) == {"Python", "revenue forecasting", "stakeholder management"}
    assert result.missing_skills == []


@pytest.mark.asyncio
async def test_analyze_jd_match_semantic_partial_stays_in_missing():
    jd_analysis = make_jd_analysis(exact_technical_tools=["Python", "AWS"])
    provider = make_semantic_provider(jd_analysis, {"AWS": "partial"})
    resume = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}

    result = await analyze_jd_match(resume, "JD text", provider)

    assert result.ats_score == 75  # round(100 * 1.5 / 2)
    assert result.matched_skills == ["Python"]
    assert result.missing_skills == ["AWS"]


@pytest.mark.asyncio
async def test_analyze_jd_match_only_verifies_lexically_missing_phrases():
    from unittest.mock import patch

    jd_analysis = make_jd_analysis(
        exact_technical_tools=["Python", "AWS"],
        core_responsibilities=["mentor junior engineers"],
    )
    provider = make_mock_provider(structured_return=jd_analysis)
    resume = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}

    with patch(
        "app.services.tailoring._verify_semantic_presence",
        new=AsyncMock(return_value={}),
    ) as mock_verify:
        await analyze_jd_match(resume, "JD text", provider)

    phrases_checked = mock_verify.call_args.args[0]
    assert "Python" not in phrases_checked           # already matched lexically
    assert "AWS" in phrases_checked                  # lexically missing
    assert "mentor junior engineers" in phrases_checked  # responsibilities always checked


@pytest.mark.asyncio
async def test_analyze_jd_match_scores_core_responsibilities_at_half_weight():
    jd_analysis = make_jd_analysis(
        exact_technical_tools=["Python"],
        core_responsibilities=["mentor junior engineers on system design"],
    )
    provider = make_semantic_provider(
        jd_analysis, {"mentor junior engineers on system design": "missing"}
    )
    resume = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}

    result = await analyze_jd_match(resume, "JD text", provider)

    # 1 skill matched (w1·v1) + 1 responsibility missing (w0.5·v0) -> 100·1/1.5
    assert result.ats_score == 67
    assert result.matched_skills == ["Python"]
    assert result.missing_skills == []  # responsibilities are not skill chips


@pytest.mark.asyncio
async def test_analyze_jd_match_survives_semantic_verifier_failure():
    jd_analysis = make_jd_analysis(exact_technical_tools=["Python", "AWS"])

    provider = MagicMock()

    async def fake_complete_structured(system, user, schema, **kwargs):
        if schema is JDAnalysis:
            return jd_analysis
        raise RuntimeError("model exploded")

    provider.complete_structured = AsyncMock(side_effect=fake_complete_structured)
    resume = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}

    result = await analyze_jd_match(resume, "JD text", provider)

    # Falls back to the pure lexical result — no crash, AWS still missing.
    assert result.ats_score == 50
    assert result.missing_skills == ["AWS"]


@pytest.mark.asyncio
async def test_analyze_jd_match_uses_cached_semantic_verdicts():
    jd_analysis = make_jd_analysis(exact_technical_tools=["Python", "AWS"])
    provider = make_mock_provider(structured_return=jd_analysis)
    resume = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}

    result = await analyze_jd_match(
        resume, "JD text", provider,
        cached_jd_analysis=jd_analysis,
        cached_semantic_verdicts={"aws": "matched"},
    )

    provider.complete_structured.assert_not_called()  # no LLM calls at all
    assert result.ats_score == 100
    assert set(result.matched_skills) == {"Python", "AWS"}


@pytest.mark.asyncio
async def test_analyze_jd_match_returns_semantic_verdicts_for_persistence():
    jd_analysis = make_jd_analysis(exact_technical_tools=["Python", "AWS"])
    provider = make_semantic_provider(jd_analysis, {"AWS": "matched"})
    resume = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}

    result = await analyze_jd_match(resume, "JD text", provider)

    assert result.semantic_verdicts.get("aws") == "matched"


# ── Nice-to-have weighting + job-title alignment ────────────────────────────


@pytest.mark.asyncio
async def test_analyze_jd_match_nice_to_have_scored_at_half_weight():
    jd_analysis = make_jd_analysis(
        exact_technical_tools=["Python"],
        nice_to_have_skills=["GraphQL"],
    )
    provider = make_semantic_provider(jd_analysis, {"GraphQL": "missing"})
    resume = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}

    result = await analyze_jd_match(resume, "JD text", provider)

    assert result.ats_score == 67  # round(100 * 1.0 / 1.5)
    assert result.matched_skills == ["Python"]
    assert result.missing_skills == ["GraphQL"]  # still surfaced as a gap


@pytest.mark.asyncio
async def test_analyze_jd_match_nice_to_have_deduped_against_required():
    jd_analysis = make_jd_analysis(
        exact_technical_tools=["Python"],
        nice_to_have_skills=["python"],  # same skill, different casing
    )
    provider = make_mock_provider(structured_return=jd_analysis)
    resume = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}

    result = await analyze_jd_match(resume, "JD text", provider)

    assert result.ats_score == 100  # not diluted by a phantom half-weight item
    assert result.matched_skills == ["Python"]


@pytest.mark.asyncio
async def test_analyze_jd_match_title_alignment_boosts_score():
    jd_analysis = make_jd_analysis(
        exact_technical_tools=["Python", "AWS"],
        target_job_titles=["Senior Data Analyst"],
    )
    provider = make_semantic_provider(jd_analysis, {"AWS": "missing"})
    resume = {
        "headline": "Senior Data Analyst",
        "experience": [{"title": "Senior Data Analyst", "bullets": ["Used Python"]}],
        "skills": ["Python"],
    }

    result = await analyze_jd_match(resume, "JD text", provider)

    # 1 skill matched (w1) + 1 skill missing (w1) + title matched (w2)
    #   -> round(100 * 3 / 4) == 75  (vs 50 without the title signal)
    assert result.ats_score == 75
    assert result.title_match == "matched"


@pytest.mark.asyncio
async def test_analyze_jd_match_wrong_title_lowers_score():
    jd_analysis = make_jd_analysis(
        exact_technical_tools=["Python", "AWS"],
        target_job_titles=["Senior Data Analyst"],
    )
    provider = make_semantic_provider(jd_analysis, {"AWS": "missing"})
    resume = {
        "headline": "Marketing Manager",
        "experience": [{"title": "Marketing Manager", "bullets": ["Used Python"]}],
        "skills": ["Python"],
    }

    result = await analyze_jd_match(resume, "JD text", provider)

    # 1 skill matched (w1) + 1 missing (w1) + title missing (w2) -> round(100 * 1 / 4)
    assert result.ats_score == 25
    assert result.title_match == "missing"


@pytest.mark.asyncio
async def test_analyze_jd_match_without_target_title_is_unaffected_by_headline():
    jd_analysis = make_jd_analysis(exact_technical_tools=["Python", "AWS"])  # no target_job_titles
    provider = make_semantic_provider(jd_analysis, {"AWS": "missing"})
    resume = {
        "headline": "Marketing Manager",
        "experience": [{"title": "Marketing Manager", "bullets": ["Used Python"]}],
        "skills": ["Python"],
    }

    result = await analyze_jd_match(resume, "JD text", provider)

    assert result.ats_score == 50  # title signal absent → pure skill ratio
    assert result.title_match == ""


# ── _verify_semantic_presence ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_verify_semantic_presence_maps_phrases_lowercased():
    from app.services.tailoring import (
        _verify_semantic_presence, SemanticMatchResult, SemanticVerdict,
    )

    provider = make_mock_provider(structured_return=SemanticMatchResult(verdicts=[
        SemanticVerdict(phrase="Revenue Forecasting", verdict="matched"),
        SemanticVerdict(phrase="Kubernetes", verdict="missing"),
    ]))

    out = await _verify_semantic_presence(["Revenue Forecasting", "Kubernetes"], "resume", provider)

    assert out == {"revenue forecasting": "matched", "kubernetes": "missing"}


@pytest.mark.asyncio
async def test_verify_semantic_presence_skips_llm_when_no_phrases():
    from app.services.tailoring import _verify_semantic_presence

    provider = make_mock_provider()
    out = await _verify_semantic_presence([], "resume", provider)
    assert out == {}
    provider.complete_structured.assert_not_called()


@pytest.mark.asyncio
async def test_verify_semantic_presence_swallows_provider_error():
    from app.services.tailoring import _verify_semantic_presence

    provider = MagicMock()
    provider.complete_structured = AsyncMock(side_effect=RuntimeError("boom"))
    out = await _verify_semantic_presence(["Python"], "resume", provider)
    assert out == {}


@pytest.mark.asyncio
async def test_verify_semantic_presence_requests_fast_tier():
    from app.services.tailoring import _verify_semantic_presence, SemanticMatchResult

    provider = make_mock_provider(structured_return=SemanticMatchResult(verdicts=[]))
    await _verify_semantic_presence(["Python"], "resume", provider)
    assert provider.complete_structured.call_args.kwargs["model_tier"] == "fast"


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
        InterviewQuestionsWrapper: InterviewQuestionsWrapper(
            questions=[InterviewQuestionData(
                source="requirement", basis="Python", topic="Technical",
                question="Tell me about a time you used Python.", answer_framework="A",
            )]
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
async def test_run_tailoring_pipeline_passes_seniority_indicators_to_agent3():
    # Agent 3's seniority-aware emphasis rule only works if run_tailoring_pipeline
    # actually threads analysis.jd_analysis.seniority_indicators through to it.
    captured_system_prompts: dict[type, str] = {}
    responses = {
        JDAnalysis: make_jd_analysis(
            exact_technical_tools=["Python"], seniority_indicators=["lead a team of 8"],
        ),
        MappingPlan: MappingPlan(
            mapping_plan=[
                BulletMapping(
                    original_bullet_id="exp0_b0", original_text="Used Python",
                    target_jd_keywords_to_inject=["Python"], preserved_metrics=[],
                    strategic_instruction="REINFORCE",
                )
            ],
            plausible_skills_to_add=[],
        ),
        WriterOutput: WriterOutput(
            rewritten_bullets=[RewrittenBullet(bullet_id="exp0_b0", rewritten_text="Led Python delivery")],
            updated_skills=["Python"],
        ),
        SkillQuestionsWrapper: SkillQuestionsWrapper(questions=[]),
        InterviewQuestionsWrapper: InterviewQuestionsWrapper(questions=[]),
    }
    provider = MagicMock()

    async def fake_complete_structured(system, user, schema, **kwargs):
        captured_system_prompts[schema] = system
        return responses[schema]

    provider.complete_structured = AsyncMock(side_effect=fake_complete_structured)
    resume = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}
    db = make_mock_db_with_rows([])

    await run_tailoring_pipeline(resume, "Need Python and AWS exp.", 50, provider, db)

    assert "lead a team of 8" in captured_system_prompts[WriterOutput]


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
        SkillQuestionsWrapper: SkillQuestionsWrapper(questions=[]),
    }
    provider = MagicMock()

    async def fake_complete_structured(system, user, schema, **kwargs):
        if schema is InterviewQuestionsWrapper:
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
        InterviewQuestionsWrapper: InterviewQuestionsWrapper(questions=[]),
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
        InterviewQuestionsWrapper: InterviewQuestionsWrapper(questions=[]),
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

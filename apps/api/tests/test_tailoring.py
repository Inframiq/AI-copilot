import pytest
from unittest.mock import AsyncMock, MagicMock
from app.services.tailoring import (
    get_or_generate_prep_questions, PrepQuestionData,
    InterviewQuestionData, InterviewQuestionsWrapper,
    run_tailoring_pipeline, TailoringResult,
    analyze_jd_match, JDMatchAnalysis,
    JDAnalysis, _JDAnalysisWire, MappingPlan, BulletMapping,
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
async def test_agent1_backfills_importance_for_unrated_terms():
    from app.services.tailoring import _agent1_parse_jd, JDAnalysis

    raw = JDAnalysis(
        exact_technical_tools=["Python", "AWS"],
        methodologies_and_frameworks=["Agile"],
        domain_expertise_themes=[],
        seniority_indicators=[],
        ats_filter_phrases=["revenue forecasting"],
        core_responsibilities=["own the analytics roadmap"],
        target_job_titles=["Senior Data Analyst"],
        nice_to_have_skills=["Looker"],
        importance={"python": "high"},  # model only rated one term
    )
    provider = make_mock_provider(structured_return=raw)

    out = await _agent1_parse_jd("jd text", provider)

    # model value kept
    assert out.importance["python"] == "high"
    # everything else backfilled by default_importance
    assert out.importance["job title"] == "high"
    assert out.importance["senior data analyst"] == "high"
    assert out.importance["aws"] == "high"          # hard tool
    assert out.importance["agile"] == "medium"
    assert out.importance["revenue forecasting"] == "medium"
    assert out.importance["own the analytics roadmap"] == "medium"
    assert out.importance["looker"] == "low"


def test_jdanalysis_validator_strips_requirement_prose_from_skill_fields():
    """Bug report: JD requirement bullets like "Bachelor's degree in
    software engineering..." or "working knowledge of relational
    databases" came back as clickable skill chips in the JD Analyzer /
    Tailor Resume UI. The filter lives on JDAnalysis itself (a field
    validator), not just the fresh-parse code path — routers/ai.py
    reconstructs a JDAnalysis from a JD's previously cached `parsed.agent1`
    JSON on every later analyze/tailor call (`JDAnalysis(**raw_cached)`),
    and a JD analyzed before this filter existed already has the prose
    sitting in that cached blob. Validating on construction cleans that up
    retroactively too, without needing to re-run (and re-pay for) Agent 1."""
    raw_cached_from_db = {
        "exact_technical_tools": ["Python", "working knowledge of relational databases"],
        "methodologies_and_frameworks": ["Agile", "web application development experience with multiple frameworks"],
        "domain_expertise_themes": [],
        "seniority_indicators": [],
        "ats_filter_phrases": ["revenue forecasting", "Bachelor's degree in software engineering or information technology"],
        "nice_to_have_skills": ["Looker", "proficiency with content management systems"],
    }
    jd = JDAnalysis(**raw_cached_from_db)

    assert jd.exact_technical_tools == ["Python"]
    assert jd.methodologies_and_frameworks == ["Agile"]
    assert jd.ats_filter_phrases == ["revenue forecasting"]
    assert jd.nice_to_have_skills == ["Looker"]


@pytest.mark.asyncio
async def test_agent1_parse_jd_output_is_already_clean():
    """Same validator, exercised via the normal fresh-parse path."""
    from app.services.tailoring import _agent1_parse_jd

    raw = _JDAnalysisWire(
        exact_technical_tools=["Python", "working knowledge of relational databases"],
        methodologies_and_frameworks=["Agile"],
        domain_expertise_themes=[],
        seniority_indicators=[],
        ats_filter_phrases=["revenue forecasting"],
        importance=[],
    )
    provider = make_mock_provider(structured_return=raw)

    out = await _agent1_parse_jd("jd text", provider)

    assert out.exact_technical_tools == ["Python"]


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
    })
    db = make_mock_db_with_rows([])

    result = await get_or_generate_prep_questions(["AWS"], {"experience": []}, provider, db)

    assert result == []


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
        if schema is _JDAnalysisWire:
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

    # analyze_jd_match backfills importance, so both weights carry an
    # importance multiplier on top of their structural base:
    #   Python  — a hard tool, so rated high: base 1.0 × 1.5 = 1.5, matched
    #   the responsibility — rated medium:   base 0.5 × 1.0 = 0.5, missing
    # -> 100 · 1.5/2.0
    assert result.ats_score == 75
    assert result.matched_skills == ["Python"]
    assert result.missing_skills == []  # responsibilities are not skill chips


@pytest.mark.asyncio
async def test_a_responsibility_still_weighs_less_than_a_skill_of_equal_importance():
    """The structural half-weight survives importance weighting — this is what
    the score above is really asserting, independent of the exact arithmetic."""
    jd_analysis = make_jd_analysis(
        exact_technical_tools=["Python"],
        core_responsibilities=["mentor junior engineers on system design"],
    )
    resume = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}

    missing_responsibility = await analyze_jd_match(
        resume, "JD text",
        make_semantic_provider(jd_analysis, {"mentor junior engineers on system design": "missing"}),
    )
    jd_flipped = make_jd_analysis(
        exact_technical_tools=["Kubernetes"],
        core_responsibilities=["mentor junior engineers on system design"],
    )
    missing_skill = await analyze_jd_match(
        resume, "JD text",
        make_semantic_provider(
            jd_flipped,
            {"Kubernetes": "missing", "mentor junior engineers on system design": "matched"},
        ),
    )
    assert missing_skill.ats_score < missing_responsibility.ats_score


@pytest.mark.asyncio
async def test_analyze_jd_match_survives_semantic_verifier_failure():
    jd_analysis = make_jd_analysis(exact_technical_tools=["Python", "AWS"])

    provider = MagicMock()

    async def fake_complete_structured(system, user, schema, **kwargs):
        if schema is _JDAnalysisWire:
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

    # Both discounts compound, by design: the structural base says WHICH
    # bucket the phrase is in, the importance multiplier says how hard THIS
    # JD leans on it. default_importance rates every nice-to-have "low", and
    # Agent 1 can override that upward for one the JD actually stresses.
    #   Python  — hard tool, high:     base 1.0 × 1.5 = 1.5, matched
    #   GraphQL — nice-to-have, low:   base 0.5 × 0.5 = 0.25, missing
    # -> round(100 · 1.5/1.75)
    assert result.ats_score == 86
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
        _JDAnalysisWire: make_jd_analysis(exact_technical_tools=["Python"]),
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
            rewritten_bullets=[RewrittenBullet(bullet_id="exp0_b0", rewritten_text="Engineered Python services end to end")],
            updated_skills=["Python"],
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
    assert result.tailored_content["experience"][0]["bullets"] == ["Engineered Python services end to end"]


@pytest.mark.asyncio
async def test_run_tailoring_pipeline_scores_the_tailored_resume_not_the_original():
    # The whole point of tailoring: the returned ats_score / matched / missing
    # must reflect the *rewritten* resume, not the one the user started with.
    responses = {
        _JDAnalysisWire: make_jd_analysis(exact_technical_tools=["Python", "Kubernetes"]),
        MappingPlan: MappingPlan(
            mapping_plan=[
                BulletMapping(
                    original_bullet_id="exp0_b0",
                    original_text="Managed deployments",
                    target_jd_keywords_to_inject=["Python", "Kubernetes"],
                    preserved_metrics=[],
                    strategic_instruction="INJECT",
                )
            ],
            plausible_skills_to_add=[],
        ),
        WriterOutput: WriterOutput(
            rewritten_bullets=[RewrittenBullet(
                bullet_id="exp0_b0",
                rewritten_text="Managed deployments on Kubernetes using Python",
            )],
            updated_skills=[],
        ),
        InterviewQuestionsWrapper: InterviewQuestionsWrapper(questions=[]),
    }
    provider = make_provider_dispatching_by_schema(responses)
    resume = {"experience": [{"title": "Eng", "bullets": ["Managed deployments"]}], "skills": []}
    db = make_mock_db_with_rows([])

    result = await run_tailoring_pipeline(resume, "Need Python and Kubernetes.", 50, provider, db)

    # Original resume matches neither keyword (pre-tailor score would be 0).
    # The rewritten bullet names both -> 100.
    assert result.ats_score == 100
    assert set(result.matched_skills) == {"Python", "Kubernetes"}
    assert result.missing_skills == []


@pytest.mark.asyncio
async def test_run_tailoring_pipeline_passes_seniority_indicators_to_agent3():
    # Agent 3's seniority-aware emphasis rule only works if run_tailoring_pipeline
    # actually threads analysis.jd_analysis.seniority_indicators through to it.
    captured_system_prompts: dict[type, str] = {}
    responses = {
        _JDAnalysisWire: make_jd_analysis(
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
        _JDAnalysisWire: make_jd_analysis(exact_technical_tools=["Python"]),
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
            rewritten_bullets=[RewrittenBullet(bullet_id="exp0_b0", rewritten_text="Engineered Python services end to end")],
            updated_skills=["Python"],
        ),
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
    assert result.tailored_content["experience"][0]["bullets"] == ["Engineered Python services end to end"]
    assert result.prep_questions == []


@pytest.mark.asyncio
async def test_run_tailoring_pipeline_reraises_agent3_failure():
    # Unlike prep questions, Agent 3 failing IS fatal — there is no tailored
    # resume to return without it, so this must still propagate.
    # The plan must be non-empty: _agent3_write short-circuits an empty one
    # without calling the model at all (no bullets to rewrite, no reason to
    # spend a premium call), so an empty plan would never reach the failure
    # this test is about.
    responses = {
        _JDAnalysisWire: make_jd_analysis(exact_technical_tools=["Python"]),
        MappingPlan: MappingPlan(
            mapping_plan=[BulletMapping(
                original_bullet_id="exp0_b0", original_text="Used Python",
                target_jd_keywords_to_inject=[], preserved_metrics=[],
                strategic_instruction="REINFORCE",
            )],
            plausible_skills_to_add=[],
        ),
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
        _JDAnalysisWire: make_jd_analysis(
            exact_technical_tools=["Python", "AWS"],
            ats_filter_phrases=["python"],
        ),
        MappingPlan: MappingPlan(mapping_plan=[], plausible_skills_to_add=[]),
        WriterOutput: WriterOutput(rewritten_bullets=[], updated_skills=[]),
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


def test_looks_like_a_skill_rejects_requirement_bullets_reported_as_skill_chips():
    """A real bug report: these four JD requirement bullets showed up as
    clickable "skill" chips in the JD Analyzer / Tailor Resume UI instead of
    being filtered out. Each wraps what reads like a plausible noun phrase
    in qualifier language a real skill name never uses."""
    assert _looks_like_a_skill("Bachelor's degree in software engineering or information technology") is False
    assert _looks_like_a_skill("working knowledge of relational databases") is False
    assert _looks_like_a_skill("proficiency with content management systems") is False
    assert _looks_like_a_skill("web application development experience with multiple frameworks") is False
    # The underlying real skills must still pass on their own.
    assert _looks_like_a_skill("Relational Databases") is True
    assert _looks_like_a_skill("Content Management Systems") is True


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


@pytest.mark.asyncio
async def test_agent_gap_filler_requests_fast_tier_and_returns_output():
    from app.services.tailoring import (
        _agent_gap_filler, GapFillerOutput, GapFillBullet,
    )
    jd = make_jd_analysis(exact_technical_tools=["Kubernetes"])
    provider = make_mock_provider(structured_return=GapFillerOutput(
        bullets=[GapFillBullet(gap="Kubernetes", grounded=True, experience_index=0,
                               bullet_text="Ran production workloads on Kubernetes.")],
        headline="",
    ))
    out = await _agent_gap_filler(
        {"experience": [{"title": "E", "bullets": ["x"]}]},
        jd,
        [{"gap": "Kubernetes", "kind": "skill", "importance": "high"}],
        provider,
    )
    assert out.bullets[0].bullet_text.startswith("Ran production workloads")
    assert provider.complete_structured.call_args.kwargs["model_tier"] == "fast"


@pytest.mark.asyncio
async def test_agent_gap_filler_no_gaps_skips_the_call():
    from app.services.tailoring import _agent_gap_filler
    provider = make_mock_provider()
    out = await _agent_gap_filler({"experience": []}, make_jd_analysis(), [], provider)
    assert out.bullets == [] and out.headline == ""
    provider.complete_structured.assert_not_called()


@pytest.mark.asyncio
async def test_pipeline_emits_ats_fixes_and_bullet_importance():
    from app.services.tailoring import GapFillerOutput, GapFillBullet

    responses = {
        _JDAnalysisWire: make_jd_analysis(
            exact_technical_tools=["Python", "Kubernetes"],
            core_responsibilities=["own the deploy pipeline"],
            importance={"python": "high", "kubernetes": "high",
                        "own the deploy pipeline": "medium", "job title": "low"},
        ),
        MappingPlan: MappingPlan(
            mapping_plan=[BulletMapping(
                original_bullet_id="exp0_b0", original_text="Managed deploys",
                target_jd_keywords_to_inject=["Python"], preserved_metrics=[],
                strategic_instruction="INJECT",
                jd_responsibility_addressed="own the deploy pipeline",
            )],
            plausible_skills_to_add=[],
        ),
        WriterOutput: WriterOutput(
            rewritten_bullets=[RewrittenBullet(bullet_id="exp0_b0",
                               rewritten_text="Managed deploys with Python")],
            updated_skills=[],
        ),
        GapFillerOutput: GapFillerOutput(bullets=[GapFillBullet(
            gap="Kubernetes", grounded=False, experience_index=None,
            bullet_text="Operated Kubernetes clusters in production.")]),
        InterviewQuestionsWrapper: InterviewQuestionsWrapper(questions=[]),
    }
    provider = make_provider_dispatching_by_schema(responses)
    resume = {"experience": [{"title": "E", "bullets": ["Managed deploys"]}], "skills": []}
    db = make_mock_db_with_rows([])

    result = await run_tailoring_pipeline(resume, "need Python and Kubernetes", 50, provider, db)

    ids = {f.id for f in result.ats_fixes}
    # a skill fix for the still-missing Kubernetes, and a speculative bullet fix
    assert any(f.type == "skill" and f.text == "Kubernetes" for f in result.ats_fixes)
    k8s_bullet = next(f for f in result.ats_fixes if f.type == "bullet" and f.gap == "Kubernetes")
    assert k8s_bullet.grounded is False
    assert k8s_bullet.default_accept is False
    assert k8s_bullet.importance == "high"
    # a role-less (speculative) gap-filler bullet is pinned to the most-recent
    # role so accepting it actually lands somewhere; the UI can still move it.
    assert k8s_bullet.experience_index == 0
    # sorted High -> Low
    levels = [f.importance for f in result.ats_fixes]
    assert levels == sorted(levels, key=lambda l: {"high": 0, "medium": 1, "low": 2}[l])
    # bullet importance from the mapping plan (max of keyword + responsibility importance)
    assert result.bullet_importance["exp0_b0"] == "high"


@pytest.mark.asyncio
async def test_pipeline_drops_gap_bullet_that_restates_existing_content():
    from app.services.tailoring import GapFillerOutput, GapFillBullet

    responses = {
        _JDAnalysisWire: make_jd_analysis(
            exact_technical_tools=["Kubernetes"], importance={"kubernetes": "high"},
        ),
        MappingPlan: MappingPlan(mapping_plan=[], plausible_skills_to_add=[]),
        WriterOutput: WriterOutput(rewritten_bullets=[], updated_skills=[]),
        GapFillerOutput: GapFillerOutput(bullets=[GapFillBullet(
            gap="Kubernetes", grounded=False, experience_index=None,
            bullet_text="Operated Kubernetes clusters in production.")]),
        InterviewQuestionsWrapper: InterviewQuestionsWrapper(questions=[]),
    }
    provider = make_provider_dispatching_by_schema(responses)
    resume = {
        "experience": [{"title": "E", "bullets": ["Operated Kubernetes clusters in production"]}],
        "skills": [],
    }
    db = make_mock_db_with_rows([])

    result = await run_tailoring_pipeline(resume, "need Kubernetes", 50, provider, db)

    # the gap-filler bullet just restates an existing bullet — don't offer it
    assert not any(f.type == "bullet" for f in result.ats_fixes)


@pytest.mark.asyncio
async def test_pipeline_gap_bullets_are_always_speculative():
    from app.services.tailoring import GapFillerOutput, GapFillBullet

    responses = {
        _JDAnalysisWire: make_jd_analysis(
            exact_technical_tools=["Kubernetes"], importance={"kubernetes": "high"},
        ),
        MappingPlan: MappingPlan(mapping_plan=[], plausible_skills_to_add=[]),
        WriterOutput: WriterOutput(rewritten_bullets=[], updated_skills=[]),
        GapFillerOutput: GapFillerOutput(bullets=[GapFillBullet(
            gap="Kubernetes", grounded=True, experience_index=0,
            bullet_text="Ran build systems on bare metal for years.")]),
        InterviewQuestionsWrapper: InterviewQuestionsWrapper(questions=[]),
    }
    provider = make_provider_dispatching_by_schema(responses)
    resume = {"experience": [{"title": "E", "bullets": ["Wrote docs"]}], "skills": []}
    db = make_mock_db_with_rows([])

    result = await run_tailoring_pipeline(resume, "need Kubernetes", 50, provider, db)

    bullet_fixes = [f for f in result.ats_fixes if f.type == "bullet"]
    assert bullet_fixes and all(not f.grounded and not f.default_accept for f in bullet_fixes)


# ── Project bullets go through the rewriter too ──────────────────────────────
# Regression: _index_bullets walked only resume_content["experience"], so
# Agent 2 and Agent 3 never saw a project. For a fresher — whose projects
# carry the technical evidence — "Tailor Resume" charged a credit and
# changed nothing that gets scored.

from app.services.tailoring import (
    _index_bullets, _apply_writer_output, WriterOutput, RewrittenBullet,
)


def test_index_bullets_assigns_ids_to_project_bullets():
    content = {"experience": [], "projects": [{"name": "P", "bullets": ["Built a thing."]}]}
    indexed, index_map = _index_bullets(content)
    assert indexed["projects"][0]["bullets"][0] == {"bullet_id": "proj0_b0", "text": "Built a thing."}
    assert index_map["proj0_b0"] == "projects[0].bullets[0]"


def test_index_bullets_keeps_experience_ids_unchanged():
    content = {"experience": [{"company": "A", "bullets": ["Shipped."]}],
               "projects": [{"name": "P", "bullets": ["Built."]}]}
    indexed, index_map = _index_bullets(content)
    assert indexed["experience"][0]["bullets"][0]["bullet_id"] == "exp0_b0"
    assert index_map["exp0_b0"] == "experience[0].bullets[0]"


def test_apply_writer_output_patches_rewritten_project_bullets():
    content = {"experience": [], "projects": [{"name": "P", "bullets": ["Built a thing."]}]}
    indexed, _ = _index_bullets(content)
    writer = WriterOutput(
        rewritten_bullets=[RewrittenBullet(bullet_id="proj0_b0", rewritten_text="Engineered a thing.")],
        updated_skills=[],
    )
    out = _apply_writer_output(indexed, writer)
    assert out["projects"][0]["bullets"] == ["Engineered a thing."]


def test_apply_writer_output_falls_back_to_original_project_bullet_text():
    content = {"experience": [], "projects": [{"name": "P", "bullets": ["Built a thing."]}]}
    indexed, _ = _index_bullets(content)
    writer = WriterOutput(rewritten_bullets=[], updated_skills=[])
    out = _apply_writer_output(indexed, writer)
    assert out["projects"][0]["bullets"] == ["Built a thing."]


def test_collect_all_bullets_spans_experience_and_projects():
    """The gap-filler's duplicate guard must see project bullets too, or it
    proposes a "new" bullet restating one the résumé already has."""
    from app.services.tailoring import _collect_all_bullets
    content = {"experience": [{"company": "A", "bullets": ["Shipped the API."]}],
               "projects": [{"name": "P", "bullets": ["Built a CI pipeline."]}]}
    assert _collect_all_bullets(content) == ["Shipped the API.", "Built a CI pipeline."]


# ── The pipeline enforces fact-lock on Agent 3's output ──────────────────────
# Until this existed, a rewrite that fabricated a metric, dropped a real one,
# ran past the word cap or reached for banned filler shipped straight to the
# user. bullet_guard is the rule set; this is the wiring that applies it.

from app.services.tailoring import _guard_writer_output, BulletMapping, MappingPlan


def _plan(*entries) -> MappingPlan:
    return MappingPlan(mapping_plan=list(entries), plausible_skills_to_add=[])


def _entry(bid, original, metrics=()):
    return BulletMapping(
        original_bullet_id=bid, original_text=original,
        target_jd_keywords_to_inject=[], preserved_metrics=list(metrics),
        strategic_instruction="REINFORCE",
    )


def _indexed(*bullets):
    return {"experience": [{"company": "A", "bullets": [
        {"bullet_id": f"exp0_b{i}", "text": t} for i, t in enumerate(bullets)
    ]}]}


def test_a_clean_rewrite_passes_through_untouched():
    indexed = _indexed("Reduced latency by 40%.")
    writer = WriterOutput(
        rewritten_bullets=[RewrittenBullet(bullet_id="exp0_b0", rewritten_text="Cut API latency 40%.")],
        updated_skills=[],
    )
    guarded, reverted = _guard_writer_output(indexed, writer, _plan(_entry("exp0_b0", "Reduced latency by 40%.")))
    assert guarded.rewritten_bullets[0].rewritten_text == "Cut API latency 40%."
    assert reverted == []


def test_a_rewrite_that_invents_a_metric_is_reverted_to_the_original():
    indexed = _indexed("Built the checkout flow.")
    writer = WriterOutput(
        rewritten_bullets=[RewrittenBullet(bullet_id="exp0_b0",
                                           rewritten_text="Built checkout serving 2M users.")],
        updated_skills=[],
    )
    guarded, reverted = _guard_writer_output(indexed, writer, _plan(_entry("exp0_b0", "Built the checkout flow.")))
    assert guarded.rewritten_bullets[0].rewritten_text == "Built the checkout flow."
    assert len(reverted) == 1
    assert reverted[0]["bullet_id"] == "exp0_b0"
    assert any("invented" in r for r in reverted[0]["reasons"])


def test_a_rewrite_that_drops_a_preserved_metric_is_reverted():
    indexed = _indexed("Reduced latency by 40%.")
    writer = WriterOutput(
        rewritten_bullets=[RewrittenBullet(bullet_id="exp0_b0", rewritten_text="Improved API latency.")],
        updated_skills=[],
    )
    guarded, reverted = _guard_writer_output(
        indexed, writer, _plan(_entry("exp0_b0", "Reduced latency by 40%.", ["40%"])),
    )
    assert guarded.rewritten_bullets[0].rewritten_text == "Reduced latency by 40%."
    assert any("dropped preserved metric" in r for r in reverted[0]["reasons"])


def test_one_bad_bullet_does_not_revert_its_clean_neighbours():
    indexed = _indexed("Built the checkout flow.", "Led the payments team.")
    writer = WriterOutput(rewritten_bullets=[
        RewrittenBullet(bullet_id="exp0_b0", rewritten_text="Built checkout serving 2M users."),
        RewrittenBullet(bullet_id="exp0_b1", rewritten_text="Directed the payments team."),
    ], updated_skills=[])
    guarded, reverted = _guard_writer_output(indexed, writer, _plan(
        _entry("exp0_b0", "Built the checkout flow."),
        _entry("exp0_b1", "Led the payments team."),
    ))
    texts = {b.bullet_id: b.rewritten_text for b in guarded.rewritten_bullets}
    assert texts["exp0_b0"] == "Built the checkout flow."
    assert texts["exp0_b1"] == "Directed the payments team."
    assert [r["bullet_id"] for r in reverted] == ["exp0_b0"]


def test_it_guards_project_bullets_too():
    indexed = {"experience": [], "projects": [{"name": "P", "bullets": [
        {"bullet_id": "proj0_b0", "text": "Built a parser."}]}]}
    writer = WriterOutput(
        rewritten_bullets=[RewrittenBullet(bullet_id="proj0_b0",
                                           rewritten_text="Built a parser handling 500 files/sec.")],
        updated_skills=[],
    )
    guarded, reverted = _guard_writer_output(indexed, writer, _plan(_entry("proj0_b0", "Built a parser.")))
    assert guarded.rewritten_bullets[0].rewritten_text == "Built a parser."
    assert reverted[0]["bullet_id"] == "proj0_b0"


def test_it_falls_back_to_the_indexed_text_when_the_plan_lacks_the_bullet():
    """The mapping plan is Agent 2's output and can omit an id; the indexed
    résumé is built locally and always has it."""
    indexed = _indexed("Built the checkout flow.")
    writer = WriterOutput(
        rewritten_bullets=[RewrittenBullet(bullet_id="exp0_b0",
                                           rewritten_text="Built checkout serving 2M users.")],
        updated_skills=[],
    )
    guarded, reverted = _guard_writer_output(indexed, writer, _plan())
    assert guarded.rewritten_bullets[0].rewritten_text == "Built the checkout flow."
    assert reverted


@pytest.mark.asyncio
async def test_pipeline_reverts_a_fabricated_metric_and_reports_it():
    responses = {
        _JDAnalysisWire: make_jd_analysis(exact_technical_tools=["Python"]),
        MappingPlan: MappingPlan(
            mapping_plan=[BulletMapping(
                original_bullet_id="exp0_b0", original_text="Built the checkout flow",
                target_jd_keywords_to_inject=["Python"], preserved_metrics=[],
                strategic_instruction="REINFORCE",
            )],
            plausible_skills_to_add=[],
        ),
        WriterOutput: WriterOutput(
            rewritten_bullets=[RewrittenBullet(
                bullet_id="exp0_b0",
                rewritten_text="Built a Python checkout flow serving 2M users",
            )],
            updated_skills=[],
        ),
    }
    provider = make_provider_dispatching_by_schema(responses)
    resume = {"experience": [{"title": "Eng", "bullets": ["Built the checkout flow"]}], "skills": []}

    result = await run_tailoring_pipeline(resume, "Need Python.", 50, provider, make_mock_db_with_rows([]))

    assert result.tailored_content["experience"][0]["bullets"] == ["Built the checkout flow"]
    assert len(result.reverted_bullets) == 1
    assert result.reverted_bullets[0]["bullet_id"] == "exp0_b0"
    assert any("invented" in r for r in result.reverted_bullets[0]["reasons"])


@pytest.mark.asyncio
async def test_pipeline_reports_no_reverts_for_an_honest_rewrite():
    responses = {
        _JDAnalysisWire: make_jd_analysis(exact_technical_tools=["Python"]),
        MappingPlan: MappingPlan(
            mapping_plan=[BulletMapping(
                original_bullet_id="exp0_b0", original_text="Built the checkout flow",
                target_jd_keywords_to_inject=["Python"], preserved_metrics=[],
                strategic_instruction="REINFORCE",
            )],
            plausible_skills_to_add=[],
        ),
        WriterOutput: WriterOutput(
            rewritten_bullets=[RewrittenBullet(
                bullet_id="exp0_b0", rewritten_text="Engineered the Python checkout flow",
            )],
            updated_skills=[],
        ),
    }
    provider = make_provider_dispatching_by_schema(responses)
    resume = {"experience": [{"title": "Eng", "bullets": ["Built the checkout flow"]}], "skills": []}

    result = await run_tailoring_pipeline(resume, "Need Python.", 50, provider, make_mock_db_with_rows([]))

    assert result.tailored_content["experience"][0]["bullets"] == ["Engineered the Python checkout flow"]
    assert result.reverted_bullets == []


# ── Agent 2's per-bullet rationale reaches the caller ────────────────────────
# jd_responsibility_addressed and target_jd_keywords_to_inject are generated
# and billed on every run, then were discarded — only a single derived
# importance level survived. They are what lets the review screen say WHY a
# bullet changed instead of just showing that it did.

@pytest.mark.asyncio
async def test_pipeline_returns_the_responsibility_and_keywords_per_bullet():
    responses = {
        _JDAnalysisWire: make_jd_analysis(
            exact_technical_tools=["Python"],
            core_responsibilities=["own end-to-end delivery of the checkout pipeline"],
        ),
        MappingPlan: MappingPlan(
            mapping_plan=[BulletMapping(
                original_bullet_id="exp0_b0", original_text="Built the checkout flow",
                jd_responsibility_addressed="own end-to-end delivery of the checkout pipeline",
                target_jd_keywords_to_inject=["Python", "checkout pipeline"],
                preserved_metrics=[], strategic_instruction="REINFORCE",
            )],
            plausible_skills_to_add=[],
        ),
        WriterOutput: WriterOutput(
            rewritten_bullets=[RewrittenBullet(
                bullet_id="exp0_b0", rewritten_text="Owned the Python checkout pipeline end to end",
            )],
            updated_skills=[],
        ),
    }
    provider = make_provider_dispatching_by_schema(responses)
    resume = {"experience": [{"title": "Eng", "bullets": ["Built the checkout flow"]}], "skills": []}

    result = await run_tailoring_pipeline(resume, "Need Python.", 50, provider, make_mock_db_with_rows([]))

    rationale = result.bullet_rationale["exp0_b0"]
    assert rationale["responsibility"] == "own end-to-end delivery of the checkout pipeline"
    assert rationale["keywords"] == ["Python", "checkout pipeline"]


@pytest.mark.asyncio
async def test_pipeline_omits_rationale_for_a_bullet_with_neither_signal():
    """A SKIPped bullet has no responsibility and no keywords — an entry of
    two empty fields is noise the review screen would have to filter."""
    responses = {
        _JDAnalysisWire: make_jd_analysis(exact_technical_tools=["Python"]),
        MappingPlan: MappingPlan(
            mapping_plan=[BulletMapping(
                original_bullet_id="exp0_b0", original_text="Built the checkout flow",
                jd_responsibility_addressed="", target_jd_keywords_to_inject=[],
                preserved_metrics=[], strategic_instruction="SKIP",
            )],
            plausible_skills_to_add=[],
        ),
        WriterOutput: WriterOutput(
            rewritten_bullets=[RewrittenBullet(bullet_id="exp0_b0", rewritten_text="Built the checkout flow")],
            updated_skills=[],
        ),
    }
    provider = make_provider_dispatching_by_schema(responses)
    resume = {"experience": [{"title": "Eng", "bullets": ["Built the checkout flow"]}], "skills": []}

    result = await run_tailoring_pipeline(resume, "Need Python.", 50, provider, make_mock_db_with_rows([]))

    assert "exp0_b0" not in result.bullet_rationale


@pytest.mark.asyncio
async def test_pipeline_returns_the_pre_tailoring_score_alongside_the_post_one():
    """The lift tailoring produced is the product's core claim. The pipeline
    already logs "ats %d -> %d"; returning it makes that measurable rather
    than only greppable."""
    responses = {
        _JDAnalysisWire: make_jd_analysis(exact_technical_tools=["Python", "Kubernetes"]),
        MappingPlan: MappingPlan(
            mapping_plan=[BulletMapping(
                original_bullet_id="exp0_b0", original_text="Built services",
                target_jd_keywords_to_inject=["Python"], preserved_metrics=[],
                strategic_instruction="REINFORCE",
            )],
            plausible_skills_to_add=[],
        ),
        WriterOutput: WriterOutput(
            rewritten_bullets=[RewrittenBullet(
                bullet_id="exp0_b0", rewritten_text="Built Python services on Kubernetes",
            )],
            updated_skills=[],
        ),
    }
    provider = make_provider_dispatching_by_schema(responses)
    resume = {"experience": [{"title": "Eng", "bullets": ["Built services"]}], "skills": []}

    result = await run_tailoring_pipeline(resume, "Need Python.", 50, provider, make_mock_db_with_rows([]))

    assert result.ats_score_before == 0        # neither tool present to start
    assert result.ats_score > result.ats_score_before


# ── Agent 3 recovers from a truncated response by halving its plan ───────────
# Agent 3 rewrites every bullet in one call. On a long résumé that response can
# hit the 16384-token ceiling mid-JSON — the failure mode its own prompt calls
# "the most common". Retrying identically truncates identically; asking for
# half the bullets at a time is what actually fits.

import json

from app.services.tailoring import SemanticMatchResult
from app.services.ai_engine.base import AITruncatedError
from app.services.tailoring import _agent3_write


def _plan_of(n: int) -> MappingPlan:
    return MappingPlan(
        mapping_plan=[
            BulletMapping(
                original_bullet_id=f"exp0_b{i}", original_text=f"Did thing {i}",
                target_jd_keywords_to_inject=[], preserved_metrics=[],
                strategic_instruction="REINFORCE",
            )
            for i in range(n)
        ],
        plausible_skills_to_add=[],
    )


def _writer_for(ids) -> WriterOutput:
    return WriterOutput(
        rewritten_bullets=[RewrittenBullet(bullet_id=i, rewritten_text=f"Rewrote {i}") for i in ids],
        updated_skills=[],
    )


def _splitting_provider(truncate_above: int):
    """Truncates any call carrying more than *truncate_above* plan entries —
    the shape of a real output-budget overrun."""
    provider = MagicMock()
    calls = []

    async def complete_structured(system, user, schema, **kw):
        entries = json.loads(user)["mapping_plan"]
        calls.append(len(entries))
        if len(entries) > truncate_above:
            raise AITruncatedError("ran out of output budget")
        return _writer_for(e["original_bullet_id"] for e in entries)

    provider.complete_structured = AsyncMock(side_effect=complete_structured)
    provider.batch_sizes = calls
    return provider


@pytest.mark.asyncio
async def test_a_truncated_agent3_call_is_split_and_every_bullet_still_comes_back():
    provider = _splitting_provider(truncate_above=4)
    out = await _agent3_write(_plan_of(8), [], 50, provider)

    assert [b.bullet_id for b in out.rewritten_bullets] == [f"exp0_b{i}" for i in range(8)]


@pytest.mark.asyncio
async def test_the_split_keeps_halving_until_the_request_fits():
    provider = _splitting_provider(truncate_above=2)
    out = await _agent3_write(_plan_of(8), [], 50, provider)

    assert len(out.rewritten_bullets) == 8
    assert max(provider.batch_sizes[1:]) <= 4  # it kept shrinking, not retrying at size


@pytest.mark.asyncio
async def test_a_plan_that_fits_is_sent_as_one_call():
    provider = _splitting_provider(truncate_above=100)
    await _agent3_write(_plan_of(6), [], 50, provider)

    assert provider.batch_sizes == [6]  # no needless extra spend


@pytest.mark.asyncio
async def test_a_single_bullet_that_still_truncates_gives_up_rather_than_looping():
    provider = _splitting_provider(truncate_above=0)
    with pytest.raises(AITruncatedError):
        await _agent3_write(_plan_of(1), [], 50, provider)


@pytest.mark.asyncio
async def test_an_empty_plan_makes_no_call_at_all():
    provider = _splitting_provider(truncate_above=100)
    out = await _agent3_write(_plan_of(0), [], 50, provider)

    assert out.rewritten_bullets == []
    assert provider.batch_sizes == []


@pytest.mark.asyncio
async def test_skills_survive_the_split_unchanged():
    """Agent 3 rule 11: updated_skills must equal original_skills. A split
    must not let one half's answer drop them."""
    provider = _splitting_provider(truncate_above=4)
    out = await _agent3_write(_plan_of(8), ["Python", "Go"], 50, provider)

    assert out.updated_skills == ["Python", "Go"]


def test_agent3_prompt_forbids_trailing_restatement_clauses():
    """The first live baseline measured 1.61x word growth: every rewrite closed
    with a comma + gerund clause restating its own first half. Rule 7's generic
    "do not pad" was obeyed to the letter (every bullet sat inside the 15-28
    word target) while being violated in spirit, so the prompt has to name the
    pattern. See evals/README.md."""
    prompt = _build_agent3_system(50)
    assert "TRAILING RESTATEMENT" in prompt


def test_agent3_prompt_ties_bullet_length_to_new_facts():
    prompt = _build_agent3_system(50)
    assert "LENGTH FOLLOWS FACTS" in prompt


def test_agent3_prompt_shows_a_worked_padding_example():
    """An abstract rule already failed once here. The prompt carries a
    before/after taken from real output so the model has the shape, not just
    the instruction."""
    prompt = _build_agent3_system(50)
    assert "BAD (padded" in prompt


# ── Pinning the pre-tailoring analysis ───────────────────────────────────────
# A controlled A/B needs a fixed "before" score. Pinning Agent 1 alone was not
# enough: the semantic verifier is a second model call that re-runs each time
# and returns different verdicts, which moved ats_before by up to 10 points
# between two runs whose Agent 1 parse was identical. analyze_jd_match already
# accepts cached verdicts (routers/ai.py caches them per resume fingerprint);
# the pipeline just never passed them through.

@pytest.mark.asyncio
async def test_pipeline_accepts_cached_semantic_verdicts_for_the_before_analysis():
    responses = {
        _JDAnalysisWire: make_jd_analysis(exact_technical_tools=["Python", "Kubernetes"]),
        MappingPlan: MappingPlan(
            mapping_plan=[BulletMapping(
                original_bullet_id="exp0_b0", original_text="Built services",
                target_jd_keywords_to_inject=[], preserved_metrics=[],
                strategic_instruction="REINFORCE",
            )],
            plausible_skills_to_add=[],
        ),
        WriterOutput: WriterOutput(
            rewritten_bullets=[RewrittenBullet(bullet_id="exp0_b0", rewritten_text="Built services")],
            updated_skills=[],
        ),
    }
    provider = make_provider_dispatching_by_schema(responses)
    resume = {"experience": [{"title": "Eng", "bullets": ["Built services"]}], "skills": []}

    # Both JD tools claimed present by the cached verdicts -> before score 100.
    result = await run_tailoring_pipeline(
        resume, "Need Python.", 50, provider, make_mock_db_with_rows([]),
        cached_semantic_verdicts={"python": "matched", "kubernetes": "matched"},
    )
    assert result.ats_score_before == 100


@pytest.mark.asyncio
async def test_cached_verdicts_make_the_before_score_repeatable():
    def run():
        responses = {
            _JDAnalysisWire: make_jd_analysis(exact_technical_tools=["Python", "Kubernetes"]),
            MappingPlan: MappingPlan(
                mapping_plan=[BulletMapping(
                    original_bullet_id="exp0_b0", original_text="Built services",
                    target_jd_keywords_to_inject=[], preserved_metrics=[],
                    strategic_instruction="REINFORCE",
                )],
                plausible_skills_to_add=[],
            ),
            WriterOutput: WriterOutput(
                rewritten_bullets=[RewrittenBullet(bullet_id="exp0_b0", rewritten_text="Built services")],
                updated_skills=[],
            ),
        }
        return make_provider_dispatching_by_schema(responses)

    resume = {"experience": [{"title": "Eng", "bullets": ["Built services"]}], "skills": []}
    verdicts = {"python": "partial", "kubernetes": "missing"}
    a = await run_tailoring_pipeline(resume, "Need Python.", 50, run(),
                                     make_mock_db_with_rows([]), cached_semantic_verdicts=verdicts)
    b = await run_tailoring_pipeline(resume, "Need Python.", 50, run(),
                                     make_mock_db_with_rows([]), cached_semantic_verdicts=verdicts)
    assert a.ats_score_before == b.ats_score_before


@pytest.mark.asyncio
async def test_the_after_analysis_is_never_served_from_the_cached_verdicts():
    """The cache describes the ORIGINAL resume. Reusing it for the post-tailor
    score would report the rewrite as having changed nothing semantically."""
    verify_calls = []
    responses = {
        # Two tools: the rewrite picks up Kubernetes lexically, Terraform stays
        # unmatched — so the post-tailor analysis still has something to verify.
        # (With nothing left unmatched it correctly makes no call at all.)
        _JDAnalysisWire: make_jd_analysis(exact_technical_tools=["Kubernetes", "Terraform"]),
        MappingPlan: MappingPlan(
            mapping_plan=[BulletMapping(
                original_bullet_id="exp0_b0", original_text="Built services",
                target_jd_keywords_to_inject=[], preserved_metrics=[],
                strategic_instruction="REINFORCE",
            )],
            plausible_skills_to_add=[],
        ),
        WriterOutput: WriterOutput(
            rewritten_bullets=[RewrittenBullet(
                bullet_id="exp0_b0", rewritten_text="Ran workloads on Kubernetes")],
            updated_skills=[],
        ),
    }
    provider = MagicMock()

    async def cs(system, user, schema, **kw):
        if schema is SemanticMatchResult:
            verify_calls.append(user)
            return SemanticMatchResult(verdicts=[])
        return responses[schema]

    provider.complete_structured = AsyncMock(side_effect=cs)
    resume = {"experience": [{"title": "Eng", "bullets": ["Built services"]}], "skills": []}

    await run_tailoring_pipeline(
        resume, "Need Kubernetes.", 50, provider, make_mock_db_with_rows([]),
        cached_semantic_verdicts={"kubernetes": "missing", "terraform": "missing"},
    )
    # Exactly one verification: the post-tailor one. The pre-tailor one was
    # served from the cache.
    assert len(verify_calls) == 1
    assert "Terraform" in verify_calls[0]


@pytest.mark.asyncio
async def test_pipeline_returns_the_jd_analysis_it_used():
    """The caller has to persist this. /ai/analyze caches Agent 1 on
    jd_row.parsed; /ai/tailor only ever READ that cache and never wrote it, so
    a JD tailored without being analyzed first had no cached analysis — and
    POST /ai/project-score 409s without one, which froze the review screen's
    live score for 35% of real sessions."""
    responses = {
        _JDAnalysisWire: make_jd_analysis(exact_technical_tools=["Python"]),
        MappingPlan: MappingPlan(
            mapping_plan=[BulletMapping(
                original_bullet_id="exp0_b0", original_text="Built services",
                target_jd_keywords_to_inject=[], preserved_metrics=[],
                strategic_instruction="REINFORCE",
            )],
            plausible_skills_to_add=[],
        ),
        WriterOutput: WriterOutput(
            rewritten_bullets=[RewrittenBullet(bullet_id="exp0_b0", rewritten_text="Built Python services")],
            updated_skills=[],
        ),
    }
    provider = make_provider_dispatching_by_schema(responses)
    resume = {"experience": [{"title": "Eng", "bullets": ["Built services"]}], "skills": []}

    result = await run_tailoring_pipeline(resume, "Need Python.", 50, provider, make_mock_db_with_rows([]))

    assert result.jd_analysis is not None
    assert result.jd_analysis.exact_technical_tools == ["Python"]


# ── strategic_instruction's transformation type is a real enum ───────────────
# Agent 2's rule 4 defines four transformation types and Agent 3's rule 9
# exact-matches the string "SKIP" to decide whether to copy the original
# through. But the field was a free-text str: "Skip — no JD connection" would
# silently miss that branch, and nothing in code ever checked it either.

from app.services.tailoring import _apply_writer_output as _apply_wo


def test_transformation_is_a_constrained_field():
    schema = MappingPlan.model_json_schema()["$defs"]["BulletMapping"]["properties"]
    assert "transformation" in schema


def test_transformation_only_accepts_the_four_documented_types():
    for t in ("REINFORCE", "REFRAME", "INJECT", "SKIP"):
        BulletMapping(
            original_bullet_id="exp0_b0", original_text="x", transformation=t,
            target_jd_keywords_to_inject=[], preserved_metrics=[],
            strategic_instruction="...",
        )
    with pytest.raises(Exception):
        BulletMapping(
            original_bullet_id="exp0_b0", original_text="x", transformation="Skip it",
            target_jd_keywords_to_inject=[], preserved_metrics=[],
            strategic_instruction="...",
        )


def test_a_skipped_bullet_keeps_its_original_text_even_if_agent3_rewrote_it():
    """Rule 9 is a prompt promise. A SKIP means Agent 2 found no honest JD
    connection, so a rewrite of it is not something to trust."""
    content = {"experience": [{"company": "A", "bullets": ["Built the checkout flow."]}]}
    indexed, _ = _index_bullets(content)
    plan = MappingPlan(
        mapping_plan=[BulletMapping(
            original_bullet_id="exp0_b0", original_text="Built the checkout flow.",
            transformation="SKIP", target_jd_keywords_to_inject=[],
            preserved_metrics=[], strategic_instruction="SKIP",
        )],
        plausible_skills_to_add=[],
    )
    writer = WriterOutput(
        rewritten_bullets=[RewrittenBullet(
            bullet_id="exp0_b0", rewritten_text="Engineered a Python checkout platform.")],
        updated_skills=[],
    )
    out = _apply_wo(indexed, writer, plan)
    assert out["experience"][0]["bullets"] == ["Built the checkout flow."]


def test_a_non_skipped_bullet_still_takes_the_rewrite():
    content = {"experience": [{"company": "A", "bullets": ["Built the checkout flow."]}]}
    indexed, _ = _index_bullets(content)
    plan = MappingPlan(
        mapping_plan=[BulletMapping(
            original_bullet_id="exp0_b0", original_text="Built the checkout flow.",
            transformation="REINFORCE", target_jd_keywords_to_inject=[],
            preserved_metrics=[], strategic_instruction="Use JD wording",
        )],
        plausible_skills_to_add=[],
    )
    writer = WriterOutput(
        rewritten_bullets=[RewrittenBullet(
            bullet_id="exp0_b0", rewritten_text="Engineered the checkout flow.")],
        updated_skills=[],
    )
    out = _apply_wo(indexed, writer, plan)
    assert out["experience"][0]["bullets"] == ["Engineered the checkout flow."]


# ── The inline Rewrite button gets the pipeline's rules ─────────────────────
# POST /ai/rewrite-bullet used a two-sentence prompt while Agent 3 used 1300
# words of rules plus a deterministic fact-lock. Same button, same user, much
# worse output — click "Rewrite" on a pipeline-written bullet and it got worse.

from app.services.tailoring import build_single_bullet_system


def test_the_single_bullet_prompt_carries_the_fact_lock_rule():
    p = build_single_bullet_system(50)
    assert "FACT LOCK" in p


def test_it_carries_the_preserve_specifics_rule():
    assert "PRESERVE SPECIFICS" in build_single_bullet_system(50)


def test_it_carries_the_same_hard_word_cap_as_the_pipeline():
    assert str(HARD_LIMITS["bullet_words"]["max"]) in build_single_bullet_system(50)


def test_it_carries_the_same_banned_phrase_list():
    p = build_single_bullet_system(50)
    for phrase in ("spearheaded", "leveraged", "results-driven"):
        assert phrase in p


def test_it_respects_the_humanize_level_like_agent3_does():
    assert build_single_bullet_system(10) != build_single_bullet_system(90)


def test_it_does_not_drag_in_the_mapping_plan_machinery():
    """A single bullet has no plan, no bullet_ids and no coverage rule — those
    would be instructions the model cannot follow."""
    p = build_single_bullet_system(50)
    assert "mapping_plan" not in p
    assert "COMPLETE COVERAGE" not in p


# ── Agent 3 omissions get a second chance, not a silent fallback ────────────
# Rule 10 calls omitting a bullet "the most common failure mode". The code
# fell back to the original and logged a warning — the user paid for a tailor
# that quietly did not happen on that line. Now that SKIP is a real enum we
# can tell a deliberate skip from a dropped one and re-request only the drops.

@pytest.mark.asyncio
async def test_agent3_omissions_are_re_requested():
    plan = MappingPlan(
        mapping_plan=[
            BulletMapping(original_bullet_id=f"exp0_b{i}", original_text=f"Did thing {i}",
                          transformation="REINFORCE", target_jd_keywords_to_inject=[],
                          preserved_metrics=[], strategic_instruction="x")
            for i in range(3)
        ],
        plausible_skills_to_add=[],
    )
    calls = []

    async def cs(system, user, schema, **kw):
        entries = json.loads(user)["mapping_plan"]
        ids = [e["original_bullet_id"] for e in entries]
        calls.append(ids)
        # First pass drops the last bullet; the retry answers in full.
        answer = ids if len(calls) > 1 else ids[:-1]
        return WriterOutput(
            rewritten_bullets=[RewrittenBullet(bullet_id=i, rewritten_text=f"Rewrote {i}") for i in answer],
            updated_skills=[],
        )

    provider = MagicMock()
    provider.complete_structured = AsyncMock(side_effect=cs)
    out = await _agent3_write(plan, [], 50, provider)

    assert len(calls) == 2, "expected a retry for the dropped bullet"
    assert calls[1] == ["exp0_b2"], "retry must ask for ONLY the dropped id"
    assert {b.bullet_id for b in out.rewritten_bullets} == {"exp0_b0", "exp0_b1", "exp0_b2"}


@pytest.mark.asyncio
async def test_a_deliberate_skip_is_not_mistaken_for_an_omission():
    """SKIP means Agent 2 found no honest JD connection. Re-requesting it would
    spend a premium call asking for a rewrite we would then throw away."""
    plan = MappingPlan(
        mapping_plan=[
            BulletMapping(original_bullet_id="exp0_b0", original_text="Did a thing",
                          transformation="REINFORCE", target_jd_keywords_to_inject=[],
                          preserved_metrics=[], strategic_instruction="x"),
            BulletMapping(original_bullet_id="exp0_b1", original_text="Ran the offsite",
                          transformation="SKIP", target_jd_keywords_to_inject=[],
                          preserved_metrics=[], strategic_instruction="SKIP"),
        ],
        plausible_skills_to_add=[],
    )
    calls = []

    async def cs(system, user, schema, **kw):
        calls.append(1)
        return WriterOutput(
            rewritten_bullets=[RewrittenBullet(bullet_id="exp0_b0", rewritten_text="Rewrote it")],
            updated_skills=[],
        )

    provider = MagicMock()
    provider.complete_structured = AsyncMock(side_effect=cs)
    await _agent3_write(plan, [], 50, provider)
    assert len(calls) == 1, "a SKIP must not trigger a retry"


@pytest.mark.asyncio
async def test_a_second_omission_is_accepted_rather_than_looping():
    plan = MappingPlan(
        mapping_plan=[BulletMapping(
            original_bullet_id="exp0_b0", original_text="Did a thing",
            transformation="REINFORCE", target_jd_keywords_to_inject=[],
            preserved_metrics=[], strategic_instruction="x")],
        plausible_skills_to_add=[],
    )
    calls = []

    async def cs(system, user, schema, **kw):
        calls.append(1)
        return WriterOutput(rewritten_bullets=[], updated_skills=[])

    provider = MagicMock()
    provider.complete_structured = AsyncMock(side_effect=cs)
    out = await _agent3_write(plan, [], 50, provider)
    assert len(calls) == 2, "exactly one retry, then give up"
    assert out.rewritten_bullets == []


# ── Honest additions start switched on ───────────────────────────────────────
# Every fix used to start off, so the "after" score measured rewording alone
# and sat below 50 on most JDs. Skills Agent 2 judged plausible from the
# résumé, and skills the user picked on the analyzer, are claims the user has
# already vouched for (or the evidence supports) — they now start on. A bare
# missing skill and every invented bullet still wait for an explicit yes.

@pytest.mark.asyncio
async def test_pipeline_defaults_plausible_and_priority_skills_on():
    from app.services.tailoring import GapFillerOutput, GapFillBullet

    responses = {
        _JDAnalysisWire: make_jd_analysis(
            exact_technical_tools=["Docker", "Terraform", "Kubernetes", "Rust"],
            importance={"docker": "high", "terraform": "high",
                        "kubernetes": "high", "rust": "high"},
        ),
        MappingPlan: MappingPlan(mapping_plan=[], plausible_skills_to_add=["Docker"]),
        WriterOutput: WriterOutput(rewritten_bullets=[], updated_skills=[]),
        GapFillerOutput: GapFillerOutput(bullets=[GapFillBullet(
            gap="Kubernetes", grounded=False, experience_index=None,
            bullet_text="Operated Kubernetes clusters in production.")]),
        InterviewQuestionsWrapper: InterviewQuestionsWrapper(questions=[]),
    }
    provider = make_provider_dispatching_by_schema(responses)
    resume = {"experience": [{"title": "E", "bullets": ["Wrote docs"]}], "skills": []}
    db = make_mock_db_with_rows([])

    result = await run_tailoring_pipeline(
        resume, "need Docker, Terraform, Kubernetes, Rust", 50, provider, db,
        priority_skills=["terraform"],
    )

    skill = {f.text.lower(): f for f in result.ats_fixes if f.type == "skill"}
    assert skill["docker"].default_accept is True       # plausible from the résumé
    assert skill["terraform"].default_accept is True    # the user asked for it
    assert skill["rust"].default_accept is False        # merely missing
    assert all(not f.default_accept for f in result.ats_fixes if f.type == "bullet")

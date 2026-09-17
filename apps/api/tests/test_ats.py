import pytest
from app.services.ats import (
    compute_delta, blend_scores, title_match_verdict, default_importance, DeltaResult,
)

def test_compute_delta_all_matched():
    jd_skills = ["Python", "FastAPI", "PostgreSQL"]
    resume_text = "Experienced with Python, FastAPI, and PostgreSQL databases."
    result = compute_delta(jd_skills, resume_text)
    assert isinstance(result, DeltaResult)
    assert set(result.matched) == {"Python", "FastAPI", "PostgreSQL"}
    assert result.missing == []
    assert result.ats_score == 100

def test_compute_delta_none_matched():
    jd_skills = ["Kubernetes", "Rust", "Terraform"]
    resume_text = "Expert in Python and JavaScript development."
    result = compute_delta(jd_skills, resume_text)
    assert result.matched == []
    assert set(result.missing) == {"Kubernetes", "Rust", "Terraform"}
    assert result.ats_score == 0

def test_compute_delta_partial_match():
    jd_skills = ["Python", "AWS", "Docker"]
    resume_text = "Python developer with Docker experience."
    result = compute_delta(jd_skills, resume_text)
    assert "Python" in result.matched
    assert "Docker" in result.matched
    assert "AWS" in result.missing
    assert result.ats_score == pytest.approx(66, abs=2)

def test_ats_score_is_0_to_100():
    result = compute_delta(["X", "Y"], "nothing relevant")
    assert 0 <= result.ats_score <= 100

def test_no_false_positive_on_substring():
    # "Java" must not match inside "JavaScript"
    result = compute_delta(["Java"], "5 years of JavaScript experience.")
    assert result.matched == []
    assert result.missing == ["Java"]

def test_matches_skill_ending_in_symbol():
    # Plain \b word-boundary regex fails on skills ending in non-word chars
    result = compute_delta(["C++", "C#"], "Proficient in C++ and C# development.")
    assert set(result.matched) == {"C++", "C#"}
    assert result.missing == []


# ── blend_scores — hybrid lexical + semantic scoring ─────────────────────────


def test_blend_scores_all_matched_is_100():
    result = blend_scores({"Python": "matched", "revenue forecasting": "matched"})
    assert result.ats_score == 100
    assert set(result.matched) == {"Python", "revenue forecasting"}
    assert result.missing == []


def test_blend_scores_partial_counts_half_and_stays_in_missing():
    # A "partial" verdict — the resume touches the theme but doesn't nail it —
    # is worth half a point and is still surfaced as a gap to strengthen.
    result = blend_scores({"Python": "matched", "stakeholder management": "partial"})
    assert result.ats_score == 75  # round(100 * 1.5 / 2)
    assert result.matched == ["Python"]
    assert result.missing == ["stakeholder management"]


def test_blend_scores_missing_is_zero():
    result = blend_scores({"Python": "matched", "Kubernetes": "missing"})
    assert result.ats_score == 50
    assert result.missing == ["Kubernetes"]


def test_blend_scores_responsibilities_weighted_lower():
    # 1 skill matched (weight 1.0, value 1.0) + 1 responsibility missing
    # (weight 0.5, value 0.0)  →  round(100 * 1.0 / 1.5) == 67
    result = blend_scores(
        {"Python": "matched"},
        {"mentor junior engineers on system design": "missing"},
    )
    assert result.ats_score == 67
    # Responsibilities never appear in the skill chips.
    assert result.matched == ["Python"]
    assert result.missing == []


def test_blend_scores_empty_returns_zero():
    result = blend_scores({})
    assert result.ats_score == 0
    assert result.matched == []
    assert result.missing == []


def test_blend_scores_unknown_verdict_treated_as_missing():
    result = blend_scores({"Python": "matched", "Rust": "banana"})
    assert result.ats_score == 50
    assert result.missing == ["Rust"]


def test_blend_scores_nice_to_have_weighted_lower_and_shown_in_chips():
    # 1 required matched (w1·v1) + 1 nice-to-have missing (w0.5·v0)
    #   -> round(100 * 1.0 / 1.5) == 67
    result = blend_scores(
        {"Python": "matched"},
        nice_to_have_verdicts={"GraphQL": "missing"},
    )
    assert result.ats_score == 67
    assert result.matched == ["Python"]
    assert result.missing == ["GraphQL"]  # still surfaced as a gap


def test_blend_scores_title_match_is_high_weight_bonus():
    # 1 required matched (w1) + title matched (w2)  ->  100
    result = blend_scores({"Python": "matched"}, title_verdict="matched")
    assert result.ats_score == 100


def test_blend_scores_missing_title_drags_score_down():
    # 1 required matched (w1·v1) + title missing (w2·v0) -> round(100 * 1/3)
    result = blend_scores({"Python": "matched"}, title_verdict="missing")
    assert result.ats_score == 33
    # title is never a skill chip
    assert result.matched == ["Python"]
    assert result.missing == []


def test_blend_scores_title_none_is_ignored():
    result = blend_scores({"Python": "matched"}, title_verdict=None)
    assert result.ats_score == 100


# ── title_match_verdict ─────────────────────────────────────────────────────


def test_title_match_exact_role_and_level():
    assert title_match_verdict(["Senior Data Analyst"], ["Senior Data Analyst"]) == "matched"


def test_title_match_same_role_ignores_formatting_and_word_order():
    assert title_match_verdict(["Data Analyst, Senior"], ["senior data  analyst"]) == "matched"


def test_title_match_right_role_wrong_seniority_is_partial():
    assert title_match_verdict(["Senior Data Analyst"], ["Data Analyst"]) == "partial"
    assert title_match_verdict(["Staff Software Engineer"], ["Software Engineer"]) == "partial"


def test_title_match_jd_without_level_matches_any_level():
    assert title_match_verdict(["Data Analyst"], ["Senior Data Analyst"]) == "matched"


def test_title_match_partial_on_strong_core_overlap():
    # "analytics engineer" vs "data analytics engineer" — 2/3 core tokens
    assert title_match_verdict(["Analytics Engineer"], ["Data Analytics Engineer"]) == "matched"
    assert title_match_verdict(["Machine Learning Engineer"], ["Machine Learning Scientist"]) == "partial"


def test_title_match_different_role_is_missing():
    assert title_match_verdict(["Data Analyst"], ["Marketing Manager"]) == "missing"


def test_title_match_checks_all_candidate_titles_and_takes_best():
    resume_titles = ["Marketing Manager", "Senior Data Analyst", "Intern"]
    assert title_match_verdict(["Data Analyst"], resume_titles) == "matched"


def test_title_match_empty_inputs_are_missing():
    assert title_match_verdict([], ["Data Analyst"]) == "missing"
    assert title_match_verdict(["Data Analyst"], []) == "missing"


# ── default_importance ──────────────────────────────────────────────────────


def test_default_importance_title_and_hard_tools_are_high():
    kw = dict(titles=["Senior Data Analyst"], hard_tools=["Python"],
              mediums=["Agile"], nice=["Looker"])
    assert default_importance("job title", **kw) == "high"
    assert default_importance("Senior Data Analyst", **kw) == "high"
    assert default_importance("Python", **kw) == "high"


def test_default_importance_mediums_and_unknown_are_medium():
    kw = dict(titles=[], hard_tools=["Python"], mediums=["Agile", "own the roadmap"], nice=[])
    assert default_importance("Agile", **kw) == "medium"
    assert default_importance("own the roadmap", **kw) == "medium"
    assert default_importance("something not in any list", **kw) == "medium"


def test_default_importance_nice_is_low():
    kw = dict(titles=[], hard_tools=[], mediums=[], nice=["Looker", "dbt"])
    assert default_importance("Looker", **kw) == "low"
    assert default_importance("DBT", **kw) == "low"  # case-insensitive


def test_default_importance_matches_case_insensitively():
    kw = dict(titles=["Data Analyst"], hard_tools=[], mediums=[], nice=[])
    assert default_importance("data analyst", **kw) == "high"


from types import SimpleNamespace
from app.services.ats import score_content, JdScore


def _jd(**kw):
    base = dict(exact_technical_tools=[], methodologies_and_frameworks=[],
               ats_filter_phrases=[], nice_to_have_skills=[],
               core_responsibilities=[], target_job_titles=[])
    base.update(kw)
    return SimpleNamespace(**base)


def test_score_content_lexical_hit_plus_semantic_verdict():
    jd = _jd(exact_technical_tools=["Python", "AWS"])
    content = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}
    # AWS not in the résumé; semantic verifier said "partial"
    out = score_content(content, jd, {"aws": "partial"})
    assert isinstance(out, JdScore)
    assert out.matched == ["Python"]
    assert out.missing == ["AWS"]
    assert out.ats_score == 75          # 1.0 + 0.5 over 2
    assert out.title_match == ""        # no target_job_titles


def test_score_content_scores_title_when_jd_has_one():
    jd = _jd(exact_technical_tools=["Python"], target_job_titles=["Senior Data Analyst"])
    content = {"headline": "Senior Data Analyst",
               "experience": [{"title": "Senior Data Analyst", "bullets": ["Used Python"]}],
               "skills": ["Python"]}
    out = score_content(content, jd, {})
    assert out.title_match == "matched"
    assert out.ats_score == 100


def test_score_content_nice_to_have_half_weight():
    jd = _jd(exact_technical_tools=["Python"], nice_to_have_skills=["Looker"])
    content = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}
    out = score_content(content, jd, {"looker": "missing"})
    assert out.ats_score == 67          # 1.0 over 1.5
    assert out.missing == ["Looker"]


from app.services.ats import AtsFix, apply_fix, apply_fixes, fix_slug


def _fix(**kw):
    base = dict(id="x", type="skill", gap="g", importance="medium",
                grounded=True, text="Kubernetes")
    base.update(kw)
    return AtsFix(**base)


def test_apply_fix_skill_appends_and_does_not_mutate():
    content = {"skills": ["Python"], "experience": []}
    out = apply_fix(content, _fix(type="skill", text="Kubernetes"))
    assert out["skills"] == ["Python", "Kubernetes"]
    assert content["skills"] == ["Python"]  # original untouched


def test_apply_fix_bullet_appends_to_the_named_experience():
    content = {"skills": [], "experience": [
        {"title": "A", "bullets": ["b1"]},
        {"title": "B", "bullets": ["b2"]},
    ]}
    out = apply_fix(content, _fix(type="bullet", text="Shipped X", experience_index=1))
    assert out["experience"][1]["bullets"] == ["b2", "Shipped X"]
    assert out["experience"][0]["bullets"] == ["b1"]


def test_apply_fix_headline_replaces():
    out = apply_fix({"headline": "old", "skills": [], "experience": []},
                    _fix(type="headline", text="Senior Data Analyst"))
    assert out["headline"] == "Senior Data Analyst"


def test_apply_fixes_skips_a_skill_past_the_cap_whole():
    content = {"skills": [f"s{i}" for i in range(20)], "experience": []}
    out = apply_fixes(content, [_fix(id="a", type="skill", text="OverflowSkill")])
    assert "OverflowSkill" not in out["skills"]
    assert len(out["skills"]) == 20


def test_apply_fixes_skips_a_bullet_past_the_role_cap_whole():
    content = {"skills": [], "experience": [{"title": "A", "bullets": [f"b{i}" for i in range(7)]}]}
    out = apply_fixes(content, [_fix(id="a", type="bullet", text="Eighth", experience_index=0)])
    assert "Eighth" not in out["experience"][0]["bullets"]
    assert len(out["experience"][0]["bullets"]) == 7


def test_fix_slug_is_stable_and_url_safe():
    assert fix_slug("bullet", "Revenue Forecasting & Planning!") == "bullet:revenue-forecasting-planning"


def test_apply_fix_skips_a_bullet_that_duplicates_an_existing_one():
    content = {"skills": [], "experience": [
        {"title": "E", "bullets": ["Led migration of core services to Kubernetes in production"]},
    ]}
    dup = _fix(type="bullet", experience_index=0,
               text="Led the migration of core services to Kubernetes in production.")
    out = apply_fix(content, dup)
    assert len(out["experience"][0]["bullets"]) == 1  # near-duplicate not appended


def test_apply_fixes_still_adds_a_genuinely_new_bullet():
    content = {"skills": [], "experience": [{"title": "E", "bullets": ["Managed CI pipelines"]}]}
    fix = _fix(type="bullet", experience_index=0, text="Ran production workloads on Kubernetes.")
    out = apply_fixes(content, [fix])
    assert "Ran production workloads on Kubernetes." in out["experience"][0]["bullets"]


from app.services.ats import estimate_fix_delta


def test_estimate_fix_delta_adding_a_matched_keyword_raises_score():
    jd = _jd(exact_technical_tools=["Python", "Kubernetes"])
    content = {"skills": ["Python"], "experience": [{"title": "E", "bullets": ["Used Python"]}]}
    base = score_content(content, jd, {"kubernetes": "missing"}).ats_score  # 50
    fix = AtsFix(id="s:k8s", type="skill", gap="Kubernetes", importance="high",
                 grounded=True, text="Kubernetes")
    delta = estimate_fix_delta(content, jd, {"kubernetes": "missing"}, base, fix)
    assert delta == 50  # 50 -> 100


def test_estimate_fix_delta_never_negative():
    jd = _jd(exact_technical_tools=["Python"])
    content = {"skills": ["Python"], "experience": []}
    base = score_content(content, jd, {}).ats_score  # 100
    fix = AtsFix(id="s:x", type="skill", gap="X", importance="low", grounded=True, text="X")
    assert estimate_fix_delta(content, jd, {}, base, fix) == 0


# ── Projects / achievements / leadership are part of the résumé's evidence ───
# Regression: build_resume_text used to walk only headline, summary,
# experience, education, skills, certifications and awards — so a fresher
# whose entire technical evidence lives in Projects scored against an
# effectively empty résumé.

from app.services.ats import build_resume_text


def test_build_resume_text_includes_project_bullets():
    content = {"projects": [{"name": "ML Pipeline", "tech_stack": "Python, Kubernetes",
                             "bullets": ["Built end-to-end ML pipelines."]}]}
    full_text, _ = build_resume_text(content)
    assert "Built end-to-end ML pipelines." in full_text


def test_build_resume_text_includes_project_name_and_tech_stack():
    content = {"projects": [{"name": "ML Pipeline", "tech_stack": "Python, Kubernetes", "bullets": []}]}
    full_text, _ = build_resume_text(content)
    assert "ML Pipeline" in full_text
    assert "Kubernetes" in full_text


def test_build_resume_text_includes_achievements_leadership_and_volunteer():
    content = {"achievements": ["Won the 2025 internal hackathon"],
               "leadership": ["Led the campus coding club"],
               "volunteer": ["Taught Python at a local school"]}
    full_text, _ = build_resume_text(content)
    assert "hackathon" in full_text
    assert "campus coding club" in full_text
    assert "Taught Python" in full_text


def test_build_resume_text_includes_language_names():
    content = {"languages": [{"name": "German", "level": "Fluent"}]}
    full_text, _ = build_resume_text(content)
    assert "German" in full_text


def test_score_content_credits_a_skill_evidenced_only_in_projects():
    jd = _jd(exact_technical_tools=["Kubernetes"])
    content = {"experience": [], "skills": [],
               "projects": [{"name": "Deploy tool",
                             "bullets": ["Shipped a service on Kubernetes."]}]}
    out = score_content(content, jd, {})
    assert out.matched == ["Kubernetes"]
    assert out.ats_score == 100


# ── Multi-word phrase matching is precision-first ────────────────────────────
# Regression: pass 3 matched a phrase when ⌈2/3⌉ of its >2-char tokens
# appeared ANYWHERE in the résumé, counting filler words ("through") and
# repeats ("growth"..."growth") as evidence. A marketing coordinator scored
# "distributed systems design" as matched. A lexical MISS is recovered by the
# semantic verifier downstream; a lexical FALSE POSITIVE is reviewed by
# nothing — so this pass must not guess.

from app.services.ats import _skill_matches


def _text(*segments: str) -> tuple[str, str]:
    return " | ".join(segments), ""


def test_phrase_not_matched_when_a_distinctive_token_is_absent():
    full, skills = _text("Designed systems for distributed content teams.")
    assert _skill_matches("distributed systems design", full, skills) is False


def test_filler_words_do_not_count_as_evidence():
    full, skills = _text("Ran growth campaigns driving revenue through referral programs.")
    assert _skill_matches("revenue growth through product-led growth", full, skills) is False


def test_a_repeated_token_counts_once_not_twice():
    full, skills = _text("Drove growth in growth markets.")
    assert _skill_matches("growth marketing growth strategy", full, skills) is False


def test_phrase_matched_when_every_token_appears_in_one_segment():
    full, skills = _text("Built end-to-end machine learning pipelines in Python.")
    assert _skill_matches("end-to-end machine learning pipelines", full, skills) is True


def test_tokens_scattered_across_separate_sections_do_not_match():
    full, skills = _text("Built machine tooling.", "Studied learning theory.", "Ran data pipelines.")
    assert _skill_matches("machine learning pipelines", full, skills) is False


def test_token_order_within_a_segment_does_not_matter():
    full, skills = _text("Pipelines for learning models, machine-driven.")
    assert _skill_matches("machine learning pipelines", full, skills) is True


def test_phrase_of_only_filler_words_never_matches():
    full, skills = _text("Worked with the team and the other teams.")
    assert _skill_matches("with the other", full, skills) is False


def test_exact_phrase_in_skills_list_still_wins():
    assert _skill_matches("Machine Learning", "", "Machine Learning | Python") is True


def test_exact_phrase_in_body_text_still_wins():
    full, skills = _text("Applied distributed systems design to the billing platform.")
    assert _skill_matches("distributed systems design", full, skills) is True


# ── Importance actually moves the score ──────────────────────────────────────
# Regression: Agent 1 rates every JD term high/medium/low, _backfill_importance
# guarantees full coverage, and the UI badges it — but blend_scores weighted
# every required phrase at 1.0, so missing a stated hard requirement cost
# exactly what missing a peripheral phrase cost.
#
# Multipliers are centred on medium = 1.0, so a JD with no importance data
# (an old cached parse) scores exactly as it did before this existed.


def test_missing_a_high_importance_skill_costs_more_than_a_low_one():
    verdicts = {"Kubernetes": "missing", "Figma": "matched"}
    lost_high = blend_scores(verdicts, importance={"kubernetes": "high", "figma": "low"})
    # Same two phrases, importance swapped: now the matched one is the
    # important one and the missing one is peripheral.
    lost_low = blend_scores(verdicts, importance={"kubernetes": "low", "figma": "high"})
    assert lost_high.ats_score < lost_low.ats_score


def test_high_importance_weight_is_three_times_low():
    high_missing = blend_scores({"A": "missing", "B": "matched"},
                                importance={"a": "high", "b": "low"})
    low_missing = blend_scores({"A": "matched", "B": "missing"},
                               importance={"a": "high", "b": "low"})
    # high=1.5, low=0.5 → missing the high one keeps 0.5/2.0; missing the low
    # one keeps 1.5/2.0.
    assert high_missing.ats_score == 25
    assert low_missing.ats_score == 75


def test_omitting_importance_scores_exactly_as_medium():
    verdicts = {"A": "matched", "B": "missing", "C": "partial"}
    assert blend_scores(verdicts).ats_score == blend_scores(
        verdicts, importance={"a": "medium", "b": "medium", "c": "medium"}
    ).ats_score


def test_unrated_term_falls_back_to_medium_not_zero():
    both_rated = blend_scores({"A": "matched", "B": "missing"},
                              importance={"a": "medium", "b": "medium"})
    one_unrated = blend_scores({"A": "matched", "B": "missing"}, importance={"a": "medium"})
    assert one_unrated.ats_score == both_rated.ats_score


def test_unknown_importance_level_falls_back_to_medium():
    assert blend_scores({"A": "matched", "B": "missing"},
                        importance={"a": "critical", "b": "whatever"}).ats_score == 50


def test_title_weight_scales_with_the_job_title_importance_rating():
    strong = blend_scores({"A": "matched"}, title_verdict="missing",
                          importance={"job title": "high"})
    weak = blend_scores({"A": "matched"}, title_verdict="missing",
                        importance={"job title": "low"})
    # A title miss should hurt more when the posting hinges on the title.
    assert strong.ats_score < weak.ats_score


def test_score_content_reads_importance_off_the_jd_analysis():
    jd = _jd(exact_technical_tools=["Kubernetes", "Figma"],
             importance={"kubernetes": "high", "figma": "low"})
    content = {"experience": [{"title": "Eng", "bullets": ["Used Figma"]}], "skills": ["Figma"]}
    out = score_content(content, jd, {})
    # Matched the low-importance one only → 0.5 of 2.0 weight.
    assert out.ats_score == 25


def test_score_content_without_importance_attribute_still_works():
    jd = _jd(exact_technical_tools=["Python"])
    content = {"experience": [], "skills": ["Python"]}
    assert score_content(content, jd, {}).ats_score == 100


def test_a_parenthesised_acronym_is_not_a_required_token():
    """"Search Engine Optimization (SEO)" must match a résumé that spells the
    term out. The acronym in parentheses is a gloss on the phrase, not a
    fourth word the résumé has to repeat."""
    full, skills = _text("Owned Search Engine Optimization for the marketing site.")
    assert _skill_matches("Search Engine Optimization (SEO)", full, skills) is True


def test_a_phrase_is_still_rejected_when_a_real_token_is_missing_despite_an_acronym():
    full, skills = _text("Owned Search Engine work for the marketing site.")
    assert _skill_matches("Search Engine Optimization (SEO)", full, skills) is False


# ── A fix is credited for the gap it exists to close ─────────────────────────
# estimate_fix_delta re-scored the patched résumé against the semantic verdicts
# computed BEFORE the fix, so only a fix whose text lexically echoed the JD
# phrase could move the number. A gap-filler bullet written in natural language
# scored +0 and the UI hides a zero delta entirely — so the only fixes that
# looked worth accepting were the ones that parroted the JD, which is precisely
# what Agent 2 rule 4 and Agent 3 rule 3 forbid. The score was teaching the
# opposite of the prompts.
#
# A gap-filler bullet is generated FOR one named gap, and accepting it is the
# user asserting it's true of them. So for estimation, that gap is covered.

from app.services.ats import verdicts_with_fixes


def _bullet_fix(gap: str, text: str) -> AtsFix:
    return AtsFix(id=fix_slug("bullet", gap), type="bullet", gap=gap, importance="high",
                  grounded=False, text=text, experience_index=0)


def test_a_fix_marks_its_own_gap_as_covered():
    assert verdicts_with_fixes({}, [_bullet_fix("CI/CD", "Automated releases")])["ci/cd"] == "matched"


def test_an_unrelated_gap_is_left_alone():
    out = verdicts_with_fixes({"kubernetes": "missing"}, [_bullet_fix("CI/CD", "x")])
    assert out["kubernetes"] == "missing"


def test_the_original_verdicts_are_not_mutated():
    original = {"ci/cd": "missing"}
    verdicts_with_fixes(original, [_bullet_fix("CI/CD", "x")])
    assert original == {"ci/cd": "missing"}


def test_no_fixes_leaves_the_verdicts_unchanged():
    assert verdicts_with_fixes({"a": "partial"}, []) == {"a": "partial"}


def test_a_naturally_worded_gap_bullet_now_scores_above_zero():
    """The regression this whole block exists for."""
    jd = _jd(exact_technical_tools=["Python"], ats_filter_phrases=["infrastructure as code"])
    content = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}
    base = score_content(content, jd, {}).ats_score
    fix = _bullet_fix("infrastructure as code",
                      "Automated cloud provisioning using declarative configuration templates.")
    assert estimate_fix_delta(content, jd, {}, base, fix) > 0


def test_a_keyword_echoing_bullet_is_not_worth_more_than_a_natural_one():
    """Both close the same gap, so both must be worth the same — otherwise the
    number still nudges the user toward parroting the JD."""
    jd = _jd(exact_technical_tools=["Python"], ats_filter_phrases=["infrastructure as code"])
    content = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}
    base = score_content(content, jd, {}).ats_score
    natural = _bullet_fix("infrastructure as code",
                          "Automated cloud provisioning using declarative configuration templates.")
    echoing = _bullet_fix("infrastructure as code",
                          "Managed infrastructure as code across staging and production.")
    assert estimate_fix_delta(content, jd, {}, base, natural) == \
           estimate_fix_delta(content, jd, {}, base, echoing)


def test_a_skill_fix_still_scores_the_same_as_before():
    jd = _jd(exact_technical_tools=["Python", "Kubernetes"])
    content = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}
    base = score_content(content, jd, {}).ats_score
    fix = AtsFix(id="skill:k8s", type="skill", gap="Kubernetes", importance="high",
                 grounded=True, text="Kubernetes")
    assert estimate_fix_delta(content, jd, {}, base, fix) == 50


def test_a_fix_for_a_gap_the_resume_already_covers_adds_nothing():
    jd = _jd(exact_technical_tools=["Python"])
    content = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}
    base = score_content(content, jd, {}).ats_score
    assert estimate_fix_delta(content, jd, {}, base, _bullet_fix("Python", "More Python work")) == 0

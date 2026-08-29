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

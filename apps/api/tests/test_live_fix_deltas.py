"""The "+N pts" on a fix must describe what ticking it does *now*.

Every badge used to be computed once, at pipeline time, against one fixed
hypothetical: every rewrite accepted and no fixes applied. The live score is
computed from the user's actual selections, so the two agreed only in a state
the user leaves the moment they touch anything — two fixes closing the same
gap both promised their full value, and the second delivered nothing.
"""
import pytest

from app.services.ats import (
    AtsFix, apply_fixes, credited_fixes, fix_deltas, score_content,
    verdicts_with_fixes, _MAX_SKILLS,
)
from app.services.tailoring import JDAnalysis

JD = JDAnalysis(
    job_title="Platform Engineer",
    exact_technical_tools=["Kubernetes", "Terraform", "Go"],
    methodologies_and_frameworks=["container orchestration"],
    domain_expertise_themes=[], seniority_indicators=[], ats_filter_phrases=[],
    importance={"kubernetes": "high", "terraform": "high", "go": "medium",
                "container orchestration": "high"},
)
CONTENT = {
    "contact": {"name": "A"}, "summary": "Engineer.",
    "experience": [{"title": "Engineer", "company": "X", "bullets": ["Shipped services."]}],
    "education": [], "skills": ["Python"],
}
VERDICTS = {"kubernetes": "missing", "terraform": "missing", "go": "missing",
            "container orchestration": "missing"}


def fix(fid, ftype, text, gap, idx=None):
    return AtsFix(id=fid, type=ftype, text=text, gap=gap, importance="high",
                  experience_index=idx, grounded=True)


K_SKILL = fix("k1", "skill", "Kubernetes", "Kubernetes")
K_BULLET = fix("k2", "bullet", "Ran production Kubernetes clusters.", "Kubernetes", 0)
TERRAFORM = fix("t1", "skill", "Terraform", "Terraform")


def score(content, fixes):
    return score_content(content, JD, verdicts_with_fixes(VERDICTS, credited_fixes(content, fixes))).ats_score


def test_a_gap_already_closed_is_worth_nothing_more():
    accepted = [K_SKILL]
    merged = apply_fixes(CONTENT, accepted)
    deltas = fix_deltas(merged, JD, VERDICTS, [K_SKILL, K_BULLET], accepted)
    assert deltas["k2"] == 0


def test_the_delta_is_exactly_what_ticking_it_moves():
    """The property the whole badge rests on."""
    accepted = [K_SKILL]
    merged = apply_fixes(CONTENT, accepted)
    before = score(merged, accepted)
    deltas = fix_deltas(merged, JD, VERDICTS, [K_SKILL, K_BULLET, TERRAFORM], accepted)

    after_accepted = accepted + [TERRAFORM]
    after = score(apply_fixes(CONTENT, after_accepted), after_accepted)
    assert after - before == deltas["t1"]


def test_an_accepted_fix_reports_what_removing_it_would_cost():
    accepted = [K_SKILL]
    merged = apply_fixes(CONTENT, accepted)
    deltas = fix_deltas(merged, JD, VERDICTS, [K_SKILL, TERRAFORM], accepted)
    assert deltas["k1"] == score(merged, accepted) - score(CONTENT, [])


def test_a_fix_the_cap_dropped_earns_no_credit():
    """Integrity: a gap is only closed by text that actually landed.

    verdicts_with_fixes credited the gap from the fix alone, so a skill the
    cap silently discarded still moved the score — the résumé scored for a
    keyword it did not contain.
    """
    full = {**CONTENT, "skills": [f"S{i}" for i in range(_MAX_SKILLS)]}
    merged = apply_fixes(full, [K_SKILL])
    assert "Kubernetes" not in merged["skills"]
    assert credited_fixes(merged, [K_SKILL]) == []
    assert score(merged, [K_SKILL]) == score(full, [])


def test_a_fix_that_landed_still_earns_its_credit():
    merged = apply_fixes(CONTENT, [K_SKILL])
    assert credited_fixes(merged, [K_SKILL]) == [K_SKILL]


def test_a_bullet_fix_counts_as_landed_only_when_its_text_is_there():
    merged = apply_fixes(CONTENT, [K_BULLET])
    assert credited_fixes(merged, [K_BULLET]) == [K_BULLET]
    assert credited_fixes(CONTENT, [K_BULLET]) == []

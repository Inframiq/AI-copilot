"""Deterministic fact-lock on Agent 3's rewrites.

Agent 3's prompt promises: preserved_metrics survive verbatim, no NEW number
appears, the word cap holds, banned filler stays out. Nothing enforced any of
it — the tailoring pipeline never ran a validator at all. These are the rules
that turn those promises into checks.
"""
import pytest
from app.services.bullet_guard import rewrite_violations, guard_rewrite


ORIG = "Reduced checkout latency by 40% for 2M monthly users."


# ── Fabricated metrics ───────────────────────────────────────────────────────

def test_a_number_absent_from_the_original_is_a_violation():
    v = rewrite_violations("Built the checkout flow.", "Built checkout flow serving 2M users.", [])
    assert v and any("2" in r for r in v)


def test_echoing_the_original_numbers_is_clean():
    assert rewrite_violations(ORIG, "Cut checkout latency 40% for 2M monthly users.", []) == []


def test_reordering_and_rewording_around_the_same_numbers_is_clean():
    assert rewrite_violations(ORIG, "Drove a 40% latency reduction across 2M monthly users.", []) == []


def test_dropping_a_number_is_allowed_when_it_is_not_a_preserved_metric():
    assert rewrite_violations(ORIG, "Cut checkout latency 40%.", []) == []


def test_a_changed_percentage_is_a_violation():
    v = rewrite_violations(ORIG, "Reduced checkout latency by 60% for 2M monthly users.", [])
    assert v and any("60" in r for r in v)


# ── Dropped preserved metrics ────────────────────────────────────────────────

def test_dropping_a_preserved_metric_is_a_violation():
    v = rewrite_violations(ORIG, "Cut checkout latency substantially.", ["40%"])
    assert v and any("40%" in r for r in v)


def test_keeping_every_preserved_metric_is_clean():
    assert rewrite_violations(ORIG, "Cut checkout latency 40% for 2M users.", ["40%", "2M"]) == []


# ── Length ───────────────────────────────────────────────────────────────────

def test_a_bullet_past_the_hard_word_cap_is_a_violation():
    long_bullet = "Engineered " + " ".join(["scalable"] * 40) + " systems."
    v = rewrite_violations("Built systems.", long_bullet, [])
    assert v and any("word" in r.lower() for r in v)


def test_a_bullet_inside_the_cap_is_clean():
    assert rewrite_violations("Built systems.", "Engineered resilient payment systems.", []) == []


# ── Banned filler ────────────────────────────────────────────────────────────

def test_a_banned_phrase_the_rewrite_introduced_is_a_violation():
    v = rewrite_violations("Led the payments team.", "Spearheaded the payments team.", [])
    assert v and any("spearheaded" in r.lower() for r in v)


def test_a_banned_phrase_already_in_the_original_is_tolerated():
    assert rewrite_violations(
        "Spearheaded the payments team.", "Spearheaded payments platform delivery.", []
    ) == []


# ── guard_rewrite: what the pipeline actually calls ──────────────────────────

def test_guard_returns_the_rewrite_when_it_is_clean():
    text, reasons = guard_rewrite(ORIG, "Cut checkout latency 40% for 2M monthly users.", [])
    assert text == "Cut checkout latency 40% for 2M monthly users."
    assert reasons == []


def test_guard_reverts_to_the_original_when_a_rule_is_broken():
    text, reasons = guard_rewrite("Built the checkout flow.", "Built checkout flow for 2M users.", [])
    assert text == "Built the checkout flow."
    assert reasons


def test_guard_leaves_an_unchanged_bullet_alone():
    text, reasons = guard_rewrite(ORIG, ORIG, ["40%", "2M"])
    assert text == ORIG
    assert reasons == []


# ── Invented tools ──────────────────────────────────────────────────────────
# The live eval caught a marketer's "Ran monthly reporting" rewritten as
# "Built monthly dashboards and reports using SQL" — SQL appears nowhere in
# that résumé. No number changed, so every metric check passed.

MARKETER = "Ran monthly reporting on campaign performance. Skills: Excel, Google Analytics"


def test_rejects_a_jd_tool_the_resume_never_mentions():
    v = rewrite_violations(
        "Ran monthly reporting on campaign performance",
        "Built monthly SQL reports on campaign performance",
        [], tool_terms=["SQL", "Tableau"], evidence_text=MARKETER,
    )
    assert any("SQL" in r for r in v)


def test_allows_a_tool_named_elsewhere_in_the_resume():
    assert rewrite_violations(
        "Built marketing pages for client campaigns",
        "Built marketing pages in React for client campaigns",
        [], tool_terms=["React"], evidence_text="Skills: JavaScript, React, CSS",
    ) == []


def test_matches_whole_terms_only():
    # "Java" is not claimed by a bullet that says JavaScript.
    assert rewrite_violations(
        "Built pages", "Built JavaScript pages", [],
        tool_terms=["Java"], evidence_text="Skills: JavaScript",
    ) == []


def test_tool_check_is_off_without_the_resume():
    # The single-bullet Rewrite endpoint has no JD tool list; unchanged there.
    assert rewrite_violations("Built reports", "Built SQL reports", [], tool_terms=["SQL"]) == []


def test_guard_reverts_an_invented_tool():
    text, reasons = guard_rewrite(
        "Ran monthly reporting", "Ran monthly SQL reporting", [],
        tool_terms=["SQL"], evidence_text=MARKETER,
    )
    assert text == "Ran monthly reporting"
    assert reasons


# ── Invented purpose clauses are cut, not reverted ──────────────────────────
# Each pair is real gpt-4.1-mini output from the eval run that motivated this.

from app.services.bullet_guard import strip_invented_tail


def test_cuts_an_invented_purpose_clause():
    assert strip_invented_tail(
        "Maintained the shared component library used across client projects",
        "Maintained the shared component library used across client projects to ensure consistency and reuse of UI elements.",
    ) == "Maintained the shared component library used across client projects."
    assert strip_invented_tail(
        "Fixed accessibility issues flagged in client audits",
        "Fixed web accessibility issues identified in client audits to improve compliance with accessibility standards.",
    ) == "Fixed web accessibility issues identified in client audits."
    assert strip_invented_tail(
        "Built marketing pages for client campaigns",
        "Built marketing pages for client campaigns, creating responsive interfaces that supported campaign goals.",
    ) == "Built marketing pages for client campaigns, creating responsive interfaces."


def test_keeps_a_purpose_the_original_states():
    original = "Rewrote the importer to improve reliability"
    assert strip_invented_tail(original, "Rewrote the CSV importer to improve reliability.") == \
        "Rewrote the CSV importer to improve reliability."


def test_keeps_result_clauses_that_are_not_padding():
    text = "Rebuilt the service scaffolding, cutting new service setup from 3 weeks to 2 days."
    assert strip_invented_tail("Rebuilt the service scaffolding", text) == text


def test_guard_applies_the_cut():
    text, reasons = guard_rewrite(
        "Fixed accessibility issues flagged in client audits",
        "Fixed accessibility issues flagged in client audits, ensuring compliance.", [],
    )
    assert text == "Fixed accessibility issues flagged in client audits."
    assert reasons == []


def test_a_practice_name_is_not_an_invented_tool():
    # "automated deployment pipelines" is CI/CD: the eval run reverted this.
    assert rewrite_violations(
        "Set up automated deployment pipelines that reduced release time from 2 hours to 15 minutes",
        "Set up CI/CD pipelines that cut release time from 2 hours to 15 minutes",
        [], tool_terms=["CI/CD", "Kubernetes"], evidence_text="Python, PostgreSQL",
    ) == []

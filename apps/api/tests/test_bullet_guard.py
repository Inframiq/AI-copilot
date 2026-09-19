"""Deterministic fact-lock on Agent 3's rewrites.

Agent 3's prompt promises: preserved_metrics survive verbatim, no NEW number
appears, the word cap holds, banned filler and invented endings stay out.
These checks turn those promises into FLAGS: the rewrite is kept, the reasons
go with it, and the review leaves it unticked for the candidate to decide.
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


# ── guard_rewrite: flags, never reverts ─────────────────────────────────────
# The candidate is the only one who knows whether a number is true, so a
# broken rule is surfaced for them to decide, not silently undone.

def test_guard_returns_a_clean_rewrite_with_no_flags():
    text, reasons = guard_rewrite(ORIG, "Cut checkout latency 40% for 2M monthly users.", [])
    assert text == "Cut checkout latency 40% for 2M monthly users."
    assert reasons == []


def test_guard_keeps_a_flagged_rewrite_and_says_why():
    text, reasons = guard_rewrite("Built the checkout flow.", "Built checkout flow for 2M users.", [])
    assert text == "Built checkout flow for 2M users."
    assert any("2" in r for r in reasons)


def test_guard_leaves_an_unchanged_bullet_alone():
    text, reasons = guard_rewrite(ORIG, ORIG, ["40%", "2M"])
    assert text == ORIG
    assert reasons == []


def test_flags_are_worded_for_the_candidate():
    _, reasons = guard_rewrite("Built the checkout flow.", "Built checkout flow for 2M users.", [])
    assert reasons == ["adds a number that isn't in your original: 2"]


def test_a_tool_the_resume_never_mentions_is_not_the_guards_call():
    # The review screen flags a JD term the résumé lacks and starts it unticked
    # (lib/point-kind.ts); the guard does not second-guess that choice.
    assert rewrite_violations("Ran monthly reporting", "Ran monthly SQL reporting", []) == []


# ── Invented endings ─────────────────────────────────────────────────────────
# Each rewrite is real gpt-4.1-mini output from the eval run that motivated this.

from app.services.bullet_guard import invented_tail


def test_flags_an_invented_purpose_clause():
    assert invented_tail(
        "Maintained the shared component library used across client projects",
        "Maintained the shared component library used across client projects to ensure consistency and reuse of UI elements.",
    ) == "to ensure consistency and reuse of UI elements"
    assert invented_tail(
        "Built marketing pages for client campaigns",
        "Built marketing pages for client campaigns, creating responsive interfaces that supported campaign goals.",
    ) == "that supported campaign goals"


def test_a_purpose_the_original_states_is_not_flagged():
    assert invented_tail(
        "Rewrote the importer to improve reliability",
        "Rewrote the CSV importer to improve reliability.",
    ) is None


def test_a_result_clause_is_not_padding():
    assert invented_tail(
        "Rebuilt the service scaffolding",
        "Rebuilt the service scaffolding, cutting new service setup from 3 weeks to 2 days.",
    ) is None


def test_guard_flags_an_invented_ending_and_keeps_the_text():
    rewritten = "Fixed accessibility issues flagged in client audits, ensuring compliance."
    text, reasons = guard_rewrite("Fixed accessibility issues flagged in client audits", rewritten, [])
    assert text == rewritten
    assert reasons == ["adds an ending your original doesn't say: \"ensuring compliance\""]

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

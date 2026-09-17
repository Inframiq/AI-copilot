"""Deterministic quality metrics for a tailoring run.

Each one measures a rule the Agent 2 / Agent 3 prompts state but that nothing
checked — so a prompt edit could make output worse in exactly the way the
prompt warns about and no one would know. Pure functions, no AI: the same
pair of résumés always produces the same numbers, which is what makes two
prompt revisions comparable.
"""
import pytest
from app.services.eval_metrics import (
    specificity_retention, keyword_concentration, verb_diversity, quantified_share,
)


# ── specificity_retention (Agent 2 rule 5, Agent 3 rule 3) ───────────────────
# "A bullet that loses the original's concrete specifics to sound more like
# the JD is a failure, even if it now matches better."

def test_a_rewrite_that_keeps_every_specific_scores_one():
    assert specificity_retention(
        ["Cut Redis cache latency 40% for Checkout"],
        ["Reduced Redis cache latency by 40% across Checkout"],
    ) == 1.0


def test_a_rewrite_that_drops_the_tool_and_number_scores_zero():
    assert specificity_retention(
        ["Cut Redis latency 40%"],
        ["Improved system performance significantly"],
    ) == 0.0


def test_dropping_half_the_specifics_scores_half():
    assert specificity_retention(["Used Redis and Kafka"], ["Used Redis"]) == 0.5


def test_a_bullet_with_no_specifics_is_excluded_rather_than_scored_zero():
    """An original with nothing concrete to lose can't fail this check —
    counting it as 0.0 would punish a rewrite for the original's vagueness."""
    assert specificity_retention(
        ["Worked on the team", "Used Redis"], ["Collaborated widely", "Used Redis"],
    ) == 1.0


def test_no_bullets_scores_one_not_a_division_error():
    assert specificity_retention([], []) == 1.0


def test_acronyms_count_as_specifics():
    assert specificity_retention(["Owned the ETL pipeline"], ["Ran the pipeline"]) == 0.0


def test_a_sentence_initial_capital_is_not_treated_as_a_proper_noun():
    """Every bullet starts with a capitalised verb; counting it would make the
    metric mostly measure whether the verb changed."""
    assert specificity_retention(["Managed the process"], ["Directed the process"]) == 1.0


# ── keyword_concentration (Agent 2 rule 4) ───────────────────────────────────
# "Do not inject the same target keyword into more than 2-3 bullets ... real
# ATS scoring penalizes that as gamed."

def test_a_keyword_spread_across_bullets_is_reported_per_keyword():
    out = keyword_concentration(
        ["Built Python services", "Wrote Python tooling", "Shipped a Go binary"],
        ["Python", "Go"],
    )
    assert out["Python"] == 2
    assert out["Go"] == 1


def test_a_keyword_absent_from_every_bullet_is_zero():
    assert keyword_concentration(["Built services"], ["Kubernetes"]) == {"Kubernetes": 0}


def test_a_keyword_counts_once_per_bullet_no_matter_how_often_it_repeats():
    assert keyword_concentration(["Python, Python, and more Python"], ["Python"]) == {"Python": 1}


def test_keyword_matching_is_case_insensitive():
    assert keyword_concentration(["built python services"], ["Python"]) == {"Python": 1}


def test_a_keyword_does_not_match_inside_a_longer_word():
    assert keyword_concentration(["Wrote JavaScript"], ["Java"]) == {"Java": 0}


# ── verb_diversity (Agent 3 rule 4) ──────────────────────────────────────────
# "Do not open more than one bullet with the same verb ... repeated verbs read
# as a thin vocabulary."

def test_all_distinct_opening_verbs_scores_one():
    assert verb_diversity(["Built X", "Shipped Y", "Reduced Z"]) == 1.0


def test_every_bullet_opening_with_the_same_verb_scores_low():
    assert verb_diversity(["Managed X", "Managed Y", "Managed Z"]) == pytest.approx(1 / 3)


def test_opening_verb_comparison_ignores_case():
    assert verb_diversity(["Managed X", "managed Y"]) == 0.5


def test_no_bullets_scores_one():
    assert verb_diversity([]) == 1.0


# ── quantified_share (Agent 3 rule 4's "quantify when the facts support it") ──

def test_the_share_of_bullets_carrying_a_number_is_reported():
    assert quantified_share(["Cut latency 40%", "Built the API"]) == 0.5


def test_no_bullets_has_no_quantified_share():
    assert quantified_share([]) == 0.0


# ── build_report: one comparable record per run ──────────────────────────────

from app.services.eval_metrics import build_report, compare_reports


def _report(**kw):
    base = dict(
        original_bullets=["Cut Redis latency 40%"],
        tailored_bullets=["Reduced Redis latency by 40%"],
        jd_keywords=["Redis"],
        ats_before=50, ats_after=70, reverted_bullets=[],
    )
    base.update(kw)
    return build_report(**base)


def test_the_report_records_the_score_movement():
    r = _report()
    assert r["ats_before"] == 50 and r["ats_after"] == 70 and r["ats_delta"] == 20


def test_the_report_counts_how_many_bullets_actually_changed():
    r = _report(
        original_bullets=["Cut Redis latency 40%", "Built the API"],
        tailored_bullets=["Reduced Redis latency by 40%", "Built the API"],
    )
    assert r["bullets_total"] == 2
    assert r["bullets_changed"] == 1


def test_the_revert_rate_is_the_share_of_bullets_the_fact_lock_rejected():
    r = _report(
        original_bullets=["a", "b", "c", "d"], tailored_bullets=["a", "b", "c", "d"],
        reverted_bullets=[{"bullet_id": "exp0_b0", "reasons": ["x"]}],
    )
    assert r["revert_rate"] == 0.25


def test_a_run_with_no_reverts_has_a_zero_revert_rate():
    assert _report()["revert_rate"] == 0.0


def test_the_report_flags_a_keyword_stuffed_past_the_prompt_limit():
    """Agent 2 rule 4 caps a keyword at 2-3 bullets. Four is the prompt's own
    definition of gamed, and the ATS score alone would reward it."""
    r = _report(
        original_bullets=["a"] * 4, tailored_bullets=["Used Python here"] * 4,
        jd_keywords=["Python"],
    )
    assert r["keyword_overuse"] == {"Python": 4}


def test_a_keyword_inside_the_limit_is_not_flagged():
    r = _report(
        original_bullets=["a"] * 3, tailored_bullets=["Used Python here"] * 3,
        jd_keywords=["Python"],
    )
    assert r["keyword_overuse"] == {}


def test_the_report_carries_the_prompt_rule_metrics():
    r = _report()
    for key in ("specificity_retention", "verb_diversity", "quantified_share", "max_bullet_words"):
        assert key in r


def test_the_report_records_the_longest_bullet_for_the_length_rule():
    r = _report(original_bullets=["a"], tailored_bullets=["one two three four five"])
    assert r["max_bullet_words"] == 5


# ── compare_reports: what changed between two prompt revisions ───────────────

def test_compare_reports_shows_the_delta_for_each_numeric_metric():
    before = _report(ats_after=60)
    after = _report(ats_after=80)
    diff = compare_reports(before, after)
    assert diff["ats_after"] == {"before": 60, "after": 80, "delta": 20}


def test_compare_reports_omits_metrics_that_did_not_move():
    diff = compare_reports(_report(), _report())
    assert diff == {}


def test_compare_reports_reports_a_regression_as_a_negative_delta():
    diff = compare_reports(_report(ats_after=80), _report(ats_after=60))
    assert diff["ats_after"]["delta"] == -20


# ── word_growth (Agent 3 rule 7) ─────────────────────────────────────────────
# "Say less, more precisely; do not pad a short accomplishment with filler to
# sound more substantial." The first live baseline run showed every rewrite
# ending in a comma + gerund clause restating its own first half — 1.61x mean
# growth, worst on the shortest originals — and every existing metric stayed
# green throughout. This is the one that catches it.

from app.services.eval_metrics import word_growth


def test_a_rewrite_of_the_same_length_scores_one():
    assert word_growth(["Built the checkout flow"], ["Shipped the checkout flow"]) == 1.0


def test_a_rewrite_that_doubles_the_word_count_scores_two():
    assert word_growth(["Built checkout"], ["Built the resilient checkout"]) == 2.0


def test_a_rewrite_that_tightens_the_bullet_scores_below_one():
    assert word_growth(["Built the very large checkout flow"], ["Built checkout"]) < 1.0


def test_unchanged_bullets_are_excluded_rather_than_diluting_the_signal():
    """A SKIPped bullet is 1.0 by definition; counting it would drag the mean
    toward 1.0 and hide padding in the bullets that were actually rewritten."""
    assert word_growth(
        ["Built checkout", "Untouched bullet here"],
        ["Built the resilient checkout", "Untouched bullet here"],
    ) == 2.0


def test_padding_a_short_bullet_weighs_as_heavily_as_padding_a_long_one():
    """Mean of per-bullet ratios, not ratio of totals — padding a short bullet
    is the pathology, and a totals ratio would let long bullets mask it."""
    assert word_growth(
        ["one two", "a b c d e f g h"],
        ["one two three four", "a b c d e f g h"],
    ) == 2.0


def test_an_empty_original_is_skipped_not_a_division_error():
    assert word_growth([""], ["Brand new bullet text"]) == 1.0


def test_no_bullets_scores_one():
    assert word_growth([], []) == 1.0


def test_the_report_carries_word_growth():
    assert "word_growth" in _report()


# ── specificity_retention: hyphenated compounds ──────────────────────────────
# Found by the first A/B run: "Led a squad of 6 engineers" -> "Directed a
# 6-engineer squad" scored 0.0 and dragged a fixture to 0.75, reported as a
# specificity regression caused by a prompt edit. The fact survived perfectly;
# the tokenizer just kept "6-engineer" whole so it never matched bare "6".
# A metric that cries wolf is worse than no metric.

def test_a_number_folded_into_a_hyphenated_compound_still_counts_as_kept():
    assert specificity_retention(
        ["Led a squad of 6 engineers"], ["Directed a 6-engineer squad"],
    ) == 1.0


def test_a_hyphenated_duration_still_counts_as_kept():
    assert specificity_retention(
        ["Cut setup from 3 weeks to 2 days"], ["Cut setup from a 3-week wait to 2-day turnaround"],
    ) == 1.0


def test_a_hyphenated_proper_noun_still_counts_as_kept():
    assert specificity_retention(["Ran the Redis cache"], ["Ran Redis-backed caching"]) == 1.0


def test_a_genuinely_dropped_number_is_still_caught():
    """The fix must not make the metric blind — only hyphenation-tolerant."""
    assert specificity_retention(["Led a squad of 6 engineers"], ["Directed the squad"]) == 0.0


def test_a_percentage_is_not_split_apart_by_the_fix():
    assert specificity_retention(["Cut latency 40%"], ["Reduced latency by 40%"]) == 1.0

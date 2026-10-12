"""A kept "tailored" point that lowers the score (testers' report: before 52,
48 with three rewrites on, every one of them badged ±0).

How it happened: the original bullet named a JD term word for word ("Oracle
Fusion"), so the score matched it lexically and the run never asked the
semantic checker about it — there was no stored verdict. The rewrite said
"the platform" instead. Kept, the term was neither in the text nor in any
verdict, so it scored missing: the total fell. Each badge was clamped at 0,
so the screen said the rewrites changed nothing.
"""
from app.services.ats import (
    bullet_deltas, lost_jd_terms, review_score, score_content, with_carried_terms,
)
from app.services.tailoring import (
    JDAnalysis, RewrittenBullet, WriterOutput, _guard_writer_output, _with_bullet,
)

JD = JDAnalysis(
    job_title="Functional Consultant",
    exact_technical_tools=["Oracle Fusion", "SQL"],
    methodologies_and_frameworks=["requirements gathering"],
    domain_expertise_themes=[], seniority_indicators=[], ats_filter_phrases=[],
    core_responsibilities=["run client workshops"],
    importance={"oracle fusion": "high", "sql": "medium", "requirements gathering": "medium",
                "run client workshops": "high"},
)
ORIGINAL_B0 = "Engaged client leadership on the Oracle Fusion rollout and led requirements gathering."
TAILORED_B0 = "Engaged client leadership by leading workshops and acting as trusted advisor on the platform."
ORIGINAL = {
    "contact": {"name": "M"}, "summary": "", "education": [], "skills": ["SQL"],
    "experience": [{"title": "Functional Consultant", "company": "Deloitte",
                    "bullets": [ORIGINAL_B0, "Built SQL reports for finance."]}],
}
MERGED_KEPT = _with_bullet(ORIGINAL, "exp0_b0", TAILORED_B0)

# What the run stores: "before" verdicts only for what the original missed
# lexically (+ responsibilities); "after" for what the tailored text missed.
BEFORE = {"run client workshops": "missing"}
RATIONALE = {"exp0_b0": {"responsibility": "run client workshops", "keywords": []}}
ORIGINALS = {"exp0_b0": ORIGINAL_B0}
TAILORED_BY_ID = {"exp0_b0": TAILORED_B0}


def _before_score():
    return score_content(ORIGINAL, JD, BEFORE).ats_score


def test_the_rewrite_loses_two_terms_the_original_matched():
    assert set(lost_jd_terms(ORIGINAL_B0, TAILORED_B0, JD)) == {"Oracle Fusion", "requirements gathering"}
    assert lost_jd_terms(ORIGINAL_B0, ORIGINAL_B0 + " Weekly.", JD) == []
    assert lost_jd_terms("", TAILORED_B0, JD) == []


def test_a_real_loss_lowers_the_score_and_the_badge_says_so():
    # The after-check agrees the terms are gone: keeping the rewrite really
    # does cost points — and the badge must be negative, not "±0".
    after = {"oracle fusion": "missing", "requirements gathering": "missing",
             "run client workshops": "matched"}
    rationale = with_carried_terms(RATIONALE, ORIGINALS, JD)
    kept = review_score(MERGED_KEPT, JD, BEFORE, after, rationale, ["exp0_b0"], [])
    assert kept < _before_score()
    delta = bullet_deltas(MERGED_KEPT, JD, BEFORE, after, rationale, ["exp0_b0"],
                          TAILORED_BY_ID, ORIGINALS, [])["exp0_b0"]
    assert delta < 0
    assert delta == kept - review_score(ORIGINAL, JD, BEFORE, after, rationale, [], [])


def test_a_faithful_rewording_keeps_its_credit():
    # The after-check found the terms still demonstrated in other words: the
    # kept rewrite must not be scored as if it dropped them.
    after = {"oracle fusion": "matched", "requirements gathering": "matched",
             "run client workshops": "matched"}
    rationale = with_carried_terms(RATIONALE, ORIGINALS, JD)
    kept = review_score(MERGED_KEPT, JD, BEFORE, after, rationale, ["exp0_b0"], [])
    assert kept >= _before_score()
    # Before the fix (no "carried" terms) the same pick scored lower than before.
    unfixed = review_score(MERGED_KEPT, JD, BEFORE, after, RATIONALE, ["exp0_b0"], [])
    assert unfixed < _before_score()


def test_nothing_kept_scores_exactly_the_before_score():
    after = {"oracle fusion": "missing", "requirements gathering": "missing"}
    rationale = with_carried_terms(RATIONALE, ORIGINALS, JD)
    assert review_score(ORIGINAL, JD, BEFORE, after, rationale, [], []) == _before_score()


def test_every_rewrite_gets_an_entry_even_without_target_terms():
    out = with_carried_terms({}, {"exp0_b1": "Built SQL reports for finance."}, JD)
    assert out["exp0_b1"]["carried"] == ["SQL"]
    assert out["exp0_b1"]["keywords"] == []
    # A copy: the stored rationale isn't changed underneath its owner.
    src = {"exp0_b0": {"responsibility": "x", "keywords": []}}
    with_carried_terms(src, ORIGINALS, JD)
    assert "carried" not in src["exp0_b0"]


def test_the_run_flags_a_rewrite_that_drops_a_keyword():
    indexed = {"experience": [{"bullets": [{"bullet_id": "exp0_b0", "text": ORIGINAL_B0}]}]}
    writer = WriterOutput(rewritten_bullets=[
        RewrittenBullet(reasoning="", bullet_id="exp0_b0", rewritten_text=TAILORED_B0),
    ], updated_skills=[])
    _, flagged = _guard_writer_output(indexed, writer, None, JD)
    assert len(flagged) == 1
    reason = flagged[0]["reasons"][-1]
    assert '"Oracle Fusion"' in reason and '"requirements gathering"' in reason
    assert "from the job that your original had" in reason


def test_a_rewrite_that_keeps_its_keywords_is_not_flagged_for_it():
    indexed = {"experience": [{"bullets": [{"bullet_id": "exp0_b0", "text": ORIGINAL_B0}]}]}
    kept_terms = "Led requirements gathering with client leadership for the Oracle Fusion rollout."
    writer = WriterOutput(rewritten_bullets=[
        RewrittenBullet(reasoning="", bullet_id="exp0_b0", rewritten_text=kept_terms),
    ], updated_skills=[])
    _, flagged = _guard_writer_output(indexed, writer, None, JD)
    assert not any("keyword" in r for f in flagged for r in f["reasons"])

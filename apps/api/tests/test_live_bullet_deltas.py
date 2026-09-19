"""The "+N pts" on a rewritten bullet, measured against the current picks.

The fix badges were made live; the rewrite badges were left computed once, at
pipeline time, as a leave-one-out from the all-accepted state. That is what
this rewrite is worth when every OTHER rewrite is also on — so with others
off it understates, sometimes badly: a bullet badged +38 moved the score +75.
"""
from app.services.ats import bullet_deltas, review_score
from app.services.tailoring import JDAnalysis, _with_bullet

JD = JDAnalysis(
    job_title="Business Analyst", exact_technical_tools=["SQL"],
    methodologies_and_frameworks=["global process management", "performance management"],
    domain_expertise_themes=["end-to-end commerce processes"],
    seniority_indicators=[], ats_filter_phrases=[],
    importance={"global process management": "high", "performance management": "high",
                "end-to-end commerce processes": "high", "sql": "medium"},
)
ORIGINAL = {
    "contact": {"name": "B"}, "summary": "Analyst.", "education": [], "skills": ["SQL"],
    "experience": [{"title": "Sr. Business Analyst", "company": "Cognizant", "bullets": [
        "Led cross-functional teams to align KPIs and OKRs across 4 global streams.",
        "Reduced Total Resolution Time by 24%."]}],
}
TAILORED_B0 = ("Coordinated global process management and performance management to align KPIs "
               "and OKRs across 4 global streams for end-to-end commerce processes.")
TAILORED_B1 = "Reduced Total Resolution Time by 24% across performance management reviews."
TAILORED = _with_bullet(_with_bullet(ORIGINAL, "exp0_b0", TAILORED_B0), "exp0_b1", TAILORED_B1)

BEFORE = {k: "missing" for k in JD.importance}
AFTER = {k: "matched" for k in JD.importance}
RATIONALE = {
    "exp0_b0": {"responsibility": "global process management",
                "keywords": ["global process management", "performance management",
                             "end-to-end commerce processes"]},
    "exp0_b1": {"responsibility": "performance management",
                "keywords": ["performance management"]},
}
ORIGINALS = {"exp0_b0": ORIGINAL["experience"][0]["bullets"][0],
             "exp0_b1": ORIGINAL["experience"][0]["bullets"][1]}
TAILORED_BY_ID = {"exp0_b0": TAILORED_B0, "exp0_b1": TAILORED_B1}


def score(content, accepted):
    return review_score(content, JD, BEFORE, AFTER, RATIONALE, accepted, [])


def deltas(merged, accepted):
    return bullet_deltas(merged, JD, BEFORE, AFTER, RATIONALE, accepted, TAILORED_BY_ID,
                         ORIGINALS, [])


def test_the_delta_is_what_ticking_it_moves_with_the_others_off():
    """The case reported: badge +38, score moved +75."""
    merged = _with_bullet(_with_bullet(TAILORED, "exp0_b0", ORIGINALS["exp0_b0"]),
                          "exp0_b1", ORIGINALS["exp0_b1"])
    accepted = []
    base = score(merged, accepted)
    d = deltas(merged, accepted)["exp0_b0"]
    on = _with_bullet(merged, "exp0_b0", TAILORED_B0)
    assert score(on, ["exp0_b0"]) - base == d


def test_the_delta_is_what_ticking_it_moves_with_the_others_on():
    merged = _with_bullet(TAILORED, "exp0_b0", ORIGINALS["exp0_b0"])
    accepted = ["exp0_b1"]
    base = score(merged, accepted)
    d = deltas(merged, accepted)["exp0_b0"]
    on = _with_bullet(merged, "exp0_b0", TAILORED_B0)
    assert score(on, accepted + ["exp0_b0"]) - base == d


def test_the_two_situations_give_different_numbers():
    """Otherwise the live value would be no better than the frozen one."""
    off = _with_bullet(_with_bullet(TAILORED, "exp0_b0", ORIGINALS["exp0_b0"]),
                       "exp0_b1", ORIGINALS["exp0_b1"])
    on = _with_bullet(TAILORED, "exp0_b0", ORIGINALS["exp0_b0"])
    assert deltas(off, [])["exp0_b0"] > deltas(on, ["exp0_b1"])["exp0_b0"]


def test_an_accepted_rewrite_reports_what_dropping_it_would_cost():
    accepted = ["exp0_b0", "exp0_b1"]
    base = score(TAILORED, accepted)
    d = deltas(TAILORED, accepted)["exp0_b0"]
    without = _with_bullet(TAILORED, "exp0_b0", ORIGINALS["exp0_b0"])
    assert base - score(without, ["exp0_b1"]) == d


def test_a_bullet_with_no_original_is_skipped_rather_than_guessed():
    # An older session sends no originals; reporting a wrong number would be
    # worse than reporting none.
    out = bullet_deltas(TAILORED, JD, BEFORE, AFTER, RATIONALE, ["exp0_b0"],
                        TAILORED_BY_ID, {}, [])
    assert out == {}

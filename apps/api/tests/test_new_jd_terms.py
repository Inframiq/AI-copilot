"""What a rewrite "adds": scored JD terms the original résumé got no credit
for. A term the score already credited — word for word or in other words —
is a rewording, not an addition, and moves the score by nothing."""
from app.services.ats import (
    credited_terms, new_jd_terms, review_score, with_carried_terms,
)
from app.services.tailoring import JDAnalysis

JD = JDAnalysis(
    job_title="Platform Engineer",
    exact_technical_tools=["CI/CD", "Kubernetes", "Python"],
    methodologies_and_frameworks=[],
    domain_expertise_themes=[], seniority_indicators=[], ats_filter_phrases=[],
    core_responsibilities=[],
)
ORIGINAL_B0 = "Built automated deployment pipelines for the payments team."
ORIGINAL = {
    "contact": {"name": "M"}, "summary": "", "education": [], "skills": ["Python"],
    "experience": [{"title": "Engineer", "company": "Acme", "bullets": [ORIGINAL_B0]}],
}
# The semantic pass found CI/CD in "automated deployment pipelines".
BEFORE = {"ci/cd": "matched", "kubernetes": "missing"}


def test_a_term_the_original_already_earned_in_other_words_is_not_new():
    credited = credited_terms(ORIGINAL, JD, ["Python"], BEFORE)
    assert new_jd_terms("Built CI/CD pipelines for the payments team.", JD, credited) == []


def test_a_term_the_original_matched_word_for_word_is_not_new():
    credited = credited_terms(ORIGINAL, JD, [], {})
    assert new_jd_terms("Automated Python deployments.", JD, credited) == []


def test_a_term_the_original_never_earned_is_new():
    credited = credited_terms(ORIGINAL, JD, ["Python"], BEFORE)
    assert new_jd_terms("Deployed services on Kubernetes with CI/CD.", JD, credited) == ["Kubernetes"]


def test_what_counts_as_new_is_what_moves_the_score():
    # Keeping the CI/CD rewording leaves the score where it was; keeping the
    # Kubernetes one raises it. The classification and the number agree.
    credited = credited_terms(ORIGINAL, JD, ["Python"], BEFORE)
    after = {"ci/cd": "matched", "kubernetes": "matched"}

    def kept(text: str) -> int:
        merged = {**ORIGINAL, "experience": [{**ORIGINAL["experience"][0], "bullets": [text]}]}
        rationale = with_carried_terms({"exp0_b0": {"responsibility": "", "keywords": []}},
                                       {"exp0_b0": ORIGINAL_B0}, JD)
        return review_score(merged, JD, BEFORE, after, rationale, ["exp0_b0"], [])

    base = review_score(ORIGINAL, JD, BEFORE, after, {}, [], [])
    reworded = "Built CI/CD pipelines for the payments team."
    added = "Built CI/CD pipelines on Kubernetes for the payments team."
    assert new_jd_terms(reworded, JD, credited) == [] and kept(reworded) == base
    assert new_jd_terms(added, JD, credited) == ["Kubernetes"] and kept(added) > base

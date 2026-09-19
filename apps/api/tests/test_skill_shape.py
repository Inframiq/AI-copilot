"""What is allowed to become a chip in the Skills section.

Two faults reported from the review screen: suggestions that read as
sentences rather than skill names, and suggestions for skills the résumé
already lists.
"""
import pytest

from app.services.tailoring import _looks_like_a_skill, skill_candidates


@pytest.mark.parametrize("name", ["Python", "CI/CD", "Lean Six Sigma", "Stakeholder Management",
                                  "Node.js", "C++", "Google Cloud Platform"])
def test_real_skill_names_pass(name):
    assert _looks_like_a_skill(name)


@pytest.mark.parametrize("phrase", [
    # JD phrases reach the skill list straight from missing_skills, and Agent 1
    # writes responsibilities and filter phrases as prose.
    "container orchestration at scale for large teams",
    "revenue growth through product-led growth motions",
    "experience with distributed systems design and delivery",
])
def test_prose_never_becomes_a_skill(phrase):
    assert not _looks_like_a_skill(phrase)


def test_the_word_ceiling_matches_the_rule_we_state():
    # The parse prompt tells the model "1 to 4 words"; the code allowed six,
    # so five- and six-word phrases arrived looking like sentences.
    assert _looks_like_a_skill("One Two Three Four")
    assert not _looks_like_a_skill("One Two Three Four Five")


class TestSkillCandidates:
    def test_drops_prose_from_the_missing_list(self):
        out = skill_candidates(
            missing=["Kubernetes", "experience with distributed systems design and delivery"],
            plausible=[], existing=[],
        )
        assert out == ["Kubernetes"]

    def test_never_suggests_a_skill_the_resume_already_lists(self):
        out = skill_candidates(missing=["Python", "Go"], plausible=["Python"], existing=["python"])
        assert out == ["Go"]

    def test_keeps_one_of_each_name_regardless_of_case(self):
        out = skill_candidates(missing=["Go", "go"], plausible=["GO"], existing=[])
        assert out == ["Go"]

    def test_missing_comes_before_plausible(self):
        out = skill_candidates(missing=["Terraform"], plausible=["Docker"], existing=[])
        assert out == ["Terraform", "Docker"]

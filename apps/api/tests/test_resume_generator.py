"""Tests for the resume generation pipeline (services/resume_generator.py).

The AI calls are mocked with a provider that echoes content back unchanged
(no fabrication) so these tests exercise the deterministic parts that
matter most: selection under HARD_LIMITS, exclusion of irrelevant content,
and validation/compression against real page counts — not prompt wording,
which needs a real model to judge.
"""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.services.resume_generator import (
    generate_resume,
    SelectionPlan,
    RelevanceTier,
    WrittenBullets,
    RewrittenItem,
    SummaryPlan,
)
from app.services.resume_spec import HARD_LIMITS


def make_generator_provider(exclude_ids: frozenset[str] = frozenset()):
    """A fake AIProvider for the generator's 3 agents:
    - SelectionPlan: tiers everything CORE except explicitly excluded ids.
    - WrittenBullets: echoes each item's raw text back unchanged (proves
      the pipeline never adds facts the mock didn't put there).
    - SummaryPlan: always "none" — summary/objective wording quality isn't
      what these tests are about, and omitting is spec-valid.
    """
    async def fake_complete_structured(system, user, schema, model_tier="fast"):
        if schema is SelectionPlan:
            payload = json.loads(user)
            tiers = [
                RelevanceTier(item_id=item_id, tier="EXCLUDE" if item_id in exclude_ids else "CORE")
                for item_id in payload.get("items", {})
            ]
            return SelectionPlan(tiers=tiers)
        if schema is WrittenBullets:
            items: dict[str, str] = json.loads(user)
            return WrittenBullets(bullets=[RewrittenItem(item_id=k, text=v) for k, v in items.items()])
        if schema is SummaryPlan:
            return SummaryPlan(headline="", kind="none", text="")
        raise AssertionError(f"unexpected schema {schema}")

    provider = MagicMock()
    provider.complete_structured = AsyncMock(side_effect=fake_complete_structured)
    return provider


# Two word banks with coprime-ish lengths (13, 17) so cycling through both by
# plain index keeps consecutive/nearby bullets textually distinct — the
# validator's cross-section duplicate check flags near-identical bullets
# (SequenceMatcher ratio > 0.9), which a naive "same template, different
# number" fixture would trigger and make these tests self-defeating.
_VERBS = ["Redesigned", "Migrated", "Automated", "Refactored", "Optimized", "Implemented", "Debugged",
          "Launched", "Streamlined", "Consolidated", "Rebuilt", "Extended", "Hardened"]
_SYSTEMS = ["the checkout service", "the reporting pipeline", "the auth module", "the search index",
            "the billing workflow", "the deployment process", "the notification system",
            "the admin dashboard", "the inventory tracker", "the recommendation engine",
            "the onboarding flow", "the audit log system", "the rate limiter", "the file upload service",
            "the metrics collector", "the scheduling service", "the customer support tool"]


def _bullet_text(i: int) -> str:
    return f"{_VERBS[i % len(_VERBS)]} {_SYSTEMS[i % len(_SYSTEMS)]} (item {i})"


def _job(company: str, n_bullets: int, offset: int = 0) -> dict:
    # offset keeps bullet text distinguishable across different jobs in the
    # same test — see the word-bank comment above.
    return {
        "company": company,
        "title": "Engineer",
        "start": "2022",
        "end": "2024",
        "bullets": [_bullet_text(offset + i) for i in range(n_bullets)],
    }


def _project(name: str, n_bullets: int = 2, offset: int = 0) -> dict:
    return {"name": name, "bullets": [_bullet_text(offset + i) for i in range(n_bullets)]}


@pytest.mark.asyncio
async def test_sparse_fresher_profile_does_not_fabricate_content():
    """Scenario 1 — a sparse fresher profile: the generator must not invent
    sections or items the candidate never provided."""
    profile = {
        "contact": {"name": "Alex Fresher", "email": "alex@example.com"},
        "education": [{"institution": "State University", "degree": "BSc CS", "year": "2024"}],
        "projects": [_project("Todo App", 2)],
        "skills": ["Python", "Git"],
    }
    provider = make_generator_provider()

    result = await generate_resume(profile, "fresher", provider, target_role="Junior Developer")

    content = result.resume_content
    assert content["experience"] == []
    assert content["certifications"] == []
    assert content["achievements"] == []
    assert content["awards"] == []
    assert content["leadership"] == []
    assert content["volunteer"] == []
    assert len(content["projects"]) == 1
    assert "summary" not in content and "objective" not in content


@pytest.mark.asyncio
async def test_large_fresher_profile_respects_hard_caps():
    """Scenario 2 — a fresher profile with far more content than the spec
    allows must be trimmed to the hard caps, never padded, never dropped
    to zero either."""
    profile = {
        "contact": {"name": "Sam Prolific", "email": "sam@example.com"},
        "education": [{"institution": "Tech College", "degree": "BSc CS", "year": "2024"}],
        "experience": [_job("Startup Inc", 10)],
        "projects": [_project(f"Project {i}", 3, offset=i * 10) for i in range(8)],
        "certifications": [f"Certification {i}" for i in range(10)],
        "achievements": [f"Achievement {i}" for i in range(8)],
        "skills": ["Python", "Go", "React", "SQL", "Docker"],
    }
    provider = make_generator_provider()

    result = await generate_resume(profile, "fresher", provider, target_role="Software Engineer")

    content = result.resume_content
    exp_limits = HARD_LIMITS["experience_bullets_per_role"]
    assert len(content["experience"][0]["bullets"]) <= exp_limits["prefer_max"]
    assert 0 < len(content["projects"]) <= HARD_LIMITS["projects"]["max"]
    assert len(content["certifications"]) <= HARD_LIMITS["certifications"]["max"]
    assert len(content["achievements"]) <= HARD_LIMITS["achievements"]["max"]
    for p in content["projects"]:
        assert len(p["bullets"]) <= HARD_LIMITS["project_bullets"]["max"]


@pytest.mark.asyncio
async def test_experienced_professional_profile():
    """Scenario 3 — an experienced professional's resume is built under the
    "experienced" candidate type and its (looser, 2-page) page limit."""
    profile = {
        "contact": {"name": "Jordan Senior", "email": "jordan@example.com"},
        "education": [{"institution": "State University", "degree": "MSc CS", "year": "2015"}],
        "experience": [_job("BigCo", 5, offset=0), _job("MidCo", 4, offset=100), _job("StartCo", 3, offset=200)],
        "skills": {"Backend": ["Python", "Go"], "Cloud": ["AWS", "Kubernetes"]},
        "certifications": ["AWS Certified Solutions Architect"],
    }
    provider = make_generator_provider()

    result = await generate_resume(profile, "experienced", provider, target_role="Staff Engineer")

    assert result.candidate_type == "experienced"
    assert len(result.resume_content["experience"]) == 3
    for job in result.resume_content["experience"]:
        assert len(job["bullets"]) <= HARD_LIMITS["experience_bullets_per_role"]["prefer_max"]
    # 2-page hard max for experienced candidates, enforced via a real render.
    page_violations = [v for v in result.validation.violations if v.section == "Page count"]
    assert page_violations == []


@pytest.mark.asyncio
async def test_oversized_summary_gets_truncated_to_the_word_cap():
    """HARD_LIMITS["summary"]["max_words"] is declared and checked by the
    validator, but nothing previously acted on that violation — the
    compression loop had no branch for "Summary"/"Objective", so an
    oversized summary was flagged and then returned unfixed. This locks in
    the fix: a summary over the cap must come back at or under it."""
    profile = {
        "contact": {"name": "Taylor Candidate", "email": "taylor@example.com"},
        "education": [{"institution": "State University", "degree": "BSc CS", "year": "2023"}],
        "experience": [_job("Acme", 3)],
        "skills": ["Python"],
    }
    max_words = HARD_LIMITS["summary"]["max_words"]
    oversized_summary = " ".join(f"word{i}" for i in range(max_words + 40))

    async def fake_complete_structured(system, user, schema, model_tier="fast"):
        if schema is SelectionPlan:
            payload = json.loads(user)
            return SelectionPlan(tiers=[
                RelevanceTier(item_id=item_id, tier="CORE") for item_id in payload.get("items", {})
            ])
        if schema is WrittenBullets:
            items: dict[str, str] = json.loads(user)
            return WrittenBullets(bullets=[RewrittenItem(item_id=k, text=v) for k, v in items.items()])
        if schema is SummaryPlan:
            return SummaryPlan(headline="", kind="summary", text=oversized_summary)
        raise AssertionError(f"unexpected schema {schema}")

    provider = MagicMock()
    provider.complete_structured = AsyncMock(side_effect=fake_complete_structured)

    result = await generate_resume(profile, "fresher", provider, target_role="Backend Developer")

    final_word_count = len(result.resume_content["summary"].split())
    assert final_word_count <= max_words
    summary_violations = [v for v in result.validation.violations if v.section == "Summary"]
    assert summary_violations == []


@pytest.mark.asyncio
async def test_irrelevant_content_is_excluded():
    """Scenario 4 — content classified EXCLUDE (irrelevant to the target
    role) must not appear anywhere in the final resume, even though it was
    present in the raw profile and under any numeric cap."""
    profile = {
        "contact": {"name": "Taylor Candidate", "email": "taylor@example.com"},
        "education": [{"institution": "State University", "degree": "BSc CS", "year": "2023"}],
        "experience": [_job("Acme", 3)],
        "achievements": ["Relevant hackathon win using the target stack", "Enjoys recreational fishing on weekends"],
        "skills": ["Python"],
    }
    # achievement1 is the irrelevant fishing hobby entry.
    provider = make_generator_provider(exclude_ids=frozenset({"achievement1"}))

    result = await generate_resume(profile, "fresher", provider, target_role="Backend Developer")

    achievements = result.resume_content["achievements"]
    assert all("fishing" not in a.lower() for a in achievements)
    assert any("hackathon" in a.lower() for a in achievements)


@pytest.mark.asyncio
async def test_many_projects_and_certifications_get_capped():
    """Scenario 5 — even when every project/certification is classified
    CORE, the hard maximums still apply: strength doesn't waive the cap."""
    profile = {
        "contact": {"name": "Morgan Builder", "email": "morgan@example.com"},
        "education": [{"institution": "Tech Institute", "degree": "BSc CS", "year": "2024"}],
        "projects": [_project(f"Project {i}", 2, offset=i * 10) for i in range(10)],
        "certifications": [f"Certification {i}" for i in range(12)],
        "skills": ["Python", "Java"],
    }
    provider = make_generator_provider()

    result = await generate_resume(profile, "fresher", provider, target_role="Software Engineer")

    assert len(result.resume_content["projects"]) == HARD_LIMITS["projects"]["max"]
    assert len(result.resume_content["certifications"]) == HARD_LIMITS["certifications"]["max"]

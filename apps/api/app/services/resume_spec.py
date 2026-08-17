"""Structural specification for generated resumes: candidate types, section
order, and hard content limits.

This module is pure data/config — no AI calls, no I/O. It exists so the
generator, the validator, and the PDF renderer all read the exact same
limits and ordering instead of each hardcoding their own copy.

Source: the resume spec provided by the product owner (structural
reference images + written limits). These are MAXIMUMS, not targets —
callers must never pad content to reach them.
"""
from typing import Literal

CandidateType = Literal["fresher", "experienced"]

# ── Section order per candidate type ─────────────────────────────────────────
# A section absent from resume_content (empty list/None) is simply skipped —
# this list only controls ORDER, not presence. "summary_or_objective" is a
# single slot: the generator picks one of the two (never both) or omits it.

SECTION_ORDER: dict[CandidateType, list[str]] = {
    "fresher": [
        "header",
        "summary_or_objective",
        "education",
        "skills",
        "projects",
        "experience",
        "certifications",
        "achievements",
        "leadership",
        "links",
    ],
    "experienced": [
        "header",
        "summary_or_objective",
        "skills",
        "experience",
        "education",
        "certifications",
        "projects",
        "achievements",
        "leadership",
        "links",
    ],
}

# Sections that are always allowed to render if content exists, even though
# they aren't on either candidate type's canonical rung (the spec says to
# include these "only when relevant/useful", not at a fixed position).
# These render at the end, after the candidate type's own ordered list.
TRAILING_OPTIONAL_SECTIONS = ["languages", "awards", "volunteer"]

# ── Hard content limits ───────────────────────────────────────────────────────
# All counts are (min, max) where min=0 unless noted; "target" is what the
# generator should aim for when it has a choice, "max" is the hard ceiling
# the validator enforces.

HARD_LIMITS = {
    "summary": {"min_words": 40, "max_words": 80},
    "objective": {"min_words": 25, "max_words": 50},
    "experience_bullets_per_role": {"min": 3, "max": 7, "prefer_max": 5},
    "internship_bullets_per_role": {"min": 2, "max": 5},
    "projects": {"min": 0, "max": 4, "prefer_min": 2},
    "project_bullets": {"min": 2, "max": 4},
    "education_entries": {"min": 1, "max": 3},
    "skill_categories": {"min": 3, "max": 6},
    "skills_per_category": {"min": 2, "max": 6},
    "certifications": {"min": 1, "max": 6},
    "achievements": {"min": 2, "max": 5},
    "awards": {"min": 1, "max": 5},
    "leadership": {"min": 1, "max": 4},
    "volunteer": {"min": 1, "max": 3},
    # Bullet prose style, applies to every bullet regardless of section.
    "bullet_words": {"prefer_min": 15, "prefer_max": 28, "max": 35},
}

PAGE_LIMITS: dict[CandidateType, dict[str, int]] = {
    "fresher": {"target": 1, "max": 1},
    "experienced": {"target": 1, "max": 2},
}

# Generic filler the spec explicitly calls out — flagged by the validator and
# stripped/avoided by the bullet writer unless a word is genuinely load-
# bearing (rare enough that we just ban the list outright).
BANNED_GENERIC_PHRASES = [
    "passionate",
    "motivated",
    "hardworking",
    "hard-working",
    "results-driven",
    "results driven",
    "highly innovative",
    "seamless",
    "seamlessly",
    "dynamic",
    "team player",
    "go-getter",
    "self-starter",
    "detail-oriented",
    "excellent communication skills",
    "proven track record",
    "synergy",
    "think outside the box",
    # Independently cited across 5+ 2026 sources as the most-flagged
    # AI-generated-resume tells — one (spearheaded) was previously an
    # example verb in the Agent 3 prompt itself. See docs/ai-pipeline.md.
    "spearheaded",
    "leveraged",
    "orchestrated",
    "pivotal",
    "delve",
]

# Content classification tiers used by the relevance filter (resume_generator.py).
ContentTier = Literal["CORE", "SUPPORTING", "OPTIONAL", "EXCLUDE"]

# Maps a section_order key to the resume_content dict key(s) that must be
# non-empty for that section to actually have something to render. Used by
# resolve_section_order below and by the PDF templates' section-order loop.
_SECTION_CONTENT_KEYS: dict[str, list[str]] = {
    "header": ["contact"],
    "summary_or_objective": ["summary", "objective"],
    "education": ["education"],
    "skills": ["skills"],
    "projects": ["projects"],
    "experience": ["experience"],
    "certifications": ["certifications"],
    "achievements": ["achievements"],
    "leadership": ["leadership"],
    "languages": ["languages"],
    "awards": ["awards"],
    "volunteer": ["volunteer"],
}


def resolve_section_order(candidate_type: CandidateType, resume_content: dict) -> list[str]:
    """Return the final, content-aware section order for this resume.

    Starts from the candidate type's canonical order, drops any section with
    no actual content (so omitting a weak section actually removes it from
    the page, not just reorders it), then appends any trailing-optional
    section that does have content.
    """

    def has_content(section: str) -> bool:
        if section == "links":
            # A compact links line is only worth its own slot for a
            # portfolio/website URL — LinkedIn/GitHub are already shown in
            # the header's contact line by every template.
            return bool((resume_content.get("contact") or {}).get("website"))
        for key in _SECTION_CONTENT_KEYS.get(section, [section]):
            value = resume_content.get(key)
            if value:
                return True
        return False

    ordered = [s for s in SECTION_ORDER[candidate_type] if has_content(s)]
    for section in TRAILING_OPTIONAL_SECTIONS:
        if section not in ordered and has_content(section):
            ordered.append(section)
    return ordered

"""Deterministic post-generation validator for resume content.

No AI calls here on purpose — every check is a plain, reproducible rule
against resume_spec.py's limits, so the same resume always produces the
same violations. The compression pass (resume_generator.py) re-runs this
after each edit until it's clean or gives up.
"""
import difflib
import re
from collections import Counter
from dataclasses import dataclass, field

from app.services.pdf import count_pdf_pages
from app.services.resume_spec import (
    BANNED_GENERIC_PHRASES,
    CandidateType,
    HARD_LIMITS,
    PAGE_LIMITS,
)

_WORD_RE = re.compile(r"[A-Za-z0-9']+")
_METRIC_RE = re.compile(
    r"\d+(\.\d+)?\s*%|\$\s?\d|\b\d{2,}\s*(users|customers|clients|requests|"
    r"downloads|installs|members|employees|engineers|orders|transactions)\b",
    re.IGNORECASE,
)


def _word_count(text: str) -> int:
    return len(_WORD_RE.findall(text or ""))


@dataclass
class Violation:
    section: str
    issue: str
    maximum: int | str | None = None

    def to_dict(self) -> dict:
        d = {"section": self.section, "issue": self.issue}
        if self.maximum is not None:
            d["maximum"] = self.maximum
        return d


@dataclass
class ValidationResult:
    valid: bool
    violations: list[Violation] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"valid": self.valid, "violations": [v.to_dict() for v in self.violations]}


def _check_bullet_length(section: str, label: str, bullet: str, violations: list[Violation]) -> None:
    words = _word_count(bullet)
    max_words = HARD_LIMITS["bullet_words"]["max"]
    if words > max_words:
        violations.append(Violation(section, f"{label} bullet is {words} words: \"{bullet[:60]}...\"", max_words))
    for phrase in BANNED_GENERIC_PHRASES:
        if phrase in bullet.lower():
            violations.append(Violation(section, f"{label} bullet uses generic filler phrase \"{phrase}\"", None))


def _check_duplicates(all_bullets: list[tuple[str, str]], violations: list[Violation]) -> None:
    """all_bullets: list of (section_label, bullet_text). Flags exact and
    near-duplicate (similarity > 0.9) bullets, including across sections —
    the same accomplishment restated in Experience and Projects is still a
    duplicate."""
    seen: list[tuple[str, str]] = []
    for label, text in all_bullets:
        norm = " ".join(text.lower().split())
        if not norm:
            continue
        for prev_label, prev_norm in seen:
            ratio = difflib.SequenceMatcher(None, norm, prev_norm).ratio()
            if ratio > 0.9:
                violations.append(Violation(
                    "Duplicate content",
                    f"\"{text[:50]}...\" ({label}) duplicates \"{text[:50]}...\" ({prev_label})",
                    None,
                ))
        seen.append((label, norm))


def _check_unsupported_claims(all_bullets: list[tuple[str, str]], evidence_text: str, violations: list[Violation]) -> None:
    evidence_lower = evidence_text.lower()
    for label, text in all_bullets:
        for match in _METRIC_RE.finditer(text):
            token = match.group(0).strip()
            if token.lower() not in evidence_lower:
                violations.append(Violation(
                    label,
                    f"Metric \"{token}\" in bullet not found in source evidence: \"{text[:60]}...\"",
                    None,
                ))


def validate_resume(
    resume_content: dict,
    candidate_type: CandidateType,
    template_id: str = "ats_clean",
    evidence_text: str | None = None,
) -> ValidationResult:
    """Run every deterministic check and return a structured result.

    Args:
        resume_content: the assembled resume dict (same shape PDF templates render).
        candidate_type: "fresher" | "experienced" — selects the page-count ceiling.
        template_id: which template to render for the real page-count check.
        evidence_text: optional raw source text (uploaded resume / career
            profile freeform fields). When supplied, bullets containing a
            metric (%, $, "500 users", etc.) not found verbatim in this text
            are flagged as a possibly-fabricated claim. Skipped entirely when
            omitted — we don't guess at fabrication without a reference.
    """
    violations: list[Violation] = []
    all_bullets: list[tuple[str, str]] = []

    # ── Page count (real render, not a heuristic) ────────────────────────────
    page_max = PAGE_LIMITS[candidate_type]["max"]
    try:
        pages = count_pdf_pages(resume_content, template_id)
        if pages > page_max:
            violations.append(Violation("Page count", f"{pages} pages", page_max))
    except Exception as exc:  # pragma: no cover - defensive; a render failure is itself a violation
        violations.append(Violation("Page count", f"could not render to check page count: {exc}", None))

    # ── Summary / Objective (mutually exclusive) ─────────────────────────────
    summary = (resume_content.get("summary") or "").strip()
    objective = (resume_content.get("objective") or "").strip()
    if summary and objective:
        violations.append(Violation("Summary/Objective", "both summary and objective are present — pick one", None))
    if summary:
        words = _word_count(summary)
        limits = HARD_LIMITS["summary"]
        if words > limits["max_words"]:
            violations.append(Violation("Summary", f"{words} words", limits["max_words"]))
        elif words < limits["min_words"]:
            violations.append(Violation("Summary", f"{words} words (below minimum)", limits["min_words"]))
    if objective:
        words = _word_count(objective)
        limits = HARD_LIMITS["objective"]
        if words > limits["max_words"]:
            violations.append(Violation("Objective", f"{words} words", limits["max_words"]))
        elif words < limits["min_words"]:
            violations.append(Violation("Objective", f"{words} words (below minimum)", limits["min_words"]))

    # ── Experience ────────────────────────────────────────────────────────────
    experience = resume_content.get("experience") or []
    exp_limits = HARD_LIMITS["experience_bullets_per_role"]
    # A candidate can hold multiple roles at the same company (promotion,
    # internal transfer) — "Experience (Acme Corp)" alone can't tell those
    # apart, so resume_generator.py's compression pass (_find_container,
    # _drop_empty) would either edit the wrong role's bullets or delete
    # every role at that company when only one was meant to be touched.
    # Disambiguate with a "#N" suffix only when a company actually repeats,
    # so the single-role-per-company case (the overwhelming majority) keeps
    # the exact same label as before.
    company_counts = Counter(job.get("company", "unknown") for job in experience)
    company_occurrence: dict[str, int] = {}
    for job in experience:
        bullets = job.get("bullets") or []
        company = job.get("company", "unknown")
        if company_counts[company] > 1:
            company_occurrence[company] = company_occurrence.get(company, 0) + 1
            role_label = f"Experience ({company} #{company_occurrence[company]})"
        else:
            role_label = f"Experience ({company})"
        if len(bullets) == 0:
            violations.append(Violation(role_label, "empty section — role has no bullets", None))
        elif len(bullets) > exp_limits["max"]:
            violations.append(Violation(role_label, f"{len(bullets)} bullets", exp_limits["max"]))
        for b in bullets:
            _check_bullet_length(role_label, "Experience", b, violations)
            all_bullets.append((role_label, b))

    # ── Projects ──────────────────────────────────────────────────────────────
    projects = resume_content.get("projects") or []
    proj_limits = HARD_LIMITS["projects"]
    bullet_limits = HARD_LIMITS["project_bullets"]
    if len(projects) > proj_limits["max"]:
        violations.append(Violation("Projects", f"{len(projects)} projects", proj_limits["max"]))
    for p in projects:
        bullets = p.get("bullets") or []
        proj_label = f"Project ({p.get('name', 'unknown')})"
        if len(bullets) == 0:
            violations.append(Violation(proj_label, "empty section — project has no bullets", None))
        elif len(bullets) > bullet_limits["max"]:
            violations.append(Violation(proj_label, f"{len(bullets)} bullets", bullet_limits["max"]))
        for b in bullets:
            _check_bullet_length(proj_label, "Project", b, violations)
            all_bullets.append((proj_label, b))

    # ── Education ─────────────────────────────────────────────────────────────
    education = resume_content.get("education") or []
    edu_limits = HARD_LIMITS["education_entries"]
    if len(education) > edu_limits["max"]:
        violations.append(Violation("Education", f"{len(education)} entries", edu_limits["max"]))
    elif len(education) == 0:
        violations.append(Violation("Education", "empty section — no education entries", None))

    # ── Skills ────────────────────────────────────────────────────────────────
    skills = resume_content.get("skills")
    cat_limits = HARD_LIMITS["skill_categories"]
    per_cat_limits = HARD_LIMITS["skills_per_category"]
    if isinstance(skills, dict):
        # Categorized shape: {"Languages": ["Python", ...], ...}
        if len(skills) > cat_limits["max"]:
            violations.append(Violation("Skills", f"{len(skills)} categories", cat_limits["max"]))
        for category, items in skills.items():
            if len(items) > per_cat_limits["max"]:
                violations.append(Violation(f"Skills ({category})", f"{len(items)} skills", per_cat_limits["max"]))
    elif isinstance(skills, list) and len(skills) > cat_limits["max"] * per_cat_limits["max"]:
        # Flat list with no categories at all — the spec explicitly warns
        # against this ("do not create keyword dumps"), so a flat list past
        # the theoretical categorized ceiling is itself the violation.
        violations.append(Violation(
            "Skills",
            f"{len(skills)} uncategorized skills — looks like a keyword dump",
            cat_limits["max"] * per_cat_limits["max"],
        ))

    # ── Certifications / Achievements / Awards / Leadership / Volunteer ─────
    for key, label, limit_key in [
        ("certifications", "Certifications", "certifications"),
        ("achievements", "Achievements", "achievements"),
        ("awards", "Awards", "awards"),
        ("leadership", "Leadership", "leadership"),
        ("volunteer", "Volunteer", "volunteer"),
    ]:
        items = resume_content.get(key) or []
        limits = HARD_LIMITS[limit_key]
        if len(items) > limits["max"]:
            violations.append(Violation(label, f"{len(items)} items", limits["max"]))

    # ── Cross-section duplicate detection ─────────────────────────────────────
    _check_duplicates(all_bullets, violations)

    # ── Unsupported-claim heuristic (only when we have a reference to check against) ──
    if evidence_text:
        _check_unsupported_claims(all_bullets, evidence_text, violations)

    return ValidationResult(valid=len(violations) == 0, violations=violations)

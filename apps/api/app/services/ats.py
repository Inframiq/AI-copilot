import re
from dataclasses import dataclass


@dataclass
class DeltaResult:
    matched: list[str]
    missing: list[str]
    ats_score: int


def build_resume_text(resume_content: dict) -> tuple[str, str]:
    """Return (full_text, skills_text) from a resume_content dict.

    full_text   — every piece of readable content joined for broad matching
    skills_text — only the skills[] array, for high-confidence exact matching
    """
    parts: list[str] = []

    if headline := resume_content.get("headline"):
        parts.append(str(headline))
    if summary := resume_content.get("summary"):
        parts.append(str(summary))

    for exp in resume_content.get("experience") or []:
        parts.append(str(exp.get("title") or ""))
        parts.append(str(exp.get("company") or ""))
        for bullet in exp.get("bullets") or []:
            parts.append(str(bullet))

    for edu in resume_content.get("education") or []:
        parts.append(str(edu.get("degree") or ""))
        parts.append(str(edu.get("institution") or ""))

    skills: list[str] = [str(s) for s in (resume_content.get("skills") or []) if s]
    parts.extend(skills)

    for cert in resume_content.get("certifications") or []:
        parts.append(str(cert))
    for award in resume_content.get("awards") or []:
        parts.append(str(award))

    full_text = " | ".join(p for p in parts if p.strip())
    skills_text = " | ".join(skills)
    return full_text, skills_text


def _exact_pattern(term: str) -> re.Pattern:
    """Compile a case-insensitive no-adjacent-alphanum pattern for *term*."""
    return re.compile(
        r"(?<![A-Za-z0-9])" + re.escape(term.strip()) + r"(?![A-Za-z0-9])",
        re.IGNORECASE,
    )


def _skill_matches(skill: str, full_text: str, skills_text: str) -> bool:
    """Return True if *skill* is considered present in the resume.

    Matching is done in three passes, in decreasing confidence order:

    1. Exact phrase in the dedicated skills list  (e.g. "Machine Learning"
       in the skills array → instant hit, highest confidence).

    2. Exact phrase anywhere in the full resume text.

    3. Majority-token match for long phrases (≥ 3 meaningful tokens):
       if ≥ ⌈2/3⌉ of the tokens appear individually anywhere in the resume,
       the phrase is considered matched.  This handles cases like
       "Large Language Models (LLMs)" where the resume says "LLMs" or where
       the phrase is split across multiple bullets.
    """
    skill = skill.strip()
    if not skill:
        return False

    pat = _exact_pattern(skill)

    # Pass 1 — skills list exact match
    if pat.search(skills_text):
        return True

    # Pass 2 — full-text exact match
    if pat.search(full_text):
        return True

    # Pass 3 — majority-token match for long multi-word skills
    # Split on spaces, hyphens, slashes; discard tokens ≤ 2 chars or
    # parenthesised fragments like "(LLMs)" since those are usually acronyms
    # that will fail individually but the core phrase already tried above.
    raw_tokens = re.split(r"[\s\-/]+", skill)
    tokens = [t for t in raw_tokens if len(t) > 2 and not (t.startswith("(") and t.endswith(")"))]

    if len(tokens) >= 3:
        threshold = -(-len(tokens) * 2 // 3)  # ceiling division: ⌈2/3 * n⌉
        matched_tokens = sum(
            1 for t in tokens
            if re.search(
                r"(?<![A-Za-z0-9])" + re.escape(t) + r"(?![A-Za-z0-9])",
                full_text,
                re.IGNORECASE,
            )
        )
        if matched_tokens >= threshold:
            return True

    return False


def compute_delta(jd_skills: list[str], resume: "str | dict") -> DeltaResult:
    """Compute which JD skills are present or missing in the resume.

    Args:
        jd_skills: Skills/keywords extracted from the job description.
        resume:    Either a resume_content dict (preferred — enables smarter
                   matching) or a pre-built plain-text string (legacy path,
                   still accepted for backwards compatibility with tests).

    Returns:
        DeltaResult with matched, missing, and an integer ats_score 0-100.

    Score formula:
        ats_score = round(matched / total × 100)

    All three matching passes (exact-skills, exact-fulltext, majority-token)
    use case-insensitive, no-adjacent-alphanum patterns to avoid both
    false positives (e.g. "Java" ⊄ "JavaScript") and false negatives
    on symbols (e.g. "C++" and "C#" both work correctly).
    """
    if isinstance(resume, dict):
        full_text, skills_text = build_resume_text(resume)
    else:
        # Legacy string path — treat the string as full_text, no skills list
        full_text = resume
        skills_text = ""

    matched: list[str] = []
    missing: list[str] = []

    for skill in jd_skills:
        if _skill_matches(skill, full_text, skills_text):
            matched.append(skill)
        else:
            missing.append(skill)

    total = len(jd_skills)
    score = round((len(matched) / total) * 100) if total > 0 else 0
    return DeltaResult(matched=matched, missing=missing, ats_score=score)

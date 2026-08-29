import re
from copy import deepcopy
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel


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


_VERDICT_VALUE = {"matched": 1.0, "partial": 0.5, "missing": 0.0}
_RESPONSIBILITY_WEIGHT = 0.5
_NICE_TO_HAVE_WEIGHT = 0.5
# Title alignment is, per every ATS-scoring writeup, the single highest-weight
# individual signal — a current/recent title matching the posting's title is
# the biggest driver of getting surfaced.  Weighted well above one skill
# phrase but not so high it dominates a 10-20 phrase JD.
_TITLE_WEIGHT = 2.0

# Words that denote seniority level rather than the role itself.  Stripped out
# to compare the *role*; the level is compared separately.
_SENIORITY_WORDS = {
    "intern", "trainee", "junior", "jr", "entry", "entrylevel", "grad",
    "associate", "mid", "midlevel", "midsenior", "senior", "snr", "sr",
    "staff", "principal", "distinguished", "fellow", "lead",
}
# Level ordinals we drop from the role comparison but don't map to a level word.
_LEVEL_ORDINALS = {"ii", "iii", "iv", "2", "3", "4"}
_SENIORITY_ALIASES = {"jr": "junior", "sr": "senior", "snr": "senior"}


def blend_scores(
    skill_verdicts: dict[str, str],
    responsibility_verdicts: dict[str, str] | None = None,
    nice_to_have_verdicts: dict[str, str] | None = None,
    title_verdict: str | None = None,
) -> DeltaResult:
    """Turn per-phrase verdicts into a blended ATS score.

    This is the hybrid scorer that runs *after* the lexical pre-filter
    (``compute_delta``) and an optional LLM semantic-verification pass:

        skill_verdicts          — every JD skill/keyword phrase mapped to
                                  "matched" | "partial" | "missing".  Phrases
                                  the lexical pass already matched exactly are
                                  passed in pre-marked "matched"; the rest carry
                                  whatever the semantic verifier decided.
        responsibility_verdicts — the JD's core_responsibilities, same verdict
                                  vocabulary.  Weighted at half a skill phrase
                                  and never surfaced as skill chips.
        nice_to_have_verdicts   — skills the JD frames as preferred / "a plus"
                                  rather than required.  Half weight; still
                                  surfaced in the matched / missing chips.
        title_verdict           — one verdict for whether the candidate's
                                  recent title(s) align with the role the JD is
                                  hiring for.  Weighted at ``_TITLE_WEIGHT``.
                                  ``None`` → the JD had no extractable title, so
                                  the signal is left out of the score entirely.

    Score = round(100 × Σ(weightᵢ · valueᵢ) / Σ(weightᵢ)), where value is
    1.0 / 0.5 / 0.0 for matched / partial / missing and weight is 1.0 for a
    required skill, 0.5 for a responsibility or nice-to-have, and
    ``_TITLE_WEIGHT`` for the title.  An unknown verdict counts as "missing".

    matched — required + nice-to-have phrases with verdict "matched".
    missing — required + nice-to-have phrases with verdict "partial" or
              "missing" (a partial match is still a gap worth strengthening).
    """
    matched: list[str] = []
    missing: list[str] = []
    weighted_hit = 0.0
    weighted_total = 0.0

    def _add_chip_group(verdicts: dict[str, str], weight: float) -> None:
        nonlocal weighted_hit, weighted_total
        for phrase, verdict in verdicts.items():
            weighted_hit += weight * _VERDICT_VALUE.get(verdict, 0.0)
            weighted_total += weight
            (matched if verdict == "matched" else missing).append(phrase)

    _add_chip_group(skill_verdicts, 1.0)
    _add_chip_group(nice_to_have_verdicts or {}, _NICE_TO_HAVE_WEIGHT)

    for verdict in (responsibility_verdicts or {}).values():
        weighted_hit += _RESPONSIBILITY_WEIGHT * _VERDICT_VALUE.get(verdict, 0.0)
        weighted_total += _RESPONSIBILITY_WEIGHT

    if title_verdict is not None:
        weighted_hit += _TITLE_WEIGHT * _VERDICT_VALUE.get(title_verdict, 0.0)
        weighted_total += _TITLE_WEIGHT

    score = round((weighted_hit / weighted_total) * 100) if weighted_total > 0 else 0
    return DeltaResult(matched=matched, missing=missing, ats_score=score)


@dataclass
class JdScore:
    matched: list[str]
    missing: list[str]
    ats_score: int
    title_match: str  # "" | "matched" | "partial" | "missing"


def _dedupe_ci(*groups: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for g in groups:
        for p in g or []:
            k = p.strip().lower()
            if k and k not in seen:
                seen.add(k)
                out.append(p)
    return out


def score_content(content: dict, jd_analysis, semantic_verdicts: dict[str, str]) -> JdScore:
    """Blend a résumé's lexical + (pre-computed) semantic match against a
    parsed JD into a 0-100 score. Pure — never calls a model. Missing
    phrases fall back to whatever `semantic_verdicts` says, else "missing"."""
    required = _dedupe_ci(
        jd_analysis.exact_technical_tools,
        jd_analysis.methodologies_and_frameworks,
        jd_analysis.ats_filter_phrases,
    )
    nice = [p for p in _dedupe_ci(jd_analysis.nice_to_have_skills)
            if p.strip().lower() not in {r.strip().lower() for r in required}]
    responsibilities = [r.strip() for r in (jd_analysis.core_responsibilities or []) if r and r.strip()]

    d_req = compute_delta(required, content)
    d_nice = compute_delta(nice, content)

    def verdicts_for(phrases: list[str], lexically_matched: list[str]) -> dict[str, str]:
        matched_set = {m.strip().lower() for m in lexically_matched}
        out: dict[str, str] = {}
        for p in phrases:
            k = p.strip().lower()
            out[p] = "matched" if k in matched_set else semantic_verdicts.get(k, "missing")
        return out

    skill_verdicts = verdicts_for(required, d_req.matched)
    nice_verdicts = verdicts_for(nice, d_nice.matched)
    resp_verdicts = {r: semantic_verdicts.get(r.strip().lower(), "missing") for r in responsibilities}

    jd_titles = [t.strip() for t in (jd_analysis.target_job_titles or []) if t and t.strip()]
    title_verdict = None
    if jd_titles:
        resume_titles = [str(content.get("headline") or "")]
        for exp in (content.get("experience") or [])[:2]:
            resume_titles.append(str(exp.get("title") or ""))
        title_verdict = title_match_verdict(jd_titles, [t for t in resume_titles if t])

    blended = blend_scores(skill_verdicts, resp_verdicts, nice_verdicts, title_verdict)
    return JdScore(
        matched=blended.matched,
        missing=blended.missing,
        ats_score=blended.ats_score,
        title_match=title_verdict or "",
    )


_MAX_SKILLS = 20          # mirrors MAX_MERGED_SKILLS in apps/web/stores/tailoring-store.ts
_MAX_BULLETS_PER_ROLE = 7  # HARD_LIMITS["experience_bullets_per_role"]["max"]


class AtsFix(BaseModel):
    id: str
    type: Literal["skill", "bullet", "headline"]
    gap: str
    importance: Literal["high", "medium", "low"]
    grounded: bool
    text: str
    experience_index: int | None = None
    score_delta: int = 0
    default_accept: bool = False


def fix_slug(prefix: str, gap: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", gap.lower()).strip("-")[:60]
    return f"{prefix}:{s}"


def apply_fix(content: dict, fix: AtsFix) -> dict:
    """Return a deep copy of `content` with the single fix folded in. No cap
    checks here — see apply_fixes for those."""
    out = deepcopy(content)
    if fix.type == "skill":
        out.setdefault("skills", [])
        if fix.text not in out["skills"]:
            out["skills"].append(fix.text)
    elif fix.type == "headline":
        out["headline"] = fix.text
    elif fix.type == "bullet" and fix.experience_index is not None:
        exps = out.get("experience") or []
        if 0 <= fix.experience_index < len(exps):
            exps[fix.experience_index].setdefault("bullets", []).append(fix.text)
    return out


def apply_fixes(content: dict, fixes: list[AtsFix]) -> dict:
    """Fold a list of fixes in order. A skill fix that would push the list
    past _MAX_SKILLS, or a bullet fix past _MAX_BULLETS_PER_ROLE for its
    role, is skipped whole (never truncated mid-text)."""
    out = deepcopy(content)
    for fix in fixes:
        if fix.type == "skill":
            skills = out.setdefault("skills", [])
            if fix.text not in skills and len(skills) < _MAX_SKILLS:
                skills.append(fix.text)
        elif fix.type == "headline":
            out["headline"] = fix.text
        elif fix.type == "bullet" and fix.experience_index is not None:
            exps = out.get("experience") or []
            if 0 <= fix.experience_index < len(exps):
                bullets = exps[fix.experience_index].setdefault("bullets", [])
                if len(bullets) < _MAX_BULLETS_PER_ROLE:
                    bullets.append(fix.text)
    return out


def _title_parts(title: str) -> "tuple[str | None, frozenset[str]]":
    """Split a job title into (seniority_level, role_token_set).

    "Sr. Data Analyst II" → ("senior", {"data", "analyst"})
    "Product Manager"     → (None, {"product", "manager"})
    """
    tokens = [t for t in re.split(r"[^a-z0-9]+", title.lower()) if t]
    level: str | None = None
    role: list[str] = []
    for tok in tokens:
        if tok in _SENIORITY_WORDS:
            if level is None:
                level = _SENIORITY_ALIASES.get(tok, tok)
        elif tok not in _LEVEL_ORDINALS:
            role.append(tok)
    return level, frozenset(role)


def title_match_verdict(jd_titles: list[str], resume_titles: list[str]) -> str:
    """Best alignment between the role a JD is hiring for and the candidate's
    recent title(s): "matched" | "partial" | "missing".

    - "matched": every role word of a JD title appears in a resume title AND
      the seniority level agrees (or the JD states no level).
    - "partial": same role but a different seniority level, or ≥ ⌈2/3⌉ of the
      JD title's role words overlap.
    - "missing": neither, or an input is empty.
    """
    best = 0
    rank = {"missing": 0, "partial": 1, "matched": 2}

    parsed_resume = [_title_parts(t) for t in resume_titles if t and t.strip()]
    for jd_title in jd_titles:
        if not jd_title or not jd_title.strip():
            continue
        jd_level, jd_role = _title_parts(jd_title)
        if not jd_role:
            continue
        for rt_level, rt_role in parsed_resume:
            if not rt_role:
                continue
            level_ok = jd_level is None or jd_level == rt_level
            if jd_role <= rt_role:
                verdict = "matched" if level_ok else "partial"
            elif len(jd_role & rt_role) / len(jd_role) >= 2 / 3:
                verdict = "partial"
            else:
                verdict = "missing"
            best = max(best, rank[verdict])

    return {0: "missing", 1: "partial", 2: "matched"}[best]


def default_importance(
    term: str,
    *,
    titles: list[str],
    hard_tools: list[str],
    mediums: list[str],
    nice: list[str],
) -> str:
    """Bucket-based importance for a JD term when Agent 1 didn't rate it
    (old cache, or an item it missed). See the spec's fallback table."""
    t = term.strip().lower()
    if t == "job title" or any(t == x.strip().lower() for x in titles):
        return "high"
    if any(t == x.strip().lower() for x in hard_tools):
        return "high"
    if any(t == x.strip().lower() for x in nice):
        return "low"
    if any(t == x.strip().lower() for x in mediums):
        return "medium"
    return "medium"


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

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

    # Projects carry a fresher's entire technical evidence and, per
    # resume_spec.SECTION_ORDER, outrank Experience for that candidate type —
    # leaving them out scored those résumés as if they were empty.
    for proj in resume_content.get("projects") or []:
        parts.append(str(proj.get("name") or ""))
        parts.append(str(proj.get("tech_stack") or ""))
        for bullet in proj.get("bullets") or []:
            parts.append(str(bullet))

    for edu in resume_content.get("education") or []:
        parts.append(str(edu.get("degree") or ""))
        parts.append(str(edu.get("institution") or ""))

    skills: list[str] = [str(s) for s in (resume_content.get("skills") or []) if s]
    parts.extend(skills)

    # Every remaining free-text section a résumé can carry. These hold real
    # JD-relevant evidence ("Led the campus coding club", "Taught Python at a
    # local school") and were previously invisible to the scorer.
    for key in ("certifications", "awards", "achievements", "leadership", "volunteer"):
        for item in resume_content.get(key) or []:
            parts.append(str(item))

    for lang in resume_content.get("languages") or []:
        parts.append(str(lang.get("name") or "") if isinstance(lang, dict) else str(lang))

    full_text = " | ".join(p for p in parts if p.strip())
    skills_text = " | ".join(skills)
    return full_text, skills_text


def _exact_pattern(term: str) -> re.Pattern:
    """Compile a case-insensitive no-adjacent-alphanum pattern for *term*."""
    return re.compile(
        r"(?<![A-Za-z0-9])" + re.escape(term.strip()) + r"(?![A-Za-z0-9])",
        re.IGNORECASE,
    )


# Words that carry no evidence of a skill on their own. A phrase's meaning
# lives in its distinctive tokens ("revenue", "product"), never in its
# connectives ("through", "with") — counting those as matched tokens is how
# "revenue growth through product-led growth" scored against a résumé whose
# only overlap was the words "revenue", "growth" and "through".
# Tokens of ≤ 2 chars ("of", "to", "in") are dropped by length and need no
# entry here.
_PHRASE_STOPWORDS = frozenset("""
    the and for with from through into using via across over under per about
    within without upon among between during against than then that this these
    those their its our your you are was were been being has have had will
    would can could may might must not but else while which who whom whose
    all any each both few more most other same such some only own too very
    ability able strong excellent proven solid deep broad hands experience
    experienced knowledge familiarity proficiency proficient understanding
    work working works year years plus bonus etc related relevant various
    including include includes new general overall key core
""".split())


def _distinctive_tokens(phrase: str) -> list[str]:
    """The tokens of *phrase* that actually carry meaning, de-duplicated and
    in first-appearance order.

    Drops short tokens, filler words, and parenthesised fragments like
    "(LLMs)" (an acronym the exact-phrase passes already tried). De-duplicates
    so a phrase that repeats a word ("growth ... growth") cannot satisfy its
    own threshold twice off a single occurrence in the résumé.
    """
    out: list[str] = []
    seen: set[str] = set()
    for raw in re.split(r"[\s\-/]+", phrase):
        # A parenthesised fragment is a gloss on the phrase, not another word
        # the résumé has to repeat: "Search Engine Optimization (SEO)" must
        # still match a résumé that only spells the term out. Passes 1 and 2
        # already tried the acronym as part of the full phrase.
        if raw.startswith("(") and raw.endswith(")"):
            continue
        t = raw.strip("()[],.;:")
        low = t.lower()
        if len(t) <= 2 or low in _PHRASE_STOPWORDS or low in seen:
            continue
        seen.add(low)
        out.append(t)
    return out


def _skill_matches(skill: str, full_text: str, skills_text: str) -> bool:
    """Return True if *skill* is considered present in the resume.

    Matching is done in three passes, in decreasing confidence order:

    1. Exact phrase in the dedicated skills list  (e.g. "Machine Learning"
       in the skills array → instant hit, highest confidence).

    2. Exact phrase anywhere in the full resume text.

    3. All-token match within a single segment, for long phrases
       (≥ 3 distinctive tokens): every distinctive token of the phrase must
       appear inside ONE segment of the resume (a bullet, a title, the
       summary — whatever build_resume_text joined with " | ").  Filler
       words are not distinctive and are dropped rather than required, and a
       token repeated in the phrase counts once.

       This pass is deliberately precision-first.  A phrase it MISSES is
       handed to the LLM semantic verifier (tailoring._verify_semantic_presence),
       which recovers paraphrases, synonyms and abbreviations — so recall
       costs nothing here.  A phrase it wrongly MATCHES is reviewed by
       nothing: it is scored as evidence the candidate does not have, and it
       inflates the "before" score, shrinking the measured lift from
       tailoring.  When in doubt, this pass says no.
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

    # Pass 3 — all distinctive tokens inside one segment
    tokens = _distinctive_tokens(skill)
    if len(tokens) >= 3:
        for segment in full_text.split(" | "):
            if all(
                re.search(
                    r"(?<![A-Za-z0-9])" + re.escape(t) + r"(?![A-Za-z0-9])",
                    segment,
                    re.IGNORECASE,
                )
                for t in tokens
            ):
                return True

    return False


_VERDICT_VALUE = {"matched": 1.0, "partial": 0.5, "missing": 0.0}

# How much a phrase's JD importance scales its weight in the score. Centred on
# medium = 1.0 so a JD with no importance data — an Agent 1 parse cached before
# importance existed, or a term the model didn't rate — scores exactly as it
# did before this was weighted at all. High-importance phrases are worth 3x a
# low-importance one, so missing a stated hard requirement finally costs more
# than missing something the JD mentions in passing.
_IMPORTANCE_WEIGHT = {"high": 1.5, "medium": 1.0, "low": 0.5}
_DEFAULT_IMPORTANCE_WEIGHT = 1.0


def _importance_weight(term: str, importance: "dict[str, str] | None") -> float:
    """Multiplier for *term*'s rated importance. Unrated or unrecognised
    levels fall back to medium — never to zero, which would silently drop the
    phrase out of the score entirely."""
    if not importance:
        return _DEFAULT_IMPORTANCE_WEIGHT
    level = importance.get(term.strip().lower())
    return _IMPORTANCE_WEIGHT.get(level, _DEFAULT_IMPORTANCE_WEIGHT)
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
    importance: dict[str, str] | None = None,
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

        importance             — {phrase_lowercased: "high"|"medium"|"low"}
                                  from Agent 1, plus a "job title" key.
                                  Scales each phrase's weight (see
                                  ``_IMPORTANCE_WEIGHT``).  Omitted or
                                  unrated phrases are treated as medium, so
                                  leaving this out reproduces the old
                                  flat-weight score exactly.

    Score = round(100 × Σ(weightᵢ · valueᵢ) / Σ(weightᵢ)), where value is
    1.0 / 0.5 / 0.0 for matched / partial / missing and weight is
    ``base × importance``.  The base is 1.0 for a required skill, 0.5 for a
    responsibility or nice-to-have, and ``_TITLE_WEIGHT`` for the title; the
    importance multiplier is 1.5 / 1.0 / 0.5 for high / medium / low.  An
    unknown verdict counts as "missing".

    matched — required + nice-to-have phrases with verdict "matched".
    missing — required + nice-to-have phrases with verdict "partial" or
              "missing" (a partial match is still a gap worth strengthening).
    """
    matched: list[str] = []
    missing: list[str] = []
    weighted_hit = 0.0
    weighted_total = 0.0

    def _add_chip_group(verdicts: dict[str, str], base_weight: float) -> None:
        nonlocal weighted_hit, weighted_total
        for phrase, verdict in verdicts.items():
            weight = base_weight * _importance_weight(phrase, importance)
            weighted_hit += weight * _VERDICT_VALUE.get(verdict, 0.0)
            weighted_total += weight
            (matched if verdict == "matched" else missing).append(phrase)

    _add_chip_group(skill_verdicts, 1.0)
    _add_chip_group(nice_to_have_verdicts or {}, _NICE_TO_HAVE_WEIGHT)

    for phrase, verdict in (responsibility_verdicts or {}).items():
        weight = _RESPONSIBILITY_WEIGHT * _importance_weight(phrase, importance)
        weighted_hit += weight * _VERDICT_VALUE.get(verdict, 0.0)
        weighted_total += weight

    if title_verdict is not None:
        # "job title" is the key Agent 1 is told to rate for exactly this —
        # how much the posting hinges on a title match (_AGENT1_SYSTEM rule 9).
        weight = _TITLE_WEIGHT * _importance_weight("job title", importance)
        weighted_hit += weight * _VERDICT_VALUE.get(title_verdict, 0.0)
        weighted_total += weight

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

    # getattr, not attribute access: a JDAnalysis rebuilt from a cache written
    # before `importance` existed (and the test doubles) may not carry it.
    blended = blend_scores(
        skill_verdicts, resp_verdicts, nice_verdicts, title_verdict,
        importance=getattr(jd_analysis, "importance", None) or {},
    )
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


def _bullet_tokens(text: str) -> set[str]:
    return {t for t in re.sub(r"[^a-z0-9]+", " ", text.lower()).split() if len(t) > 2}


def bullet_already_present(existing: list[str], text: str) -> bool:
    """True if `text` restates a bullet already in `existing` — an exact match
    after normalisation, or ≥ 80% word overlap (so a light reword of a bullet
    the résumé already has isn't added a second time). Kept identical to the
    frontend's bulletAlreadyPresent in tailoring-store.ts."""
    norm = lambda s: re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()
    target = norm(text)
    if not target:
        return False
    new_tokens = _bullet_tokens(text)
    for b in existing:
        if norm(b) == target:
            return True
        if not new_tokens:
            continue
        b_tokens = _bullet_tokens(b)
        if not b_tokens:
            continue
        overlap = len(new_tokens & b_tokens) / len(new_tokens | b_tokens)
        if overlap >= 0.8:
            return True
    return False


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
            bullets = exps[fix.experience_index].setdefault("bullets", [])
            if not bullet_already_present(bullets, fix.text):
                bullets.append(fix.text)
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
                if (
                    len(bullets) < _MAX_BULLETS_PER_ROLE
                    and not bullet_already_present(bullets, fix.text)
                ):
                    bullets.append(fix.text)
    return out


def verdicts_with_fixes(
    semantic_verdicts: dict[str, str], fixes: "list[AtsFix]"
) -> dict[str, str]:
    """`semantic_verdicts` updated to reflect the gaps *fixes* close.

    A fix exists to close one named gap — the gap-filler is prompted to write a
    bullet FOR that gap, and accepting a speculative one is the user asserting
    it is true of them. Scoring the patched résumé against the pre-fix verdicts
    meant only a fix whose text lexically echoed the JD phrase could ever move
    the number: a naturally-worded bullet closing the same gap scored +0, and
    the UI hides a zero delta entirely.

    So the "+X%" was telling users that parroting the JD is the only thing that
    helps — the exact behaviour Agent 2 rule 4 and Agent 3 rule 3 spend
    paragraphs forbidding. Crediting the gap makes the estimate agree with the
    prompts instead of undermining them.

    Returns a new dict; the input is never mutated (callers reuse it across
    every fix in a list).
    """
    out = dict(semantic_verdicts)
    for fix in fixes:
        key = fix.gap.strip().lower()
        if key:
            out[key] = "matched"
    return out


def estimate_fix_delta(
    content: dict,
    jd_analysis,
    semantic_verdicts: dict[str, str],
    base_score: int,
    fix: "AtsFix",
) -> int:
    """Points this one fix would add on its own, vs base_score. Pure.

    base_score must be the score WITHOUT this fix (computed from the unmodified
    verdicts), so the delta measures only what the fix adds.
    """
    after = score_content(
        apply_fix(content, fix),
        jd_analysis,
        verdicts_with_fixes(semantic_verdicts, [fix]),
    ).ats_score
    return max(0, after - base_score)


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

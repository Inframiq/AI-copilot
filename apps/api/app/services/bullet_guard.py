"""Deterministic fact-lock on a single rewritten bullet.

Agent 3's system prompt makes four promises about every bullet it rewrites
(see _build_agent3_system in tailoring.py): every value in preserved_metrics
survives verbatim (rule 2), no metric the original didn't have is invented
(rule 2), the bullet stays inside the hard word cap (rule 7), and banned
filler stays out (rule 8). Until this module existed nothing checked any of
them — the tailoring pipeline, unlike the build-from-scratch generator, ran
no validator at all, so "fact lock" was a prompt promise with no enforcement.

Pure and cheap on purpose: no AI call, and deliberately NOT built on
resume_validator.validate_resume, which is whole-résumé, renders a PDF to
count pages, and would drag WeasyPrint into the tailoring hot path.

The remedy for a violation is always to revert to the original bullet, never
to patch the rewrite: the original is the candidate's own truthful text, so
reverting can only ever lose polish, never introduce a false claim.
"""
import re

from app.services.resume_spec import BANNED_GENERIC_PHRASES, HARD_LIMITS

_WORD_RE = re.compile(r"[A-Za-z0-9']+")

# Any number-bearing token: "40%", "$1.2M", "2M", "3", "p99", "24/7".
# Compared as a set between original and rewrite — a token on the rewrite side
# that the original never had is a fabricated specific.
_NUMBER_RE = re.compile(r"\d[\d,.]*")


def _numbers(text: str) -> set[str]:
    """Normalised numeric tokens in *text*. Trailing separators are stripped so
    "40%." and "40%" compare equal, and thousands separators are removed so
    "2,000" and "2000" do too."""
    return {m.group(0).rstrip(".,").replace(",", "") for m in _NUMBER_RE.finditer(text or "")}


def _word_count(text: str) -> int:
    return len(_WORD_RE.findall(text or ""))


# Practices, not products: each is the standard name for work a bullet can
# describe in plain words ("automated deployment pipelines" is CI/CD), so the
# prompt's umbrella-term rule governs them, not the invented-tool check. A
# product (SQL, React, Kubernetes) has no such plain-words form to point to.
_PRACTICE_TERMS = {
    "ci/cd", "ci", "cd", "etl", "elt", "api", "apis", "rest", "restful",
    "agile", "scrum", "kanban", "tdd", "devops", "sdlc", "qa", "a/b testing",
    "microservices", "oop", "seo", "ux", "ui",
}

# A closing purpose or benefit clause: ", ensuring consistency", "to improve
# compliance", "that supported campaign goals". When the original states no
# such purpose, the clause is invented padding. Cutting it only removes words
# the original does not support, so it is safe to do rather than revert.
_TAIL_RE = re.compile(
    r"(?:,\s*|\s+)(?:(?:in order )?to (?:ensure|improve|enhance|support|drive|enable|"
    r"boost|increase|optimi[sz]e|streamline|facilitate)|ensuring|supporting|enabling|"
    r"driving|enhancing|improving|aligned with|aligning with|that supported|"
    r"that improved|that enhanced|for (?:improved|enhanced|better))\b[^.;]*\.?\s*$",
    re.IGNORECASE,
)


def strip_invented_tail(original: str, rewritten: str) -> str:
    """Drop a closing purpose clause the original never stated.

    Kept when the original has its own tail of that kind (or the clause's
    lead words), and when cutting would leave too little to be a bullet."""
    match = _TAIL_RE.search(rewritten or "")
    if not match:
        return rewritten
    lead = match.group(0).strip(" ,").split()[:2]
    if _TAIL_RE.search(original or "") or all(w.lower() in (original or "").lower() for w in lead):
        return rewritten
    head = rewritten[: match.start()].rstrip(" ,;")
    if _word_count(head) < 4:
        return rewritten
    return head + "."


def _mentions(text: str, term: str) -> bool:
    """Whole-term, case-insensitive: "Java" is not found in "JavaScript", and
    terms with punctuation ("C++", "Node.js") still match."""
    pattern = rf"(?<![A-Za-z0-9]){re.escape(term)}(?![A-Za-z0-9])"
    return re.search(pattern, text or "", re.IGNORECASE) is not None


def rewrite_violations(
    original: str,
    rewritten: str,
    preserved_metrics: list[str] | None = None,
    tool_terms: list[str] | None = None,
    evidence_text: str = "",
) -> list[str]:
    """Every rule *rewritten* breaks relative to *original*. Empty == clean.

    *tool_terms* are the JD's named tools; *evidence_text* is the candidate's
    whole résumé. A tool the rewrite adds that the résumé never mentions is a
    fabricated claim — the "used SQL" a marketer never did."""
    reasons: list[str] = []

    # 1. Fabricated specifics — a number the original never contained.
    invented = _numbers(rewritten) - _numbers(original)
    if invented:
        reasons.append(
            f"invented metric(s) not in the original bullet: {', '.join(sorted(invented))}"
        )

    # 2. Lost evidence — a metric Agent 2 explicitly flagged to carry over.
    #    Compared on digits so "40%" still counts as present in "40 percent".
    for metric in preserved_metrics or []:
        m = metric.strip()
        if not m:
            continue
        if m.lower() not in rewritten.lower() and not (_numbers(m) <= _numbers(rewritten)):
            reasons.append(f"dropped preserved metric: {m}")

    # 3. Length — the hard ceiling, not the preferred range.
    max_words = HARD_LIMITS["bullet_words"]["max"]
    words = _word_count(rewritten)
    if words > max_words:
        reasons.append(f"{words} words, over the {max_words}-word maximum")

    # 4. Banned filler the rewrite introduced. A phrase the original already
    #    used is the candidate's own wording — tolerated, same carve-out the
    #    Agent 3 prompt grants.
    low_rewritten, low_original = rewritten.lower(), original.lower()
    for phrase in BANNED_GENERIC_PHRASES:
        if phrase in low_rewritten and phrase not in low_original:
            reasons.append(f'uses banned filler phrase "{phrase}"')

    # 5. Invented tools — a JD tool the rewrite claims that appears nowhere in
    #    the candidate's résumé. Checked only when the caller has the résumé:
    #    a tool named elsewhere in it (skills, another role) is evidence, and
    #    stays the prompt's judgement call rather than this check's.
    if evidence_text:
        for term in tool_terms or []:
            t = (term or "").strip()
            if t and t.lower() not in _PRACTICE_TERMS and _mentions(rewritten, t) \
                    and not _mentions(original, t) and not _mentions(evidence_text, t):
                reasons.append(f"claims a tool the résumé never mentions: {t}")

    return reasons


def guard_rewrite(
    original: str,
    rewritten: str,
    preserved_metrics: list[str] | None = None,
    tool_terms: list[str] | None = None,
    evidence_text: str = "",
) -> tuple[str, list[str]]:
    """Return (text_to_use, reasons_it_was_rejected).

    Clean rewrite -> (rewritten, []). Anything else -> (original, reasons).
    """
    if rewritten.strip() == original.strip():
        return original, []
    rewritten = strip_invented_tail(original, rewritten)
    reasons = rewrite_violations(original, rewritten, preserved_metrics, tool_terms, evidence_text)
    return (original, reasons) if reasons else (rewritten, [])

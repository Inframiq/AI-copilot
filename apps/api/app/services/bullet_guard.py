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


def rewrite_violations(
    original: str, rewritten: str, preserved_metrics: list[str] | None = None
) -> list[str]:
    """Every rule *rewritten* breaks relative to *original*. Empty == clean."""
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

    return reasons


def guard_rewrite(
    original: str, rewritten: str, preserved_metrics: list[str] | None = None
) -> tuple[str, list[str]]:
    """Return (text_to_use, reasons_it_was_rejected).

    Clean rewrite -> (rewritten, []). Anything else -> (original, reasons).
    """
    if rewritten.strip() == original.strip():
        return original, []
    reasons = rewrite_violations(original, rewritten, preserved_metrics)
    return (original, reasons) if reasons else (rewritten, [])

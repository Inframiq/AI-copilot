"""Deterministic quality metrics for one tailoring run.

Every metric here measures a rule the Agent 2 / Agent 3 system prompts state
explicitly but that nothing in the pipeline checked. Without them a prompt edit
can degrade output in precisely the way the prompt warns against — keyword
stuffing, bullets going generic, one verb opening everything — and nobody
finds out, because the only visible number (the ATS score) actually *rewards*
the first two.

Pure and AI-free on purpose: the same résumé pair always yields the same
numbers, which is the whole point — two prompt revisions are only comparable
if the measuring stick doesn't move. See evals/README.md.
"""
import re

_WORD_RE = re.compile(r"[A-Za-z0-9'+#/.-]+")
_NUMBER_RE = re.compile(r"\d")
# All-caps runs (ETL, API, SQL) and CamelCase/proper nouns (Redis, Kafka,
# Checkout). Both name a concrete thing the candidate actually worked on.
_ACRONYM_RE = re.compile(r"^[A-Z0-9][A-Z0-9/.+#-]{1,}$")
_PROPER_RE = re.compile(r"^[A-Z][A-Za-z0-9.+#-]*$")


def _specific_tokens(bullet: str) -> set[str]:
    """The concrete things a bullet names — numbers, tools, systems, named
    projects. This is the operational reading of "specifics" in Agent 2 rule 5
    and Agent 3 rule 3.

    The first word is skipped: every bullet is required to open with a
    capitalised action verb (Agent 3 rule 4), so counting it would make this
    metric largely measure whether the verb changed.
    """
    words = _WORD_RE.findall(bullet or "")
    out: set[str] = set()
    for i, w in enumerate(words):
        # A rewrite legitimately folds a specific into a compound —
        # "6 engineers" -> "6-engineer squad", "3 weeks" -> "3-week wait",
        # "Redis cache" -> "Redis-backed caching". Comparing whole tokens
        # scored those as lost and reported a phantom specificity regression,
        # so compare the parts. Percentages and decimals ("40%", "99.9") are
        # not split — only hyphens and slashes are compound joiners here.
        for part in re.split(r"[-/]", w):
            part = part.strip(".,")
            if not part:
                continue
            if _NUMBER_RE.search(part):
                out.add(part.lower())
            elif i > 0 and (_ACRONYM_RE.match(part) or _PROPER_RE.match(part)):
                out.add(part.lower())
    return out


def specificity_retention(originals: list[str], rewrites: list[str]) -> float:
    """Fraction of each original bullet's specifics that survive its rewrite,
    averaged over bullets. 1.0 = nothing concrete was lost.

    Bullets whose original names nothing concrete are excluded rather than
    scored 0.0 — a rewrite cannot be blamed for specifics the original never
    had, and including them would just measure how vague the input résumé was.
    """
    scores: list[float] = []
    for original, rewrite in zip(originals, rewrites):
        wanted = _specific_tokens(original)
        if not wanted:
            continue
        kept = _specific_tokens(rewrite)
        scores.append(len(wanted & kept) / len(wanted))
    return sum(scores) / len(scores) if scores else 1.0


def keyword_concentration(bullets: list[str], keywords: list[str]) -> dict[str, int]:
    """{keyword: how many bullets contain it}. Agent 2 rule 4 caps this at 2-3
    per keyword; anything higher outpaces the JD's own frequency, which real
    ATS scoring penalises as gamed. Counted per BULLET, not per occurrence —
    the rule is about how widely a term was spread, not how often it repeats
    inside one line.
    """
    out: dict[str, int] = {}
    for kw in keywords:
        term = kw.strip()
        if not term:
            continue
        pattern = re.compile(
            r"(?<![A-Za-z0-9])" + re.escape(term) + r"(?![A-Za-z0-9])", re.IGNORECASE
        )
        out[kw] = sum(1 for b in bullets if pattern.search(b or ""))
    return out


def verb_diversity(bullets: list[str]) -> float:
    """Distinct opening verbs ÷ bullets. Agent 3 rule 4 asks for no repeated
    opener; 1.0 means none repeated, 1/n means every bullet opens the same way.
    """
    openers = [
        (_WORD_RE.findall(b or "") or [""])[0].lower()
        for b in bullets
        if (b or "").strip()
    ]
    return len(set(openers)) / len(openers) if openers else 1.0


def word_growth(originals: list[str], rewrites: list[str]) -> float:
    """Mean words-out ÷ words-in over the bullets that actually changed.

    Agent 3 rule 7: "Say less, more precisely; do not pad a short
    accomplishment with filler to sound more substantial." 1.0 means rewrites
    are the same length as the originals. Well above 1.0 means the writer is
    inflating — the first live baseline run measured 1.61x, with every rewrite
    ending in a comma + gerund clause restating its own first half, while
    specificity, verb diversity and the fact-lock all stayed perfectly clean.
    No other metric here sees that failure mode.

    Mean of per-bullet ratios rather than a ratio of totals, because padding a
    short bullet is the pathology (the baseline's worst case, 2.06x, was its
    shortest input) and a totals ratio lets long bullets mask it.

    Unchanged bullets are excluded: a SKIP is 1.0 by definition and would drag
    the mean toward 1.0, hiding padding in the bullets that were rewritten.
    """
    ratios: list[float] = []
    for original, rewrite in zip(originals, rewrites):
        before = len(_WORD_RE.findall(original or ""))
        if not before or (original or "").strip() == (rewrite or "").strip():
            continue
        ratios.append(len(_WORD_RE.findall(rewrite or "")) / before)
    return sum(ratios) / len(ratios) if ratios else 1.0


def quantified_share(bullets: list[str]) -> float:
    """Share of bullets carrying a number. Not a target to maximise — Agent 3
    rule 4 explicitly forbids inventing or forcing metrics — but a sharp move
    in either direction between prompt revisions is worth looking at: up may
    mean fabrication, down may mean real metrics are being dropped.
    """
    present = [b for b in bullets if (b or "").strip()]
    if not present:
        return 0.0
    return sum(1 for b in present if _NUMBER_RE.search(b)) / len(present)


# Agent 2 rule 4's own ceiling: "do not inject the same target keyword into
# more than 2-3 bullets". Four is where the prompt itself says the output has
# become gamed, so that is where the report flags it.
KEYWORD_BULLET_LIMIT = 3


def build_report(
    *,
    original_bullets: list[str],
    tailored_bullets: list[str],
    jd_keywords: list[str],
    ats_before: int,
    ats_after: int,
    reverted_bullets: list[dict],
) -> dict:
    """One run's comparable record. Flat and JSON-serialisable so two runs can
    be diffed by compare_reports without any special handling."""
    total = len(original_bullets)
    changed = sum(
        1 for o, t in zip(original_bullets, tailored_bullets)
        if (o or "").strip() != (t or "").strip()
    )
    overuse = {
        kw: n
        for kw, n in keyword_concentration(tailored_bullets, jd_keywords).items()
        if n > KEYWORD_BULLET_LIMIT
    }
    return {
        "ats_before": ats_before,
        "ats_after": ats_after,
        "ats_delta": ats_after - ats_before,
        "bullets_total": total,
        "bullets_changed": changed,
        "revert_rate": round(len(reverted_bullets) / total, 4) if total else 0.0,
        "specificity_retention": round(specificity_retention(original_bullets, tailored_bullets), 4),
        "verb_diversity": round(verb_diversity(tailored_bullets), 4),
        "quantified_share": round(quantified_share(tailored_bullets), 4),
        "word_growth": round(word_growth(original_bullets, tailored_bullets), 4),
        "max_bullet_words": max((len(_WORD_RE.findall(b or "")) for b in tailored_bullets), default=0),
        "keyword_overuse": overuse,
    }


def compare_reports(before: dict, after: dict) -> dict:
    """Only what moved between two runs — the answer to "did my prompt edit
    help?". Metrics that didn't change are omitted so a diff is all signal.
    """
    out: dict = {}
    for key in sorted(set(before) | set(after)):
        b, a = before.get(key), after.get(key)
        if b == a:
            continue
        entry = {"before": b, "after": a}
        if isinstance(b, (int, float)) and isinstance(a, (int, float)) \
                and not isinstance(b, bool) and not isinstance(a, bool):
            entry["delta"] = round(a - b, 4)
        out[key] = entry
    return out

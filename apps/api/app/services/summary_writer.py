"""The professional summary: written for every tailoring run, and on request
from the Builder.

The user's research (2026-11-23) sets the shape: a 2-4 line prose block
under the contact header, in implied first person, built as Identity (title,
years, domain) -> Proof (one or two results) -> Fit (what the job asks for
that the candidate shows), its length scaled to career stage. The user's
calls on top: a candidate applying to a different job opens with their real
identity and names the target role at the end; a summary that passes the
checks below starts switched on in the review.

What the model is told it may not do is checked here in code, the way
bullet_guard checks the rewritten bullets: a number the résumé doesn't have,
a job tool it doesn't show, years it doesn't add up to, a level it doesn't
hold, a job title it never had in the opening, first person, clichés,
length. One retry with the problems listed; a draft that still fails is
returned WITH its problems, and the review starts it switched off.
"""
from __future__ import annotations

import json
import logging
import math
import re
from dataclasses import dataclass, field

from pydantic import BaseModel

from app.services.ai_engine.base import AIProvider
from app.services.ats import _levels, _term_shown, _title_tokens, title_match_verdict
from app.services.bullet_guard import numbers
from app.services.jd_requirements import resume_years
from app.services.plain_text import plain_text

logger = logging.getLogger("app")

MAX_CHARS = 400
_MAX_SENTENCE_WORDS = 25
_MAX_TOKENS = 1500

# Words per career stage, from the research's table.
BANDS: dict[str, tuple[int, int]] = {
    "fresher": (30, 45),
    "early": (40, 55),
    "mid": (50, 65),
    "senior": (55, 70),
}
_LEADER = re.compile(
    r"\b(vice president|vp|svp|evp|director|head of|chief|ceo|cto|cfo|coo|cio|ciso|cmo|cxo|general manager|managing director|partner)\b",
    re.I,
)

# The research's cliché list, plus the weak openers it names. Checked on the
# draft; the same words are in the prompt.
_CLICHES = re.compile(
    r"\b(results[- ](?:driven|oriented)|proven track record|track record of success|dynamic|innovative"
    r"|passionate|hard[- ]?working|team player|go[- ]getter|detail(?:ed)?[- ]oriented|problem[- ]solver"
    r"|responsible for|assisted with|helped|worked on|successfully|synerg(?:y|ies)|leverag(?:e|ed|es|ing)"
    r"|spearhead(?:ed|ing|s)?|seeking a challenging|utili[sz](?:e|ed|es|ing)|(?:highly |self[- ])?motivated"
    r"|self[- ]starter|seasoned|orchestrated|pivotal|delve|transformative|cutting[- ]edge|world[- ]class)\b",
    re.I,
)
_FIRST_PERSON = re.compile(r"(?<![\w.])I(?![\w.])|(?i:\b(?:me|my|mine|myself|we|our|us)\b)")
_YEARS = re.compile(r"\b(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)\b", re.I)
_SENTENCE = re.compile(r"(?<=[.!?])\s+")


@dataclass
class SummaryFacts:
    """What code knows about the candidate before the model writes a word."""
    years: float | None
    years_phrase: str
    stage: str
    min_words: int
    max_words: int
    held_titles: list[str] = field(default_factory=list)


def summary_facts(content: dict) -> SummaryFacts:
    years = resume_years(content)
    roles = [e for e in (content.get("experience") or []) if isinstance(e, dict)]
    held = [str(content.get("headline") or "")] + [str(e.get("title") or "") for e in roles]
    held = [t.strip() for t in held if t and t.strip()]
    if years is not None and years >= 1:
        whole = math.floor(years)
        phrase = f"{whole}+ years" if years - whole >= 0.25 else f"{whole} years"
    else:
        phrase = ""
    if any(_LEADER.search(t) for t in held) or (years or 0) >= 15:
        stage = "senior"
    elif years is None:
        stage = "early" if roles else "fresher"
    elif years < 1:
        stage = "fresher"
    elif years < 5:
        stage = "early"
    else:
        stage = "mid"
    lo, hi = BANDS[stage]
    return SummaryFacts(years, phrase, stage, lo, hi, held)


def _evidence(content: dict) -> str:
    """Everything the candidate wrote, contact details aside."""
    body = {k: v for k, v in content.items() if k not in ("contact", "photo_url")}
    return json.dumps(body, ensure_ascii=False, default=str)


def _jd_terms(jd) -> list[str]:
    if jd is None:
        return []
    out: list[str] = []
    for group in (
        jd.exact_technical_tools, jd.methodologies_and_frameworks,
        jd.nice_to_have_skills, jd.ats_filter_phrases,
    ):
        for t in group or []:
            if t and t.strip() and t.strip().lower() not in {x.lower() for x in out}:
                out.append(t.strip())
    return out


_WORD = re.compile(r"[A-Za-z][A-Za-z-]{4,}")
_OPENING_END = re.compile(r"\s+(?:with|who|in|at|for|specializ\w*|focused)\b|[,;:]", re.I)


def _opening_levels(first_sentence: str) -> set[str]:
    """Level words in the role phrase that opens the summary — the words
    before "with", "who" or the first comma ("Senior Java Developer with 7+
    years…" → {"senior"}). Numbers and later words ("1,200 staff") are not
    a level."""
    role = _OPENING_END.split(first_sentence, maxsplit=1)[0]
    words = [w for w in role.split()[:6] if not any(c.isdigit() for c in w)]
    return _levels(" ".join(words))


def _posting_words_unshown(text: str, jd, shown: set[str], already: list[str]) -> list[str]:
    """Words of five letters or more that the summary shares with the job
    posting but the résumé never uses (no word with the same first five
    letters). The target title's own words are exempt — naming the role
    being applied for is the point of the closing sentence."""
    if jd is None:
        return []
    posting = " ".join(
        str(x) for group in (
            jd.exact_technical_tools, jd.methodologies_and_frameworks, jd.core_responsibilities,
            jd.domain_expertise_themes, jd.nice_to_have_skills, jd.ats_filter_phrases,
        ) for x in (group or [])
    ).lower()
    posting_stems = {w[:5] for w in re.findall(r"[a-z][a-z-]{4,}", posting)}
    exempt = set().union(*(_title_tokens(t) for t in (jd.target_job_titles or []))) if jd.target_job_titles else set()
    exempt |= {w.lower() for t in already for w in t.split()}
    stems = {w[:5] for w in shown if len(w) >= 5}
    out: list[str] = []
    for w in (m.group(0).lower() for m in _WORD.finditer(text)):
        if w[:5] in posting_stems and w not in exempt and w[:5] not in stems and w not in out:
            out.append(w)
    return out


def summary_problems(
    text: str, content: dict, facts: SummaryFacts, jd=None, *, same_role: bool = False,
) -> list[str]:
    """Why this summary can't start switched on — empty when it can. Each
    reason is written to be shown to the candidate."""
    text = (text or "").strip()
    if not text:
        return ["came back empty"]
    out: list[str] = []
    evidence = _evidence(content)
    shown_words = set(re.sub(r"[^a-z0-9+#]+", " ", evidence.lower()).split())

    # Years: only the figure the dates add up to.
    years_cap = math.floor(facts.years) if facts.years is not None else None
    year_numbers: set[str] = set()
    for m in _YEARS.finditer(text):
        year_numbers.add(m.group(1))
        if years_cap is None or years_cap < 1 or float(m.group(1)) > years_cap:
            out.append(f"says {m.group(0)} of experience, more than the job dates on the résumé add up to")
    # Every other number must be one the résumé has.
    invented = sorted(numbers(text) - numbers(evidence) - year_numbers)
    if invented:
        out.append(f"has a number that isn't on the résumé: {', '.join(invented)}")

    # A job tool or method named in the summary must be one the résumé shows.
    lowered = text.lower()
    unshown = [
        t for t in _jd_terms(jd)
        if re.search(rf"(?<![a-z0-9]){re.escape(t.lower())}(?![a-z0-9])", lowered)
        and not _term_shown(t, shown_words)
    ]
    if unshown:
        out.append(f"names {', '.join(unshown[:3])}, which the résumé doesn't show")
    # Words lifted from the job posting that the résumé never uses: a live
    # draft wrote "experience designing payment microservices" for a résumé
    # with neither, because the post asked for both.
    leaked = _posting_words_unshown(text, jd, shown_words, unshown)
    if leaked:
        out.append(f"takes words from the job posting the résumé doesn't show: {', '.join(leaked[:4])}")

    # The opening: no level the candidate doesn't hold, and for a job they
    # haven't done, not the target title (the user's call: real identity
    # first, the target role at the end).
    first = _SENTENCE.split(text, maxsplit=1)[0]
    raised = _opening_levels(first) - _levels(" ".join(facts.held_titles))
    if raised:
        out.append(f"opens with a level ({', '.join(sorted(raised))}) the résumé's job titles don't show")
    titles = [t for t in (getattr(jd, "target_job_titles", None) or []) if t and t.strip()]
    if titles and not same_role and title_match_verdict(titles, facts.held_titles) == "missing":
        opening = " ".join(first.split()[:6])
        if title_match_verdict(titles, [opening]) == "matched":
            out.append("opens with the target job title, a role the résumé doesn't show — it should open with the candidate's own role")

    return out + style_problems(text, facts)


def _stage_words(facts: SummaryFacts) -> str:
    """Who the word band is for, in the candidate's terms."""
    if facts.stage == "senior" and not facts.years_phrase:
        return "for a senior or leadership role"
    if facts.years_phrase:
        return f"for {facts.years_phrase} of experience"
    if facts.stage == "fresher":
        return "for a fresher"
    return "at this career stage"


# How far past the band's top a summary may run before it is "over the
# standard": a few words for KripaX's own draft, which is written to the
# band; more for one the candidate wrote (the user's call, 2026-11-28 — a
# 62-word summary at 1-5 years is fine; a 112-word one is not).
_DRAFT_SLACK = 5
_OWN_SLACK = 15


def style_problems(text: str, facts: SummaryFacts, *, own: bool = False) -> list[str]:
    """The research's rules on how a summary reads — person, filler words,
    length for the career stage, sentence length, one paragraph. No fact
    checks: these apply as well to a summary the candidate wrote, whose
    figures and titles are their own (POST /ai/check-summary, `own`). Their
    own summary is judged long only past _OWN_SLACK words over the band —
    the word count alone, not the 4-line character check, which would flag
    the same text first."""
    text = (text or "").strip()
    if not text:
        return []
    out: list[str] = []
    if _FIRST_PERSON.search(text):
        out.append('uses "I", "my" or "we"')
    cliches = sorted({m.group(0).lower() for m in _CLICHES.finditer(text)})
    if cliches:
        out.append(f"uses filler words: {', '.join(cliches)}")

    words = len(text.split())
    slack = _OWN_SLACK if own else _DRAFT_SLACK
    if words > facts.max_words + slack or words < min(25, facts.min_words - 15):
        side = "over" if words > facts.max_words else "under"
        out.append(
            f"is {words} word{'s' if words != 1 else ''}, {side} the standard: a professional summary {_stage_words(facts)} "
            f"is {facts.min_words} to {facts.max_words} words"
        )
    if not own and len(text) > MAX_CHARS + 40:
        out.append(f"runs past about 4 lines ({len(text)} characters)")
    long = [s for s in _SENTENCE.split(text) if len(s.split()) > _MAX_SENTENCE_WORDS]
    if long:
        out.append("has a sentence over 25 words")
    if "\n" in text or re.search(r"^\s*[-•*]", text, re.M):
        out.append("isn't a single paragraph")
    return out


class SummaryDraft(BaseModel):
    summary: str = ""
    # True when the candidate's own recent role is the target job under the
    # same or another name; only then may the summary open with its title.
    same_role: bool = False


SUMMARY_SYSTEM = """\
<system_role>
You write the professional summary at the top of a candidate's résumé: one \
short paragraph a recruiter reads in seconds and an ATS weighs above the \
rest of the page.
</system_role>

<facts>
Use ONLY facts in <resume>: its job titles, domains, tools, skills, projects \
and numbers (its current summary and objective, if any, are the candidate's \
own words — their facts count, their wording need not be kept). Every number you write must appear in the résumé as that same \
figure. Never invent a metric, tool, client, domain, team size or \
credential. If the résumé has no numbers, write no numbers. For years of \
experience use exactly years_phrase, or say nothing about years when it is \
empty — never work out years yourself.
</facts>

<structure>
Three parts, in this order, as complete sentences:
1. IDENTITY — a role title, then years_phrase if given, then the domain or \
specialty the résumé shows. If target_role is given and the candidate's own \
recent role is the same job (the same work, under the same or another \
name), open with target_role's wording at the candidate's own level. If it \
is a different job, open with the candidate's real role, or a transferable \
identity the résumé supports ("Operations professional with…"), NEVER with \
the target title. Never add Senior, Lead, Principal or any level the \
résumé's own titles don't show.
2. PROOF — one or two concrete results from the résumé, with their numbers \
if the résumé has them, in past tense ("Cut nightly sync time from 3 hours \
to 40 minutes.").
3. FIT — two or three tools, methods or domain priorities that the target \
job asks for AND the résumé shows, framed as what the candidate brings. For \
a different job, name the target role here ("Moving into Business Analyst \
work, bringing requirements gathering and SQL."). With no target job, close \
with the candidate's core tools and focus.
For a fresher (stage "fresher"): open with the person, field and degree \
("Computer Science graduate (Bachelor of Technology) with…") — never make \
the degree itself the subject — then the strongest project or internship \
result, core tools, and the entry role the target job is for.
</structure>

<style>
- Between min_words and max_words words, at most 400 characters. One \
paragraph: no line breaks, no bullets, no heading.
- Implied first person: never "I", "me", "my", "we", "our", and never the \
candidate's name.
- Present tense for the role and ongoing scope ("Builds…", "Specializes \
in…"); past tense for a finished result ("Cut…", "Built…"). No "have \
increased", no sentence opening with an -ing verb.
- Sentences under 20 words. Plain English, active voice, named tools.
- Never use: results-driven, proven track record, dynamic, innovative, \
passionate, hardworking, team player, go-getter, detail-oriented, problem \
solver, responsible for, assisted with, helped, worked on, successfully, \
synergy, leverage, spearhead, orchestrated, pivotal, seasoned, motivated, \
self-starter, transformative, cutting-edge, "seeking a challenging role", \
"utilize my skills".
- Words from the job posting only when the résumé shows the same thing; \
never describe the candidate in the posting's words for work the résumé \
doesn't show.
- Degrees in full ("Bachelor of Technology in Computer Science", not \
"B.Tech CS").
- When the job posting writes a key term both spelled out and as an \
acronym, you may write it once as "Spelled Out (ACRONYM)".
</style>

<output>Output ONLY valid JSON: {"summary": "...", "same_role": true|false} — same_role true only when the candidate's own recent role is the target job (same work, same or another name); false for a different job or no target.</output>"""


@dataclass
class Rework:
    """The review's Humanize and "tell the AI how to rewrite it": rework the
    summary the candidate is looking at, as asked, under every rule above.
    Sent in the user message only, so SUMMARY_SYSTEM — and with it every
    tailoring run's and Builder's summary — reads exactly as before."""
    current: str
    request: str


def rework_request(mode: str, humanize_level: int = 50, instruction: str = "") -> str:
    """What the candidate asked for, in words for the model."""
    if mode == "custom":
        return instruction.strip()
    if humanize_level < 50:
        return "Make it sound natural, as a person would write it: fewer keywords, plainer words, the same facts."
    return "Make it read as fluent, confident prose with a clear result, the same facts."


def _payload(
    content: dict, facts: SummaryFacts, jd, problems: list[str] | None, previous: str,
    rework: Rework | None = None,
) -> str:
    resume = {k: v for k, v in content.items() if k not in ("contact", "photo_url")}
    body: dict = {
        "resume": resume,
        "stage": facts.stage,
        "years_phrase": facts.years_phrase,
        "min_words": facts.min_words,
        "max_words": facts.max_words,
    }
    if jd is not None:
        titles = [t for t in (jd.target_job_titles or []) if t and t.strip()]
        body["target_role"] = titles[0] if titles else ""
        body["target_job_asks_for"] = {
            "tools": jd.exact_technical_tools or [],
            "methods": jd.methodologies_and_frameworks or [],
            "responsibilities": jd.core_responsibilities or [],
            "domain": jd.domain_expertise_themes or [],
        }
    text = json.dumps(body, ensure_ascii=False, default=str)
    if rework is not None:
        text += (
            "\n\n<current_summary>\n" + rework.current + "\n</current_summary>\n"
            "<candidate_request>\n" + rework.request + "\n</candidate_request>\n"
            "Rework current_summary as candidate_request asks. Every rule still holds: "
            "where the request asks for something the rules forbid (a number, tool, level "
            "or claim the résumé doesn't show), keep to the rules."
        )
    if problems:
        text += (
            "\n\n<previous_attempt>\n" + previous + "\n</previous_attempt>\n"
            "<fix_these>\n- " + "\n- ".join(problems) + "\n</fix_these>\n"
            "Write it again, keeping to every rule."
        )
    return text


@dataclass
class SummaryResult:
    text: str
    problems: list[str]
    facts: SummaryFacts


async def write_summary(
    content: dict,
    provider: AIProvider,
    jd=None,
    *,
    call_name: str = "write_summary",
    rework: Rework | None = None,
) -> SummaryResult:
    """A summary for `content` (for the job in `jd` when given). Two tries;
    returns the last draft with whatever problems are left. Never raises:
    tailoring goes on without a summary if the model fails."""
    facts = summary_facts(content)
    text, problems = "", []
    for attempt in range(2):
        try:
            draft = await provider.complete_structured(
                SUMMARY_SYSTEM, _payload(content, facts, jd, problems, text, rework), SummaryDraft,
                model_tier="premium", max_output_tokens=_MAX_TOKENS, call_name=call_name,
            )
        except Exception:
            logger.warning("summary writer failed (attempt %d)", attempt + 1, exc_info=True)
            break
        text = " ".join(plain_text(draft.summary or "").split()).strip().strip('"').strip()
        problems = summary_problems(text, content, facts, jd, same_role=bool(draft.same_role))
        if not problems:
            break
        logger.info("summary draft %d refused: %s", attempt + 1, problems)
    return SummaryResult(text=text, problems=problems if text else [], facts=facts)

"""What a job post asks for beyond hard skills, and how far a résumé meets it.

The ATS reference's job-match table (its section 9) weighs, after hard
skills and the title: soft skills (medium), years of experience (medium),
and education level only when the post asks for an advanced degree. The
hard skills and title come from Agent 1; these three are read here, from
the post's own text, with fixed patterns:

- deterministic: the same post always reads the same, so a score never
  moves between visits;
- free: no model runs, so nothing is charged;
- never model input: JDAnalysis.requirements is excluded from every dump,
  so no prompt payload changes (tests/test_jd_requirements.py pins it).

Matching on the résumé side is literal, the way the checker tools do it,
with the plain evidence a recruiter reads for each soft skill ("led a team
of four" shows leadership). Years count full-time roles only, overlaps
merged, from the dates on the page.
"""
from __future__ import annotations

import re
from datetime import date

from pydantic import BaseModel

from app.services.resume_dates import is_present, parse_month_year


class JdRequirements(BaseModel):
    """The post's soft skills (canonical names, in the order it first names
    them), its general years-of-experience floor, and an advanced degree it
    requires ("master" | "doctorate") — None when it requires none."""
    soft_skills: list[str] = []
    min_years: float | None = None
    advanced_degree: str | None = None


# ── Soft skills ─────────────────────────────────────────────────────────────
# canonical name → (how a job post asks for it, what on a résumé shows it).
# The post side is narrow on purpose: only wording that names the skill,
# never a word that merely occurs ("flexible hours" is not adaptability).
_SOFT_SKILLS: dict[str, tuple[str, str]] = {
    "communication": (
        r"\bcommunicat(?:e|es|ing|ion|ions|or)\b",
        r"\bcommunicat\w*|\bpresent(?:ed|ing|ation|ations)\b",
    ),
    "collaboration": (
        r"\bcollaborat(?:e|ing|ion|ive|ively)\b|\bcross[- ]functional\b",
        r"\bcollaborat\w*|\bcross[- ]functional\b|\bpartner(?:ed|ing) with\b",
    ),
    "teamwork": (
        r"\bteam ?work\b|\bteam player\b|\bwork(?:ing)? (?:well )?(?:in|as part of|within) (?:a )?teams?\b",
        r"\bteam ?work\b|\bteams?\b",
    ),
    "leadership": (
        r"\bleadership\b|\blead(?:ing)? (?:a |the )?teams?\b|\bpeople management\b",
        r"\bleadership\b|\bled\b|\blead(?:s|ing)? (?:a |the )?(?:\w+ )?teams?\b|\bmentor\w*|\bmanag(?:ed|ing) (?:a )?(?:\w+ )?team\b|\bheaded\b",
    ),
    "problem solving": (
        r"\bproblem[- ]solv\w*|\bsolv(?:e|ing) (?:complex |challenging |difficult )?problems\b",
        r"\bproblem[- ]solv\w*|\bsolv(?:e|ed|es|ing)\b|\bresolv(?:e|ed|es|ing)\b|\btroubleshoot\w*|\bdebugg?(?:ed|ing)\b",
    ),
    "analytical thinking": (
        r"\banalytical\b",
        r"\banalytical\b|\banaly[sz](?:e|ed|es|ing|is)\b",
    ),
    "critical thinking": (
        r"\bcritical thinking\b",
        r"\bcritical thinking\b|\bevaluat(?:e|ed|ing)\b|\bassess(?:ed|ing)?\b",
    ),
    "attention to detail": (
        r"\battention to detail\b|\bdetail[- ]oriented\b|\beye for detail\b",
        r"\battention to detail\b|\bdetail[- ]oriented\b|\baccura(?:te|cy)\b|\berror[- ]free\b|\bzero (?:defects|errors)\b",
    ),
    "time management": (
        r"\btime management\b|\bmanag(?:e|ing) (?:your |their |one'?s )?(?:own )?time\b|\bmeet(?:ing)? (?:tight )?deadlines\b",
        r"\btime management\b|\bdeadlines?\b|\bahead of schedule\b|\bon schedule\b|\bon time\b",
    ),
    "adaptability": (
        r"\badaptab\w*|\bability to adapt\b|\badapt(?:s|ing)? (?:quickly )?to\b",
        r"\badapt\w*",
    ),
    "stakeholder management": (
        r"\bstakeholders?\b",
        r"\bstakeholders?\b",
    ),
    "mentoring": (
        r"\bmentor\w*|\bcoach(?:ing)?\b",
        r"\bmentor\w*|\bcoach(?:ed|ing)?\b|\btrain(?:ed|ing) (?:\w+ )?(?:new |junior )?(?:hires|joiners|engineers|members|staff|interns)\b",
    ),
    "ownership": (
        r"\bownership\b",
        r"\bownership\b|\bowned\b|\bend[- ]to[- ]end\b",
    ),
    "initiative": (
        r"\bself[- ]starter\b|\bself[- ]motivated\b|\bproactive\w*|\btake (?:the )?initiative\b|\binitiative\b",
        r"\binitiat(?:ed|ing|ive)\b|\bproactive\w*|\bvolunteered\b",
    ),
    "presentation": (
        r"\bpresentation skills\b|\bpublic speaking\b|\bpresent(?:ing)? to\b",
        r"\bpresent(?:ed|ing|ation|ations)\b|\bpublic speaking\b|\bdemo(?:ed|'d)?\b|\bspoke at\b",
    ),
    "negotiation": (
        r"\bnegotiat\w*",
        r"\bnegotiat\w*",
    ),
    "interpersonal skills": (
        r"\binterpersonal\b",
        r"\binterpersonal\b|\bclient[- ]facing\b|\bstakeholders?\b|\bcustomers?\b|\bclients?\b",
    ),
    "customer focus": (
        r"\bcustomer[- ](?:focus\w*|centric\w*|obsess\w*|orient\w*|first)\b|\bclient[- ](?:focus\w*|centric\w*)\b",
        r"\bcustomers?\b|\bclients?\b|\busers?\b",
    ),
    "decision making": (
        r"\bdecision[- ]making\b",
        r"\bdecision[- ]making\b|\bdecid(?:ed|ing)\b|\bdecisions?\b",
    ),
    "conflict resolution": (
        r"\bconflict (?:resolution|management)\b|\bresolv(?:e|ing) conflicts?\b",
        r"\bconflicts?\b",
    ),
    "prioritization": (
        r"\bprioriti[sz]\w*",
        r"\bprioriti[sz]\w*",
    ),
    "creativity": (
        r"\bcreativ\w*",
        r"\bcreativ\w*|\binnovat\w*",
    ),
    "multitasking": (
        r"\bmulti-?task\w*|\bjuggl(?:e|ing) (?:multiple|several)\b",
        r"\bmulti-?task\w*|\bconcurrent(?:ly)?\b|\bsimultaneous(?:ly)?\b|\bin parallel\b",
    ),
    "organization": (
        r"\borgani[sz]ational skills\b|\bwell[- ]organi[sz]ed\b|\bhighly organi[sz]ed\b",
        r"\borgani[sz](?:ed|ing)\b|\bcoordinat(?:ed|ing)\b",
    ),
}
_SOFT_POST = {name: re.compile(post, re.I) for name, (post, _) in _SOFT_SKILLS.items()}
_SOFT_RESUME = {name: re.compile(resume, re.I) for name, (_, resume) in _SOFT_SKILLS.items()}


def _soft_skills_in(text: str) -> list[str]:
    found: list[tuple[int, str]] = []
    for name, pattern in _SOFT_POST.items():
        m = pattern.search(text)
        if m:
            found.append((m.start(), name))
    return [name for _, name in sorted(found)]


# ── Years of experience ─────────────────────────────────────────────────────
_NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20,
}
_NUM = r"(\d{1,2}(?:\.\d)?|" + "|".join(_NUMBER_WORDS) + r")"
_YEARS = r"(?:years?|yrs?)\b"
# "5+ years of professional software development experience", "3-5 yrs
# experience", "minimum of 4 years' experience", "two years of hands-on
# experience". Up to five words may sit between "years of" and "experience".
_YEARS_BEFORE = re.compile(
    rf"\b{_NUM}\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*{_NUM}\s*\+?\s*)?{_YEARS}['’]?s?"
    r"(?:\s+of)?(?:\s+[\w/&.+#'’-]+){0,5}?\s+(?:experience|exp)\b",
    re.I,
)
# "Experience: 3-5 years", "experience of 2+ years".
_YEARS_AFTER = re.compile(
    rf"\bexperience\s*(?:[:\-–]|of|required|needed)?\s*(?:of\s*)?(?:at least\s*|minimum\s*)?{_NUM}\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*{_NUM}\s*)?{_YEARS}",
    re.I,
)
# Without the word "experience", a floor still reads as one when it is
# stated as a floor ("5+ years building backend services", "at least 3
# years in sales") or a requirement line opens with it ("- 4 years of
# Java", "• 3 years managing teams").
_YEARS_FLOOR = re.compile(
    rf"(?:\b{_NUM}\s*(?:\+|plus)\s*{_YEARS}|\b(?:at least|minimum(?: of)?|min\.)\s+{_NUM}\s*{_YEARS})"
    r"(?=\s+(?:of|in|with|as|on|doing|\w+ing)\b)",
    re.I,
)
_YEARS_LINE = re.compile(
    rf"^\s*[-•*●▪·]?\s*{_NUM}\s*(?:(?:-|–|to)\s*{_NUM}\s*)?{_YEARS}\s+(?:of|in|with|as|\w+ing)\b",
    re.I | re.M,
)
# What a company says about itself: "20+ years in the industry", "for over
# 10 years". Never a floor for the candidate.
_COMPANY_AGE_AFTER = re.compile(r"^[^.;\n]{0,40}\b(market|industry|business|existence|operation|history)\b", re.I)
_COMPANY_AGE_BEFORE = re.compile(r"\b(for over|for more than|founded|since|established|serving|trusted)\b[^.;\n]{0,20}$", re.I)
_MAX_YEARS = 25.0


def _as_number(token: str) -> float:
    return float(_NUMBER_WORDS.get(token.lower(), token))


def _min_years_in(text: str) -> float | None:
    """The post's general floor: the largest "at least N years" it names. A
    range counts from its low end ("3-5 years" is 3)."""
    floors: list[float] = []
    for pattern in (_YEARS_BEFORE, _YEARS_AFTER, _YEARS_FLOOR, _YEARS_LINE):
        loose = pattern in (_YEARS_FLOOR, _YEARS_LINE)  # no "experience" to anchor them
        for m in pattern.finditer(text):
            if loose and (_COMPANY_AGE_AFTER.search(text[m.end():]) or _COMPANY_AGE_BEFORE.search(text[:m.start()])):
                continue
            number = next(g for g in m.groups() if g)
            floors.append(_as_number(number))
    floors = [f for f in floors if 0 < f <= _MAX_YEARS]
    return max(floors) if floors else None


_INTERNSHIP = re.compile(r"\b(intern(ship)?|trainee|apprentice(ship)?)\b", re.I)


def _month_index(raw, *, end: bool) -> int | None:
    parsed = parse_month_year(raw)
    if parsed is None:
        return None
    year, month = parsed
    return year * 12 + (month if month is not None else (11 if end else 0))


def resume_years(content: dict, today: date | None = None) -> float | None:
    """Years of full-time experience the résumé shows, overlaps counted once.
    Internships and trainee roles are left out. None when there are roles
    but none has dates that can be read — unknown, not zero."""
    today = today or date.today()
    roles = [
        e for e in (content.get("experience") or [])
        if isinstance(e, dict) and not _INTERNSHIP.search(f"{e.get('title') or ''} {e.get('company') or ''}")
    ]
    if not roles:
        return 0.0
    spans: list[tuple[int, int]] = []
    for role in roles:
        start = _month_index(role.get("start"), end=False)
        end_raw = role.get("end")
        end = today.year * 12 + today.month - 1 if is_present(end_raw) else _month_index(end_raw, end=True)
        if start is None or end is None or end < start:
            continue
        spans.append((start, end + 1))  # months are inclusive
    if not spans:
        return None
    spans.sort()
    total, (cur_start, cur_end) = 0, spans[0]
    for s, e in spans[1:]:
        if s <= cur_end:
            cur_end = max(cur_end, e)
        else:
            total += cur_end - cur_start
            cur_start, cur_end = s, e
    total += cur_end - cur_start
    return round(total / 12, 1)


# ── Advanced degree ─────────────────────────────────────────────────────────
_DOCTORATE = r"\bph\.?\s?d\b|\bdoctor(?:ate|al)\b"
_MASTER = (
    r"\bmaster['’]?s?\b|\bm\.?\s?tech\b|\bm\.?\s?sc\b|\bm\.s\b|\bms (?:in|degree)\b"
    r"|\bm\.?b\.?a\b|\bm\.?c\.?a\b|\bm\.e\b|\bpost[- ]?graduat\w*|\bpg (?:degree|diploma)\b"
)
_BACHELOR = (
    r"\bbachelor['’]?s?\b|\bb\.?\s?tech\b|\bb\.?\s?sc\b|\bb\.s\b|\bbs (?:in|degree)\b|\bb\.e\b"
    r"|\bb\.?c\.?a\b|\bundergraduate\b|\bany graduat\w*"
)
_PREFERRED = re.compile(
    r"\b(prefer\w*|a plus|nice to have|good to have|desir\w*|ideally|advantage\w*|bonus|optional|equivalent)\b", re.I,
)
LEVELS = {"master": 2, "doctorate": 3}


def _level_in(text: str) -> int:
    if re.search(_DOCTORATE, text, re.I):
        return 3
    if re.search(_MASTER, text, re.I):
        return 2
    return 0


def _advanced_degree_in(text: str) -> str | None:
    """"master" or "doctorate" when the post requires one; None when it
    asks for a bachelor's, offers one as an alternative ("Bachelor's or
    Master's"), or only prefers it."""
    required = 0
    # Sentences end at a stop before a capital, a semicolon, a line or a
    # bullet — never at an abbreviation's dots ("M.S. or B.S. in CS").
    for sentence in re.split(r"(?<=[.!?])\s+(?=[A-Z])|[;\n•●▪]+", text):
        if _PREFERRED.search(sentence) or re.search(_BACHELOR, sentence, re.I):
            continue
        level = 2 if re.search(_MASTER, sentence, re.I) else 0
        if re.search(_DOCTORATE, sentence, re.I):
            # "PhD or Master's" asks for the lower of the two.
            level = 2 if level == 2 and re.search(r"\bor\b|/", sentence) else 3
        required = max(required, level)
    return {2: "master", 3: "doctorate"}.get(required)


def read_requirements(jd_text: str) -> JdRequirements:
    text = jd_text or ""
    return JdRequirements(
        soft_skills=_soft_skills_in(text),
        min_years=_min_years_in(text),
        advanced_degree=_advanced_degree_in(text),
    )


def with_requirements(jd_analysis, jd_text: str):
    """*jd_analysis* carrying the post's requirements, read once. One that
    already carries them is returned as is."""
    if getattr(jd_analysis, "requirements", None) is not None:
        return jd_analysis
    return jd_analysis.model_copy(update={"requirements": read_requirements(jd_text)})


# ── Résumé against the requirements ─────────────────────────────────────────
# Soft skills share one budget — a post listing ten of them must not drown
# out its hard skills — at most half a hard skill each. Years and an
# advanced degree are one signal each, "medium" next to the title's 2.0.
SOFT_SKILL_WEIGHT = 0.5
SOFT_SKILLS_BUDGET = 2.0
YEARS_WEIGHT = 1.5
DEGREE_WEIGHT = 1.5


def resume_degree_levels(content: dict, today: date | None = None) -> tuple[int, int]:
    """(highest finished level, highest level in progress)."""
    today = today or date.today()
    done = ongoing = 0
    for edu in content.get("education") or []:
        if not isinstance(edu, dict):
            continue
        level = _level_in(str(edu.get("degree") or ""))
        if not level:
            continue
        year = str(edu.get("year") or "")
        parsed = parse_month_year(re.sub(r"(?i)^\s*expected\s*", "", year).split("-")[-1].strip())
        in_progress = bool(re.search(r"(?i)\bexpected\b", year)) or is_present(year) or (
            parsed is not None and (parsed[0], parsed[1] or 0) > (today.year, today.month - 1)
        )
        if in_progress:
            ongoing = max(ongoing, level)
        else:
            done = max(done, level)
    return done, ongoing


def soft_skills_shown(content: dict, soft_skills: list[str]) -> dict[str, bool]:
    from app.services.ats import build_resume_text

    full_text, _ = build_resume_text(content)
    return {s: bool(_SOFT_RESUME[s].search(full_text)) for s in soft_skills if s in _SOFT_RESUME}


def requirement_signals(content: dict, req: JdRequirements | None, today: date | None = None) -> list[tuple[float, str]]:
    """(weight, verdict) per requirement signal, for the blended score.
    Verdicts are matched / partial / missing. A requirement the résumé can't
    be read against (roles with no readable dates) is left out, not failed."""
    if req is None:
        return []
    today = today or date.today()
    signals: list[tuple[float, str]] = []

    shown = soft_skills_shown(content, req.soft_skills)
    if shown:
        each = min(SOFT_SKILL_WEIGHT, SOFT_SKILLS_BUDGET / len(shown))
        signals += [(each, "matched" if hit else "missing") for hit in shown.values()]

    if req.min_years:
        have = resume_years(content, today)
        if have is not None:
            verdict = "matched" if have >= req.min_years else "partial" if have >= 0.75 * req.min_years else "missing"
            signals.append((YEARS_WEIGHT, verdict))

    if req.advanced_degree:
        need = LEVELS[req.advanced_degree]
        done, ongoing = resume_degree_levels(content, today)
        verdict = "matched" if done >= need else "partial" if ongoing >= need else "missing"
        signals.append((DEGREE_WEIGHT, verdict))
    return signals

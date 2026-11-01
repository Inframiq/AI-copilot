"""Résumé dates in one style: "Jun 2025", "2022" or "Present".

An ATS adds up each job's start-to-end span to get total experience; a date
it can't read drops that job from the total. The ATS reference asks for one
date style across the whole résumé, written as month and year, with
"Present" (not "Current", "Ongoing" or "Till date") for a role still held.

The Studio's date picker already writes this form (apps/web/lib/month-year.ts
— this is the same reading, for what reaches the renderer by any other way:
an upload's parse, a model's output, a résumé saved before the picker).
Text that isn't a date is handed back unchanged; the ATS check reports it.
"""
import re
from datetime import date

MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_NAMES = ("january", "february", "march", "april", "may", "june", "july", "august",
          "september", "october", "november", "december")
PRESENT = "Present"
_PRESENT_WORDS = re.compile(r"^(present|current(ly)?|now|ongoing|till date|to date|today)$", re.I)


def is_present(raw) -> bool:
    return bool(_PRESENT_WORDS.match(str(raw or "").strip()))


def _month_of(word: str) -> int | None:
    w = word.lower().rstrip(".")
    if len(w) < 3:
        return None
    for i, name in enumerate(_NAMES):
        if name.startswith(w) or (w == "sept" and name == "september"):
            return i
    return None


def _year_of(text: str) -> int | None:
    if re.fullmatch(r"\d{4}", text):
        return int(text)
    if re.fullmatch(r"\d{2}", text):
        n = int(text)
        cutoff = (date.today().year + 10) % 100
        return 2000 + n if n <= cutoff else 1900 + n
    return None


def parse_month_year(raw) -> tuple[int, int | None] | None:
    """(year, month 0-11 or None) for a date, None for anything else.
    Reads "Jan 2022", "January 2022", "Sept. 2021", "Jan '22", "01/2022",
    "1-2022", "2022-01", "2022/01" and a bare "2022"."""
    s = re.sub(r"\s+", " ", str(raw or "").strip())
    if not s:
        return None
    m = re.fullmatch(r"([A-Za-z]{3,9}\.?),? '?(\d{2}|\d{4})", s)
    if m:
        month, year = _month_of(m.group(1)), _year_of(m.group(2))
        return (year, month) if month is not None and year is not None else None
    m = re.fullmatch(r"(\d{1,2})\s*[/.-]\s*(\d{4})", s)
    if m and 1 <= int(m.group(1)) <= 12:
        return int(m.group(2)), int(m.group(1)) - 1
    m = re.fullmatch(r"(\d{4})\s*[/.-]\s*(\d{1,2})", s)
    if m and 1 <= int(m.group(2)) <= 12:
        return int(m.group(1)), int(m.group(2)) - 1
    if re.fullmatch(r"\d{4}", s):
        return int(s), None
    return None


def tidy_date(raw) -> str:
    """The standard form of a date, "" for nothing, the text unchanged when
    it isn't a date."""
    s = str(raw or "").strip()
    if not s:
        return ""
    if is_present(s):
        return PRESENT
    d = parse_month_year(s)
    if not d:
        return s
    year, month = d
    return str(year) if month is None else f"{MONTHS[month]} {year}"


def is_standard_date(raw) -> bool:
    s = str(raw or "").strip()
    return s == "" or s == PRESENT or (tidy_date(s) == s and parse_month_year(s) is not None)


_DATED_KEYS = ("start", "end")


def tidy_resume_dates(content: dict) -> dict:
    """*content* with every role's, role project's and project's start/end
    in the standard form. A copy — the stored résumé is not touched."""
    def tidy_entry(entry):
        if not isinstance(entry, dict):
            return entry
        out = dict(entry)
        for key in _DATED_KEYS:
            if isinstance(out.get(key), str):
                out[key] = tidy_date(out[key])
        if isinstance(out.get("projects"), list):
            out["projects"] = [tidy_entry(p) for p in out["projects"]]
        return out

    result = dict(content)
    for section in ("experience", "projects"):
        if isinstance(result.get(section), list):
            result[section] = [tidy_entry(e) for e in result[section]]
    return result

"""A degree written as its short form, in full.

The user's research (2026-11-23): Indian résumés should write degrees in
full — "Bachelor of Technology", not "B.Tech" — because recruiters and
some systems miss the short forms. The full form keeps the short one in
brackets ("Bachelor of Technology (B.Tech)"), the way the degree
suggestions print it, so a search for either finds it.

Nothing is rewritten on its own: the Profile and Builder offer the full
name beside the field, and the ATS check (services/ats_check.py) names a
short form it finds. apps/web/lib/degree-names.ts is the same rule; the
cases both must pass are in packages/types/degree-name-cases.json.
"""
from __future__ import annotations

import re

# (letters of the short form, the full name). Two-letter forms and words
# that are also English (BE, MA, March, Med…) are "strict": they count only
# written in capitals or with a dot, so "March 2020" or "Me" is never a
# degree.
_DEGREES: list[tuple[tuple[str, ...], str, bool]] = [
    (("b", "tech"), "Bachelor of Technology (B.Tech)", False),
    (("m", "tech"), "Master of Technology (M.Tech)", False),
    (("b", "e"), "Bachelor of Engineering (B.E.)", True),
    (("m", "e"), "Master of Engineering (M.E.)", True),
    (("b", "sc"), "Bachelor of Science (B.Sc.)", False),
    (("m", "sc"), "Master of Science (M.Sc.)", False),
    (("b", "s"), "Bachelor of Science (B.S.)", True),
    (("m", "s"), "Master of Science (M.S.)", True),
    (("b", "a"), "Bachelor of Arts (B.A.)", True),
    (("m", "a"), "Master of Arts (M.A.)", True),
    (("b", "com"), "Bachelor of Commerce (B.Com)", False),
    (("m", "com"), "Master of Commerce (M.Com)", False),
    (("b", "c", "a"), "Bachelor of Computer Applications (BCA)", False),
    (("m", "c", "a"), "Master of Computer Applications (MCA)", False),
    (("b", "b", "a"), "Bachelor of Business Administration (BBA)", False),
    (("m", "b", "a"), "Master of Business Administration (MBA)", False),
    (("p", "g", "d", "m"), "Post Graduate Diploma in Management (PGDM)", False),
    (("b", "arch"), "Bachelor of Architecture (B.Arch)", False),
    (("m", "arch"), "Master of Architecture (M.Arch)", True),
    (("b", "des"), "Bachelor of Design (B.Des)", False),
    (("m", "des"), "Master of Design (M.Des)", False),
    (("b", "pharm"), "Bachelor of Pharmacy (B.Pharm)", False),
    (("m", "pharm"), "Master of Pharmacy (M.Pharm)", False),
    (("m", "b", "b", "s"), "Bachelor of Medicine, Bachelor of Surgery (MBBS)", False),
    (("b", "d", "s"), "Bachelor of Dental Surgery (BDS)", False),
    (("l", "l", "b"), "Bachelor of Laws (LL.B.)", False),
    (("l", "l", "m"), "Master of Laws (LL.M.)", False),
    (("b", "ed"), "Bachelor of Education (B.Ed)", True),
    (("m", "ed"), "Master of Education (M.Ed)", True),
    (("ph", "d"), "Doctor of Philosophy (Ph.D.)", False),
    (("m", "phil"), "Master of Philosophy (M.Phil)", False),
    (("b", "f", "a"), "Bachelor of Fine Arts (BFA)", False),
    (("m", "f", "a"), "Master of Fine Arts (MFA)", False),
    (("b", "h", "m"), "Bachelor of Hotel Management (BHM)", False),
    (("b", "s", "w"), "Bachelor of Social Work (BSW)", False),
    (("m", "s", "w"), "Master of Social Work (MSW)", False),
    (("b", "p", "t"), "Bachelor of Physiotherapy (BPT)", False),
]

# Longest short form first, so "M.B.B.S" is not read as "M.B.A"'s start
# and "BSc" not as "BS".
_DEGREES.sort(key=lambda d: -sum(len(p) for p in d[0]))

_PATTERNS = [
    (re.compile(r"^\s*(" + r"\.?\s?".join(re.escape(p) for p in parts) + r"\.?)(?=$|[\s,(:;/–—-])", re.I), full, strict)
    for parts, full, strict in _DEGREES
]

# What may follow the short form without an "in" between: punctuation, a
# bracket, a joining word, or Honours.
_NO_IN = re.compile(r"^(?:[,(:;/–—-]|(?:in|of|with|and|hons?|honou?rs|honors)\b)", re.I)


_BRACKETED = re.compile(r"\((.+)\)")
_HONOURS = re.compile(r"\s*(?:hons?|honou?rs|honors)\.?\s*", re.I)


def full_degree_name(degree: str | None) -> str | None:
    """The degree with its short form written in full, or None when it
    doesn't open with one we know (already in full, or not a degree).
    "B.Tech in CSE" → "Bachelor of Technology (B.Tech) in CSE"."""
    text = " ".join((degree or "").split())
    if not text:
        return None
    for pattern, full, strict in _PATTERNS:
        m = pattern.match(text)
        if not m:
            continue
        short = m.group(1)
        if strict and "." not in short and not short.replace(" ", "").isupper():
            continue
        rest = text[m.end():].strip()
        if not rest:
            return full
        if rest.lower().startswith(full.split()[0].lower()):
            return None  # "B.Tech Bachelor of…": written out already
        # "B.Tech (CSE)": the branch in brackets reads as "in CSE" once the
        # short form is in brackets itself; "(Hons)" stays.
        bracketed = _BRACKETED.fullmatch(rest)
        if bracketed and not _HONOURS.fullmatch(bracketed.group(1)):
            rest = bracketed.group(1).strip()
        if rest[0] in ",:;/":
            return f"{full}{rest}"
        return f"{full} {rest}" if _NO_IN.match(rest) else f"{full} in {rest}"
    return None

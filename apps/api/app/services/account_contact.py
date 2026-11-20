"""Every résumé carries the account's own name, email and phone.

An account is one person's: the name is fixed once the profile is set up,
the email is the sign-in email, and the phone changes rarely (migrations
058/059). A résumé is a document the user edits freely — but its name,
email and phone are the account's, whatever the Builder, an upload, a
tailoring run or a request sent by hand says. So one account can't make
résumés for other people.

Applied wherever a résumé is stored (create, update, generate, the uploads)
and wherever one is rendered (PDF, Studio HTML, ATS check) — the render
covers rows stored before this and unsaved previews.

A profile with no name yet (made before names were asked for) leaves the
résumé's name as it is; likewise a profile with no phone. The email is the
sign-in email always.

Also here: whether an uploaded résumé looks like someone else's — printed
under another name, or sharing no employer or school with the profile. A
hint for a warning, never a refusal: a name can be written many ways and a
career can change completely.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

LOCKED_FIELDS = ("name", "email", "phone")


@dataclass(frozen=True)
class Account:
    """The account's details. None leaves the résumé's own value."""

    email: str | None = None
    name: str | None = None
    phone: str | None = None
    companies: tuple[str, ...] = field(default=())
    schools: tuple[str, ...] = field(default=())


def _clean(value: object) -> str | None:
    return value.strip() or None if isinstance(value, str) else None


def _names(items: object, key: str) -> tuple[str, ...]:
    if not isinstance(items, list):
        return ()
    out = []
    for item in items:
        value = _clean(item.get(key)) if isinstance(item, dict) else None
        if value:
            out.append(value)
    return tuple(out)


async def load(db: AsyncSession, user: dict) -> Account:
    """The signed-in account's details: email from the sign-in, the rest
    from the career profile."""
    row = (
        await db.execute(
            text("SELECT contact, experience, education FROM career_profiles WHERE user_id = :uid"),
            {"uid": str(user["sub"])},
        )
    ).first()
    email = _clean(user.get("email"))
    if row is None:
        return Account(email=email)
    contact, experience, education = row
    contact = contact if isinstance(contact, dict) else {}
    return Account(
        email=email,
        name=_clean(contact.get("name")),
        phone=_clean(contact.get("phone")),
        companies=_names(experience, "company"),
        schools=_names(education, "institution"),
    )


def onto(content: object, account: Account) -> object:
    """content with the account's name, email and phone in its contact."""
    if not isinstance(content, dict):
        return content
    contact = content.get("contact")
    contact = dict(contact) if isinstance(contact, dict) else {}
    changed = False
    for key in LOCKED_FIELDS:
        value = getattr(account, key)
        if value is not None and contact.get(key) != value:
            contact[key] = value
            changed = True
    if not changed:
        return content
    return {**content, "contact": contact}


# ── Someone else's résumé? ──────────────────────────────────────────────────

def _words(value: str) -> list[str]:
    folded = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().lower()
    return re.findall(r"[a-z]+", folded)


def same_person_name(a: str | None, b: str | None) -> bool:
    """Whether two printed names can be one person's: the shorter name's
    words all appear in the longer, an initial standing for any word with
    that first letter. "J. Smith" is "Jane Smith"; "Smith Jane" is too."""
    wa, wb = _words(a or ""), _words(b or "")
    if not wa or not wb:
        return True
    short, long_ = (wa, wb) if len(wa) <= len(wb) else (wb, wa)
    full = set(long_)
    initials = {w[0] for w in long_}
    return all((w in full) if len(w) > 1 else (w in initials) for w in short)


_ORG_NOISE = {
    "pvt", "private", "ltd", "limited", "inc", "llc", "llp", "corp", "corporation",
    "co", "company", "plc", "gmbh", "the", "of", "and", "technologies", "technology",
    "solutions", "services", "india", "group",
}


def _org_key(name: str) -> str:
    return " ".join(w for w in _words(name) if w not in _ORG_NOISE)


def _shares_org(a: tuple[str, ...], b: tuple[str, ...]) -> bool:
    keys_a = {k for k in map(_org_key, a) if k}
    keys_b = {k for k in map(_org_key, b) if k}
    return any(x == y or x in y or y in x for x in keys_a for y in keys_b)


@dataclass(frozen=True)
class OtherPerson:
    """Why an upload looks like someone else's résumé."""

    reason: str  # "name" or "history"
    printed_name: str | None


def looks_like_someone_else(content: object, account: Account) -> OtherPerson | None:
    """Judged on the upload as read, before onto() replaces its name."""
    if not isinstance(content, dict):
        return None
    contact = content.get("contact") if isinstance(content.get("contact"), dict) else {}
    printed = _clean(contact.get("name"))
    if printed and account.name and not same_person_name(printed, account.name):
        return OtherPerson("name", printed)
    mine = account.companies + account.schools
    theirs = _names(content.get("experience"), "company") + _names(content.get("education"), "institution")
    if mine and theirs and not _shares_org(mine, theirs):
        return OtherPerson("history", printed)
    return None

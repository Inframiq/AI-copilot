"""The free credit grant is once per email address, not once per account.

Deleting an account and signing up again with the same address used to grant
the free credits again: delete, re-register, 50 more, repeat. On deletion we
now record the free credits that were left, against a keyed one-way
fingerprint of the address. A new account with that address starts with that
balance (0 if it was used up) instead of a fresh grant.

The address itself is never kept. The fingerprint is an HMAC-SHA256 of the
normalised address under a server secret: it can confirm "this address was
here before", but cannot be turned back into the address, or recomputed by
anyone without the secret. Records are dropped 12 months after the deletion.
This is the "credit-limit circumvention" fraud-prevention use the Privacy
Policy names, and the data-deletion page lists it under what we keep.
"""
from __future__ import annotations

import hashlib
import hmac
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings

RETENTION = timedelta(days=365)

# Providers where dots in the local part are ignored, so "j.doe" and "jdoe"
# are one mailbox.
_DOTLESS_DOMAINS = {"gmail.com", "googlemail.com"}


def normalize_email(email: str) -> str:
    """One mailbox, one form: lowercased, any "+tag" removed, and for Gmail
    the dots dropped and googlemail.com folded into gmail.com. Otherwise
    "+x" or a dot would get a second free grant for the same inbox."""
    email = (email or "").strip().lower()
    local, _, domain = email.partition("@")
    if not domain:
        return email
    local = local.split("+", 1)[0]
    if domain in _DOTLESS_DOMAINS:
        local = local.replace(".", "")
        domain = "gmail.com"
    return f"{local}@{domain}"


def email_fingerprint(email: str) -> str:
    """Keyed one-way fingerprint of the normalised address."""
    key = ("kripax-free-grant:v1:" + settings.supabase_jwt_secret).encode()
    return hmac.new(key, normalize_email(email).encode(), hashlib.sha256).hexdigest()


async def record_deleted_account(db: AsyncSession, email: str | None, free_credits_left: int) -> None:
    """Remember the free credits a deleted account had left. Called inside
    the deletion's transaction. If the address was deleted before, the lower
    balance is kept, so deleting twice never restores anything."""
    if not email:
        return
    fp = email_fingerprint(email)
    left = max(0, int(free_credits_left))
    now = datetime.now(timezone.utc)
    from app.db.models import FreeGrantLedger

    stmt = pg_insert(FreeGrantLedger).values(email_fingerprint=fp, credits_remaining=left, deleted_at=now)
    stmt = stmt.on_conflict_do_update(
        index_elements=[FreeGrantLedger.email_fingerprint],
        set_={
            "credits_remaining": _least(FreeGrantLedger.credits_remaining, stmt.excluded.credits_remaining),
            "deleted_at": now,
        },
    )
    await db.execute(stmt)


def _least(a, b):
    from sqlalchemy import func

    return func.least(a, b)


async def free_grant_for(db: AsyncSession, email: str | None, full_grant: int) -> int:
    """The free credits a NEW account with *email* starts with: the full
    grant, or what its address had left when an earlier account was deleted
    (within the retention window)."""
    if not email:
        return full_grant
    from app.db.models import FreeGrantLedger

    cutoff = datetime.now(timezone.utc) - RETENTION
    # Expired records go as soon as anyone looks: nothing is kept past a year.
    await db.execute(delete(FreeGrantLedger).where(FreeGrantLedger.deleted_at < cutoff))
    left = (
        await db.execute(
            select(FreeGrantLedger.credits_remaining).where(
                FreeGrantLedger.email_fingerprint == email_fingerprint(email)
            )
        )
    ).scalar_one_or_none()
    return full_grant if left is None else min(full_grant, left)

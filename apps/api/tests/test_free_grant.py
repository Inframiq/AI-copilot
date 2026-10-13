"""The free credits are granted once per email address, not once per account:
deleting an account and signing up again resumes what was left."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app.core.credits import PLAN_CREDITS, resolve_subscription
from app.core.free_grant import email_fingerprint, normalize_email, record_deleted_account
from app.db.models import FreeGrantLedger


def test_one_mailbox_has_one_form():
    assert normalize_email(" J.o.h.n+jobs@GoogleMail.com ") == "john@gmail.com"
    assert normalize_email("john@gmail.com") == "john@gmail.com"
    # Dots matter outside Gmail; "+tags" are dropped everywhere.
    assert normalize_email("a.b+x@outlook.com") == "a.b@outlook.com"


def test_the_fingerprint_is_one_way_and_stable():
    fp = email_fingerprint("jane.doe@gmail.com")
    assert fp == email_fingerprint("JaneDoe+again@gmail.com")
    assert fp != email_fingerprint("jane.doe@outlook.com")
    assert len(fp) == 64 and "jane" not in fp


async def _new_account(Session, email):
    async with Session() as s:
        sub = await resolve_subscription(s, uuid.uuid4(), email)
        await s.commit()
        return sub.credits_remaining


async def _delete_account(Session, email, left):
    async with Session() as s:
        await record_deleted_account(s, email, left)
        await s.commit()


@pytest.mark.asyncio
async def test_a_new_address_gets_the_full_free_grant(pg_session):
    assert await _new_account(pg_session, "new@example.com") == PLAN_CREDITS["free"]


@pytest.mark.asyncio
async def test_re_registering_after_deleting_resumes_the_balance_not_a_fresh_grant(pg_session):
    await _delete_account(pg_session, "jane.doe@gmail.com", 0)
    assert await _new_account(pg_session, "jane.doe@gmail.com") == 0
    # The same inbox written differently is still the same address.
    assert await _new_account(pg_session, "JaneDoe+2@googlemail.com") == 0
    # A different address is unaffected.
    assert await _new_account(pg_session, "someone.else@gmail.com") == PLAN_CREDITS["free"]


@pytest.mark.asyncio
async def test_a_partly_used_grant_comes_back_as_it_was(pg_session):
    await _delete_account(pg_session, "sam@example.com", 20)
    assert await _new_account(pg_session, "sam@example.com") == 20


@pytest.mark.asyncio
async def test_deleting_twice_never_restores_credits(pg_session):
    await _delete_account(pg_session, "sam@example.com", 5)
    await _delete_account(pg_session, "sam@example.com", 30)
    assert await _new_account(pg_session, "sam@example.com") == 5


@pytest.mark.asyncio
async def test_records_are_dropped_after_a_year(pg_session):
    await _delete_account(pg_session, "old@example.com", 0)
    async with pg_session() as s:
        await s.execute(update(FreeGrantLedger).values(
            deleted_at=datetime.now(timezone.utc) - timedelta(days=366)))
        await s.commit()
    assert await _new_account(pg_session, "old@example.com") == PLAN_CREDITS["free"]
    async with pg_session() as s:
        assert (await s.execute(select(FreeGrantLedger))).scalars().all() == []


@pytest.mark.asyncio
async def test_the_email_itself_is_never_stored(pg_session):
    await _delete_account(pg_session, "private.person@gmail.com", 0)
    async with pg_session() as s:
        row = (await s.execute(select(FreeGrantLedger))).scalar_one()
    assert "private" not in row.email_fingerprint and "@" not in row.email_fingerprint

"""Credits under real concurrency, against a real Postgres.

The rest of the credit tests mock the database, which can't show a race.
These start a throwaway local PostgreSQL (pgserver, a dev-only dependency)
and fire simultaneous requests at the real credit functions. A barrier
holds every request until all of them have read the balance, so the
worst interleaving happens every run, not by luck.

Skipped where pgserver isn't installed.
"""
import asyncio
import uuid
from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.core import credits
from app.db.models import Subscription, utcnow

@pytest.fixture
def Session(pg_session):
    return pg_session


async def _seed(Session, user_id, *, remaining, allotment=50, plan="free", period_end=None, status="active"):
    async with Session() as s:
        s.add(Subscription(
            user_id=user_id, plan=plan, status=status, credits_remaining=remaining,
            credits_allotment=allotment, current_period_start=utcnow(), current_period_end=period_end,
        ))
        await s.commit()


async def _balance(Session, user_id):
    async with Session() as s:
        rows = (await s.execute(select(Subscription).where(Subscription.user_id == user_id))).scalars().all()
        assert len(rows) == 1, f"expected one subscription row, found {len(rows)}"
        return rows[0].credits_remaining


@pytest.fixture
def lockstep(monkeypatch):
    """Make n concurrent callers all finish reading the subscription before
    any of them goes on — the interleaving a race needs."""
    def arm(n):
        barrier = asyncio.Barrier(n)
        original = credits.resolve_subscription

        async def resolve_then_wait(db, user_id, email=None):
            sub = await original(db, user_id, email)
            try:
                await asyncio.wait_for(barrier.wait(), timeout=2)
            except (asyncio.TimeoutError, asyncio.BrokenBarrierError):
                pass  # a caller that never got here (e.g. it was refused early)
            return sub

        monkeypatch.setattr(credits, "resolve_subscription", resolve_then_wait)
    return arm


async def _spend(Session, user_id, action):
    async with Session() as s:
        try:
            await credits.spend_credits(s, user_id, action)
            await s.commit()
            return "ok"
        except HTTPException as e:
            await s.rollback()
            return e.status_code


async def test_simultaneous_spends_cannot_overdraw(Session, lockstep):
    """10 credits, five tailors (10 each) at the same instant: exactly one runs."""
    user = uuid.uuid4()
    await _seed(Session, user, remaining=10)
    lockstep(5)
    results = await asyncio.gather(*[_spend(Session, user, "tailor") for _ in range(5)])
    assert results.count("ok") == 1, results
    assert results.count(402) == 4, results
    assert await _balance(Session, user) == 0


async def test_simultaneous_spends_lose_no_deductions(Session, lockstep):
    """Enough for all of them: every one is charged — none overwrites another."""
    user = uuid.uuid4()
    await _seed(Session, user, remaining=20)
    lockstep(8)
    results = await asyncio.gather(*[_spend(Session, user, "rewrite_bullet") for _ in range(8)])
    assert results == ["ok"] * 8
    assert await _balance(Session, user) == 20 - 8 * credits.CREDIT_COSTS["rewrite_bullet"]


async def test_first_requests_at_once_make_one_subscription(Session, lockstep):
    """A brand-new user's first requests arriving together: one row, all charged."""
    user = uuid.uuid4()
    lockstep(6)
    results = await asyncio.gather(*[_spend(Session, user, "analyze") for _ in range(6)])
    assert results == ["ok"] * 6, results
    assert await _balance(Session, user) == credits.PLAN_CREDITS["free"] - 6 * credits.CREDIT_COSTS["analyze"]


async def test_a_refund_and_a_spend_at_once_both_count(Session, lockstep):
    user = uuid.uuid4()
    await _seed(Session, user, remaining=30)

    async def refund():
        async with Session() as s:
            await credits.refund_credits(s, user, "cover_letter")
            await s.commit()
            return "ok"

    lockstep(2)
    results = await asyncio.gather(_spend(Session, user, "cover_letter"), refund())
    assert results == ["ok", "ok"]
    assert await _balance(Session, user) == 30  # -3 then +3, in either order


async def test_a_refund_never_lifts_the_balance_past_the_allotment(Session):
    user = uuid.uuid4()
    await _seed(Session, user, remaining=49, allotment=50)
    async with Session() as s:
        await credits.refund_credits(s, user, "tailor")
        await s.commit()
    assert await _balance(Session, user) == 50


async def test_a_new_period_and_a_spend_at_once_keep_the_spend(Session, lockstep):
    """A paid plan's period ends; its refill and a spend race. The refill must
    not wipe out the spend (it used to write the full allotment back)."""
    user = uuid.uuid4()
    await _seed(Session, user, remaining=3, allotment=600, plan="premium",
                period_end=utcnow() - timedelta(minutes=1))

    async def just_resolve():
        async with Session() as s:
            await credits.resolve_subscription(s, user)
            await s.commit()
            return "ok"

    lockstep(3)
    results = await asyncio.gather(_spend(Session, user, "tailor"), just_resolve(), just_resolve())
    assert results == ["ok", "ok", "ok"], results
    assert await _balance(Session, user) == 600 - credits.CREDIT_COSTS["tailor"]


async def test_an_inactive_subscription_is_refused(Session):
    user = uuid.uuid4()
    await _seed(Session, user, remaining=50, status="past_due")
    assert await _spend(Session, user, "tailor") == 402
    assert await _balance(Session, user) == 50

"""app.core.credits — subscription resolution, rollover, and credit spend."""
import uuid
from datetime import timedelta

import pytest
from fastapi import HTTPException
from unittest.mock import AsyncMock, MagicMock

from app.core.credits import (
    resolve_subscription, spend_credits, subscription_public,
    CREDIT_COSTS, PLAN_CREDITS, BILLING_PERIOD,
)
from app.db.models import Subscription, utcnow

USER = uuid.uuid4()


def _db(existing_sub=None):
    db = MagicMock()
    res = MagicMock()
    res.scalar_one_or_none.return_value = existing_sub
    db.execute = AsyncMock(return_value=res)
    db.add = MagicMock()
    db.flush = AsyncMock()
    return db


@pytest.mark.asyncio
async def test_resolve_creates_a_free_subscription_on_first_touch():
    db = _db(existing_sub=None)
    sub = await resolve_subscription(db, USER)
    assert sub.plan == "free"
    assert sub.credits_remaining == PLAN_CREDITS["free"] == sub.credits_allotment
    assert sub.current_period_end is None  # one-time grant, never refills
    db.add.assert_called_once_with(sub)


@pytest.mark.asyncio
async def test_resolve_returns_existing_without_recreating():
    existing = Subscription(user_id=USER, plan="premium", status="active",
                            credits_remaining=42, credits_allotment=600,
                            current_period_end=None)
    db = _db(existing_sub=existing)
    sub = await resolve_subscription(db, USER)
    assert sub is existing
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_resolve_refills_a_paid_plan_after_its_period_ends():
    past = utcnow() - timedelta(days=1)
    existing = Subscription(user_id=USER, plan="premium", status="active",
                            credits_remaining=3, credits_allotment=600,
                            current_period_start=past - BILLING_PERIOD,
                            current_period_end=past)
    db = _db(existing_sub=existing)
    sub = await resolve_subscription(db, USER)
    assert sub.credits_remaining == 600
    assert sub.current_period_end > utcnow()


@pytest.mark.asyncio
async def test_resolve_does_not_refill_a_free_plan():
    existing = Subscription(user_id=USER, plan="free", status="active",
                            credits_remaining=0, credits_allotment=50,
                            current_period_end=None)
    db = _db(existing_sub=existing)
    sub = await resolve_subscription(db, USER)
    assert sub.credits_remaining == 0  # stays empty — no monthly reset


@pytest.mark.asyncio
async def test_spend_deducts_the_action_cost():
    existing = Subscription(user_id=USER, plan="free", status="active",
                            credits_remaining=50, credits_allotment=50, current_period_end=None)
    db = _db(existing_sub=existing)
    await spend_credits(db, USER, "tailor")
    assert existing.credits_remaining == 50 - CREDIT_COSTS["tailor"]


@pytest.mark.asyncio
async def test_spend_raises_402_when_balance_too_low():
    existing = Subscription(user_id=USER, plan="free", status="active",
                            credits_remaining=4, credits_allotment=50, current_period_end=None)
    db = _db(existing_sub=existing)
    with pytest.raises(HTTPException) as ei:
        await spend_credits(db, USER, "tailor")
    assert ei.value.status_code == 402
    assert existing.credits_remaining == 4  # unchanged


@pytest.mark.asyncio
async def test_spend_raises_402_when_subscription_not_active():
    existing = Subscription(user_id=USER, plan="premium", status="past_due",
                            credits_remaining=500, credits_allotment=600, current_period_end=None)
    db = _db(existing_sub=existing)
    with pytest.raises(HTTPException) as ei:
        await spend_credits(db, USER, "tailor")
    assert ei.value.status_code == 402


@pytest.mark.asyncio
async def test_spend_is_a_noop_for_unmetered_actions():
    existing = Subscription(user_id=USER, plan="free", status="active",
                            credits_remaining=1, credits_allotment=50, current_period_end=None)
    db = _db(existing_sub=existing)
    await spend_credits(db, USER, "analyze")        # cost 0
    await spend_credits(db, USER, "cover_letter")   # priced but not enforced yet
    assert existing.credits_remaining == 1


def test_subscription_public_shape():
    sub = Subscription(user_id=USER, plan="free", status="active",
                       credits_remaining=30, credits_allotment=50, current_period_end=None)
    out = subscription_public(sub)
    assert out["plan"] == "free" and out["credits_remaining"] == 30
    assert out["renews"] is False and out["current_period_end"] is None
    assert out["costs"]["tailor"] == CREDIT_COSTS["tailor"]

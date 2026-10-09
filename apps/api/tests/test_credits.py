"""app.core.credits — subscription resolution, rollover, and credit spend."""
import uuid
from datetime import timedelta

import pytest
from fastapi import HTTPException
from unittest.mock import AsyncMock, MagicMock

from app.core.credits import (
    resolve_subscription, spend_credits, refund_credits, subscription_public,
    CREDIT_COSTS, PLAN_CREDITS, BILLING_PERIOD,
)
from app.core.config import settings
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
async def test_spend_deducts_for_cover_letter_and_rewrite_bullet():
    existing = Subscription(user_id=USER, plan="free", status="active",
                            credits_remaining=50, credits_allotment=50, current_period_end=None)
    db = _db(existing_sub=existing)
    await spend_credits(db, USER, "cover_letter")
    assert existing.credits_remaining == 50 - CREDIT_COSTS["cover_letter"]
    await spend_credits(db, USER, "rewrite_bullet")
    assert existing.credits_remaining == 50 - CREDIT_COSTS["cover_letter"] - CREDIT_COSTS["rewrite_bullet"]


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
async def test_spend_is_a_noop_for_an_unpriced_action():
    existing = Subscription(user_id=USER, plan="free", status="active",
                            credits_remaining=1, credits_allotment=50, current_period_end=None)
    db = _db(existing_sub=existing)
    await spend_credits(db, USER, "export_pdf")  # no model call, no price
    assert existing.credits_remaining == 1


def test_every_action_that_calls_a_model_is_priced_and_enforced():
    from app.core.credits import CREDIT_COSTS, ENFORCED_ACTIONS
    model_actions = {
        "tailor", "generate_resume", "cover_letter", "prep_questions",
        "rewrite_bullet", "restructure_notes", "analyze", "parse_resume",
    }
    for action in model_actions:
        assert CREDIT_COSTS.get(action, 0) > 0, f"{action} is free"
        assert action in ENFORCED_ACTIONS, f"{action} is not enforced"


@pytest.mark.asyncio
async def test_spend_names_the_action_in_words_when_out_of_credits():
    existing = Subscription(user_id=USER, plan="free", status="active",
                            credits_remaining=1, credits_allotment=50, current_period_end=None)
    with pytest.raises(HTTPException) as ei:
        await spend_credits(_db(existing_sub=existing), USER, "prep_questions")
    assert ei.value.detail == "Out of credits: Interview questions costs 2 credits and you have 1."


@pytest.mark.asyncio
async def test_require_checks_without_deducting_and_charge_deducts():
    from app.core.credits import require_credits, charge_credits
    existing = Subscription(user_id=USER, plan="free", status="active",
                            credits_remaining=5, credits_allotment=50, current_period_end=None)
    await require_credits(_db(existing_sub=existing), USER, "analyze")
    assert existing.credits_remaining == 5
    await charge_credits(_db(existing_sub=existing), USER, "analyze")
    assert existing.credits_remaining == 4


@pytest.mark.asyncio
async def test_require_refuses_when_the_balance_cannot_cover_it():
    from app.core.credits import require_credits
    existing = Subscription(user_id=USER, plan="free", status="active",
                            credits_remaining=1, credits_allotment=50, current_period_end=None)
    with pytest.raises(HTTPException) as ei:
        await require_credits(_db(existing_sub=existing), USER, "prep_questions")
    assert ei.value.status_code == 402


@pytest.mark.asyncio
async def test_charge_never_takes_the_balance_below_zero():
    from app.core.credits import charge_credits
    existing = Subscription(user_id=USER, plan="free", status="active",
                            credits_remaining=1, credits_allotment=50, current_period_end=None)
    await charge_credits(_db(existing_sub=existing), USER, "prep_questions")
    assert existing.credits_remaining == 0


@pytest.mark.asyncio
async def test_spend_is_a_noop_for_unlimited_credit_email(monkeypatch):
    monkeypatch.setattr(settings, "unlimited_credit_emails", "qa@example.com, Other@Example.com")
    existing = Subscription(user_id=USER, plan="free", status="active",
                            credits_remaining=0, credits_allotment=50, current_period_end=None)
    db = _db(existing_sub=existing)
    # Would otherwise 402 — email match (case-insensitive) bypasses metering entirely.
    await spend_credits(db, USER, "tailor", email="QA@example.com")
    assert existing.credits_remaining == 0  # unchanged, no deduction


@pytest.mark.asyncio
async def test_spend_still_enforced_for_email_not_on_the_allowlist(monkeypatch):
    monkeypatch.setattr(settings, "unlimited_credit_emails", "qa@example.com")
    existing = Subscription(user_id=USER, plan="free", status="active",
                            credits_remaining=4, credits_allotment=50, current_period_end=None)
    db = _db(existing_sub=existing)
    with pytest.raises(HTTPException) as ei:
        await spend_credits(db, USER, "tailor", email="someone-else@example.com")
    assert ei.value.status_code == 402


@pytest.mark.asyncio
async def test_refund_is_a_noop_for_unlimited_credit_email(monkeypatch):
    monkeypatch.setattr(settings, "unlimited_credit_emails", "qa@example.com")
    existing = Subscription(user_id=USER, plan="premium", status="active",
                            credits_remaining=590, credits_allotment=600, current_period_end=None)
    db = _db(existing_sub=existing)
    await refund_credits(db, USER, "tailor", email="qa@example.com")
    assert existing.credits_remaining == 590  # nothing was ever deducted, so nothing to add back


@pytest.mark.asyncio
async def test_refund_caps_at_allotment():
    existing = Subscription(user_id=USER, plan="premium", status="active",
                            credits_remaining=595, credits_allotment=600, current_period_end=None)
    db = _db(existing_sub=existing)
    await refund_credits(db, USER, "tailor")  # tailor costs 10 — would overshoot to 605
    assert existing.credits_remaining == 600


def test_subscription_public_shape():
    sub = Subscription(user_id=USER, plan="free", status="active",
                       credits_remaining=30, credits_allotment=50, current_period_end=None)
    out = subscription_public(sub)
    assert out["plan"] == "free" and out["credits_remaining"] == 30
    assert out["renews"] is False and out["current_period_end"] is None
    assert out["costs"]["tailor"] == CREDIT_COSTS["tailor"]

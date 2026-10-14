"""app.core.credits — subscription resolution, rollover, spend and refund.

Run against a real Postgres (the `pg_session` fixture in conftest.py), since
the credit functions are single atomic SQL statements: a mocked database
would only test the mock. Races are in test_credits_concurrency.py.
"""
import uuid
from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.core.credits import (
    resolve_subscription, spend_credits, refund_credits, subscription_public,
    CREDIT_COSTS, PLAN_CREDITS, BILLING_PERIOD,
)
from app.core.config import settings
from app.db.models import Subscription, utcnow


async def _seed(Session, **fields):
    user = uuid.uuid4()
    row = dict(plan="free", status="active", credits_remaining=50, credits_allotment=50,
               current_period_start=utcnow(), current_period_end=None)
    row.update(fields)
    async with Session() as s:
        s.add(Subscription(user_id=user, **row))
        await s.commit()
    return user


async def _row(Session, user):
    async with Session() as s:
        rows = (await s.execute(select(Subscription).where(Subscription.user_id == user))).scalars().all()
        assert len(rows) == 1
        return rows[0]


async def _spend(Session, user, action, email=None):
    async with Session() as s:
        await spend_credits(s, user, action, email=email)
        await s.commit()


async def test_resolve_creates_a_free_subscription_on_first_touch(pg_session):
    user = uuid.uuid4()
    async with pg_session() as s:
        sub = await resolve_subscription(s, user)
        await s.commit()
    assert sub.plan == "free"
    assert sub.credits_remaining == PLAN_CREDITS["free"] == sub.credits_allotment
    assert sub.current_period_end is None  # one-time grant, never refills
    assert (await _row(pg_session, user)).credits_remaining == PLAN_CREDITS["free"]


async def test_resolve_returns_existing_without_recreating(pg_session):
    user = await _seed(pg_session, plan="premium", credits_remaining=42, credits_allotment=600)
    async with pg_session() as s:
        sub = await resolve_subscription(s, user)
        await s.commit()
    assert sub.plan == "premium" and sub.credits_remaining == 42
    await _row(pg_session, user)  # still exactly one row


async def test_resolve_refills_a_paid_plan_after_its_period_ends(pg_session):
    past = utcnow() - timedelta(days=1)
    user = await _seed(pg_session, plan="premium", credits_remaining=3, credits_allotment=600,
                       current_period_start=past - BILLING_PERIOD, current_period_end=past)
    async with pg_session() as s:
        sub = await resolve_subscription(s, user)
        await s.commit()
    assert sub.credits_remaining == 600
    assert sub.current_period_end > utcnow()
    assert sub.current_period_start == past  # the new period starts where the old one ended


async def test_resolve_skips_every_missed_period(pg_session):
    long_ago = utcnow() - BILLING_PERIOD * 3 - timedelta(days=1)
    user = await _seed(pg_session, plan="premium", credits_remaining=0, credits_allotment=600,
                       current_period_start=long_ago - BILLING_PERIOD, current_period_end=long_ago)
    async with pg_session() as s:
        sub = await resolve_subscription(s, user)
        await s.commit()
    assert sub.current_period_start <= utcnow() < sub.current_period_end
    assert sub.credits_remaining == 600


async def test_resolve_does_not_refill_a_free_plan(pg_session):
    user = await _seed(pg_session, credits_remaining=0)
    async with pg_session() as s:
        sub = await resolve_subscription(s, user)
    assert sub.credits_remaining == 0  # stays empty — no monthly reset


async def test_spend_deducts_the_action_cost(pg_session):
    user = await _seed(pg_session)
    await _spend(pg_session, user, "tailor")
    assert (await _row(pg_session, user)).credits_remaining == 50 - CREDIT_COSTS["tailor"]


async def test_spend_returns_the_balance_after_the_deduction(pg_session):
    user = await _seed(pg_session)
    async with pg_session() as s:
        sub = await spend_credits(s, user, "cover_letter")
        await s.commit()
    assert sub.credits_remaining == 50 - CREDIT_COSTS["cover_letter"]


async def test_spend_deducts_for_cover_letter_and_rewrite_bullet(pg_session):
    user = await _seed(pg_session)
    await _spend(pg_session, user, "cover_letter")
    await _spend(pg_session, user, "rewrite_bullet")
    expected = 50 - CREDIT_COSTS["cover_letter"] - CREDIT_COSTS["rewrite_bullet"]
    assert (await _row(pg_session, user)).credits_remaining == expected


async def test_spend_can_use_the_last_credits_exactly(pg_session):
    user = await _seed(pg_session, credits_remaining=CREDIT_COSTS["tailor"])
    await _spend(pg_session, user, "tailor")
    assert (await _row(pg_session, user)).credits_remaining == 0


async def test_spend_raises_402_when_balance_too_low(pg_session):
    user = await _seed(pg_session, credits_remaining=4)
    with pytest.raises(HTTPException) as ei:
        await _spend(pg_session, user, "tailor")
    assert ei.value.status_code == 402
    assert (await _row(pg_session, user)).credits_remaining == 4  # unchanged


async def test_spend_raises_402_when_subscription_not_active(pg_session):
    user = await _seed(pg_session, plan="premium", status="past_due", credits_remaining=500, credits_allotment=600)
    with pytest.raises(HTTPException) as ei:
        await _spend(pg_session, user, "tailor")
    assert ei.value.status_code == 402
    assert ei.value.detail == "Your subscription is not active."
    assert (await _row(pg_session, user)).credits_remaining == 500


async def test_spend_is_a_noop_for_an_unpriced_action(pg_session):
    user = await _seed(pg_session, credits_remaining=1)
    await _spend(pg_session, user, "export_pdf")  # no model call, no price
    assert (await _row(pg_session, user)).credits_remaining == 1


async def test_spend_creates_the_subscription_for_a_new_user(pg_session):
    user = uuid.uuid4()
    await _spend(pg_session, user, "analyze")
    assert (await _row(pg_session, user)).credits_remaining == PLAN_CREDITS["free"] - CREDIT_COSTS["analyze"]


def test_every_action_that_calls_a_model_is_priced_and_enforced():
    from app.core.credits import ENFORCED_ACTIONS
    model_actions = {
        "tailor", "generate_resume", "cover_letter", "prep_questions",
        "rewrite_bullet", "restructure_notes", "analyze", "parse_resume",
    }
    for action in model_actions:
        assert CREDIT_COSTS.get(action, 0) > 0, f"{action} is free"
        assert action in ENFORCED_ACTIONS, f"{action} is not enforced"


async def test_spend_names_the_action_in_words_when_out_of_credits(pg_session):
    user = await _seed(pg_session, credits_remaining=1)
    with pytest.raises(HTTPException) as ei:
        await _spend(pg_session, user, "prep_questions")
    assert ei.value.detail == "Out of credits: Interview questions costs 3 credits and you have 1."


async def test_spend_is_a_noop_for_unlimited_credit_email(pg_session, monkeypatch):
    monkeypatch.setattr(settings, "unlimited_credit_emails", "qa@example.com, Other@Example.com")
    user = await _seed(pg_session, credits_remaining=0)
    # Would otherwise 402 — email match (case-insensitive) bypasses metering entirely.
    await _spend(pg_session, user, "tailor", email="QA@example.com")
    assert (await _row(pg_session, user)).credits_remaining == 0


async def test_spend_still_enforced_for_email_not_on_the_allowlist(pg_session, monkeypatch):
    monkeypatch.setattr(settings, "unlimited_credit_emails", "qa@example.com")
    user = await _seed(pg_session, credits_remaining=4)
    with pytest.raises(HTTPException) as ei:
        await _spend(pg_session, user, "tailor", email="someone-else@example.com")
    assert ei.value.status_code == 402


async def test_refund_gives_the_cost_back(pg_session):
    user = await _seed(pg_session, credits_remaining=20)
    async with pg_session() as s:
        await refund_credits(s, user, "cover_letter")
        await s.commit()
    assert (await _row(pg_session, user)).credits_remaining == 20 + CREDIT_COSTS["cover_letter"]


async def test_refund_is_a_noop_for_unlimited_credit_email(pg_session, monkeypatch):
    monkeypatch.setattr(settings, "unlimited_credit_emails", "qa@example.com")
    user = await _seed(pg_session, plan="premium", credits_remaining=590, credits_allotment=600)
    async with pg_session() as s:
        await refund_credits(s, user, "tailor", email="qa@example.com")
        await s.commit()
    # Nothing was ever deducted, so nothing to add back.
    assert (await _row(pg_session, user)).credits_remaining == 590


async def test_refund_caps_at_allotment(pg_session):
    user = await _seed(pg_session, plan="premium", credits_remaining=595, credits_allotment=600)
    async with pg_session() as s:
        await refund_credits(s, user, "tailor")  # tailor costs 10 — would overshoot to 605
        await s.commit()
    assert (await _row(pg_session, user)).credits_remaining == 600


def test_subscription_public_shape():
    sub = Subscription(user_id=uuid.uuid4(), plan="free", status="active",
                       credits_remaining=30, credits_allotment=50, current_period_end=None)
    out = subscription_public(sub)
    assert out["plan"] == "free" and out["credits_remaining"] == 30
    assert out["renews"] is False and out["current_period_end"] is None
    assert out["costs"]["tailor"] == CREDIT_COSTS["tailor"]

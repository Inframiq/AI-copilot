"""Per-user credit balance — the cost cap behind a paid plan.

`spend_credits(db, user_id, action)` runs at the top of every metered
endpoint. It resolves (and lazily creates) the user's `subscriptions` row,
rolls a paid plan's credits over when its cycle has ended, then deducts the
action's cost or raises HTTP 402.
"""
import logging
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Subscription, utcnow

logger = logging.getLogger("app")

# Credits charged per user-initiated action. 0 = not metered.
# Sized so the priciest realistic run still clears margin: ~$0.028 per
# blended tailor (see docs/ai-pipeline.md) -> a $5 / 600-credit plan =
# 60 tailors for ~$1.7 of AI cost.
CREDIT_COSTS: dict[str, int] = {
    "tailor": 10,
    "cover_letter": 3,
    "rewrite_bullet": 1,
    "analyze": 0,
    "prep_questions": 0,
}

# Starting balance per plan. "free" is a ONE-TIME grant (current_period_end
# stays NULL -> never refills). "premium" refills every 30 days once billing
# sets current_period_end.
PLAN_CREDITS: dict[str, int] = {"free": 50, "premium": 600}

# Static catalog served by GET /plans and rendered by the pricing UI.
# Credit amounts come from PLAN_CREDITS above so there's one number to change.
PLANS: list[dict] = [
    {
        "id": "free",
        "name": "Free",
        "price_usd": 0,
        "period": None,
        "credits": PLAN_CREDITS["free"],
        "refills": False,
        "features": [
            "50 credits, one-time",
            "About 5 resume tailors",
            "Cover letters and bullet rewrites",
            "Free JD analysis",
        ],
    },
    {
        "id": "premium",
        "name": "Premium",
        "price_usd": 5,
        "period": "month",
        "credits": PLAN_CREDITS["premium"],
        "refills": True,
        "features": [
            "600 credits every month",
            "About 60 resume tailors",
            "Everything in Free",
            "Priority support",
        ],
    },
]

BILLING_PERIOD = timedelta(days=30)

# Actions currently enforced. Others have a cost defined above for the
# future but aren't gated yet (one-line change to add them).
ENFORCED_ACTIONS = {"tailor"}


async def resolve_subscription(db: AsyncSession, user_id) -> Subscription:
    """Return the user's subscription, creating a default free row on first
    touch and rolling a paid plan's credits over if its period has elapsed."""
    sub = (
        await db.execute(select(Subscription).where(Subscription.user_id == user_id))
    ).scalar_one_or_none()

    if sub is None:
        sub = Subscription(
            user_id=user_id,
            plan="free",
            status="active",
            credits_remaining=PLAN_CREDITS["free"],
            credits_allotment=PLAN_CREDITS["free"],
            current_period_start=utcnow(),
            current_period_end=None,
        )
        db.add(sub)
        await db.flush()
        return sub

    if sub.current_period_end is not None:
        now = utcnow()
        if now >= sub.current_period_end:
            while sub.current_period_end <= now:
                sub.current_period_start = sub.current_period_end
                sub.current_period_end = sub.current_period_end + BILLING_PERIOD
            sub.credits_remaining = sub.credits_allotment
            await db.flush()
    return sub


async def spend_credits(db: AsyncSession, user_id, action: str) -> Subscription:
    """Deduct `action`'s cost from the user's balance, or raise 402.

    No deduction for un-metered actions (cost 0) or actions not in
    ENFORCED_ACTIONS — but the subscription row is still resolved/created so
    a first metered call always has a balance to read. Not
    `SELECT ... FOR UPDATE`: the endpoints are rate-limited and the UI
    disables the trigger while a call is in flight, so a double-spend race
    is negligible at this scale.
    """
    sub = await resolve_subscription(db, user_id)
    cost = CREDIT_COSTS.get(action, 0)
    if cost <= 0 or action not in ENFORCED_ACTIONS:
        return sub

    if sub.status != "active":
        raise HTTPException(status_code=402, detail="Your subscription is not active.")
    if sub.credits_remaining < cost:
        raise HTTPException(
            status_code=402,
            detail=(
                f"Out of credits: {action} costs {cost} and you have "
                f"{sub.credits_remaining}."
            ),
        )
    sub.credits_remaining -= cost
    await db.flush()
    return sub


async def refund_credits(db: AsyncSession, user_id, action: str) -> None:
    """Credit back `action`'s cost after spend_credits already charged it up
    front but the work it paid for failed server-side afterward (e.g. the
    tailoring background job erroring out after the request already
    returned 202). Capped at credits_allotment so repeated refunds can't
    drift a balance above the plan's actual grant."""
    cost = CREDIT_COSTS.get(action, 0)
    if cost <= 0 or action not in ENFORCED_ACTIONS:
        return
    sub = await resolve_subscription(db, user_id)
    sub.credits_remaining = min(sub.credits_remaining + cost, sub.credits_allotment)
    await db.flush()


def subscription_public(sub: Subscription) -> dict:
    """Shape returned by GET /me/subscription."""
    return {
        "plan": sub.plan,
        "status": sub.status,
        "credits_remaining": sub.credits_remaining,
        "credits_allotment": sub.credits_allotment,
        "current_period_end": (
            sub.current_period_end.isoformat() if sub.current_period_end else None
        ),
        "renews": sub.current_period_end is not None,
        "costs": CREDIT_COSTS,
    }

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

from app.core.config import settings
from app.db.models import Subscription, utcnow

logger = logging.getLogger("app")


def _is_unlimited_credit_email(email: str | None) -> bool:
    """True for QA/test accounts named in UNLIMITED_CREDIT_EMAILS — exempt
    from all credit metering so they never hit a 402 or spend a balance."""
    if not email:
        return False
    allowlist = {e.strip().lower() for e in settings.unlimited_credit_emails.split(",") if e.strip()}
    return email.strip().lower() in allowlist

# Credits charged per user-initiated action — every action that calls a
# model is metered (2026-10-09). Sized so the priciest realistic run still
# clears margin: ~$0.028 per blended tailor (see docs/ai-pipeline.md) -> a
# $5 / 600-credit plan = 60 tailors for ~$1.7 of AI cost.
CREDIT_COSTS: dict[str, int] = {
    "tailor": 10,
    # Three model calls: relevance filter, writer, compressor.
    "generate_resume": 3,
    "cover_letter": 3,
    # One pro-tier call writing ~10-15 questions with answer frameworks.
    "prep_questions": 2,
    "rewrite_bullet": 1,
    # The notes canvas: one fast call that tidies what the user typed into
    # points for the profile's Miscellaneous section.
    "restructure_notes": 1,
    # Charged only when a model actually runs — a repeat analysis of the
    # same JD and résumé is served from cache, and pages re-run it on view.
    "analyze": 1,
    # Reading an uploaded PDF into résumé fields.
    "parse_resume": 1,
}

# What each action is called in an out-of-credits message.
ACTION_LABELS: dict[str, str] = {
    "tailor": "Tailoring a résumé",
    "generate_resume": "Generating a résumé",
    "cover_letter": "A cover letter",
    "prep_questions": "Interview questions",
    "rewrite_bullet": "A rewrite",
    "restructure_notes": "Tidying your notes",
    "analyze": "Analyzing a job description",
    "parse_resume": "Reading an uploaded résumé",
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
            "Cover letters, interview prep and rewrites",
            "JD analysis from 1 credit",
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

# Every priced action is enforced: anything that calls a model is metered.
ENFORCED_ACTIONS = set(CREDIT_COSTS)


def _out_of_credits(action: str, cost: int, remaining: int) -> HTTPException:
    label = ACTION_LABELS.get(action, action)
    unit = "credit" if cost == 1 else "credits"
    return HTTPException(
        status_code=402,
        detail=f"Out of credits: {label} costs {cost} {unit} and you have {remaining}.",
    )


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


async def spend_credits(db: AsyncSession, user_id, action: str, email: str | None = None) -> Subscription:
    """Deduct `action`'s cost from the user's balance, or raise 402.

    No deduction for un-metered actions (cost 0), actions not in
    ENFORCED_ACTIONS, or an email on the UNLIMITED_CREDIT_EMAILS allowlist
    (QA/test accounts) — but the subscription row is still resolved/created
    so a first metered call always has a balance to read. Not
    `SELECT ... FOR UPDATE`: the endpoints are rate-limited and the UI
    disables the trigger while a call is in flight, so a double-spend race
    is negligible at this scale.
    """
    sub = await resolve_subscription(db, user_id)
    cost = CREDIT_COSTS.get(action, 0)
    if cost <= 0 or action not in ENFORCED_ACTIONS or _is_unlimited_credit_email(email):
        return sub

    if sub.status != "active":
        raise HTTPException(status_code=402, detail="Your subscription is not active.")
    if sub.credits_remaining < cost:
        raise _out_of_credits(action, cost, sub.credits_remaining)
    sub.credits_remaining -= cost
    await db.flush()
    return sub


async def require_credits(db: AsyncSession, user_id, action: str, email: str | None = None) -> None:
    """Raise 402 unless the balance covers `action` — without deducting.

    For actions that may be served without a model call (a cached analysis,
    questions that already exist): check up front so nothing runs that can't
    be paid for, then `charge_credits` only once a model actually ran."""
    sub = await resolve_subscription(db, user_id)
    cost = CREDIT_COSTS.get(action, 0)
    if cost <= 0 or action not in ENFORCED_ACTIONS or _is_unlimited_credit_email(email):
        return
    if sub.status != "active":
        raise HTTPException(status_code=402, detail="Your subscription is not active.")
    if sub.credits_remaining < cost:
        raise _out_of_credits(action, cost, sub.credits_remaining)


async def charge_credits(db: AsyncSession, user_id, action: str, email: str | None = None) -> None:
    """Deduct `action`'s cost after its model call ran (see require_credits).
    Never below zero: the balance was checked first, and a concurrent spend
    in between must not leave it negative."""
    cost = CREDIT_COSTS.get(action, 0)
    if cost <= 0 or action not in ENFORCED_ACTIONS or _is_unlimited_credit_email(email):
        return
    sub = await resolve_subscription(db, user_id)
    sub.credits_remaining = max(0, sub.credits_remaining - cost)
    await db.flush()


async def refund_credits(db: AsyncSession, user_id, action: str, email: str | None = None) -> None:
    """Credit back `action`'s cost after spend_credits already charged it up
    front but the work it paid for failed server-side afterward (e.g. the
    tailoring background job erroring out after the request already
    returned 202). Capped at credits_allotment so repeated refunds can't
    drift a balance above the plan's actual grant. No-op for an
    UNLIMITED_CREDIT_EMAILS account — spend_credits never deducted anything
    for it, so there's nothing to give back."""
    cost = CREDIT_COSTS.get(action, 0)
    if cost <= 0 or action not in ENFORCED_ACTIONS or _is_unlimited_credit_email(email):
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

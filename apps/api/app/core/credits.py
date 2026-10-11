"""Per-user credit balance — the cost cap behind a paid plan.

`spend_credits(db, user_id, action)` runs before every model call. It
resolves (and lazily creates) the user's `subscriptions` row, rolls a paid
plan's credits over when its cycle has ended, then deducts the action's
cost or raises HTTP 402. Work that may turn out free (a cached analysis,
questions that already exist) spends first and `refund_credits` if no
model ran.

Safe under concurrency — two tabs, a double tap, a script firing requests
at once. Every change to the balance is one atomic UPDATE, never a read
then a write: a spend is `... SET credits = credits - cost WHERE credits >=
cost`, so Postgres itself refuses an overdraw however requests interleave.
The first-touch insert and the period refill are conditional the same way.
tests/test_credits_concurrency.py proves this against a real Postgres.
"""
import logging
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
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


async def _load(db: AsyncSession, user_id) -> Subscription | None:
    """The row as it is in the database now — never a stale copy from this
    session's identity map."""
    return (
        await db.execute(
            select(Subscription)
            .where(Subscription.user_id == user_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def resolve_subscription(db: AsyncSession, user_id) -> Subscription:
    """Return the user's subscription, creating a default free row on first
    touch and rolling a paid plan's credits over if its period has elapsed.

    The first-touch insert is ON CONFLICT DO NOTHING, so a new user's first
    requests arriving together make one row (it used to be two inserts and a
    crash). The refill applies only if the period it ends is still the
    current one, so a second refill — or a spend in between — is never
    overwritten with the full allotment again."""
    sub = await _load(db, user_id)
    if sub is None:
        now = utcnow()
        await db.execute(
            pg_insert(Subscription)
            .values(
                user_id=user_id,
                plan="free",
                status="active",
                credits_remaining=PLAN_CREDITS["free"],
                credits_allotment=PLAN_CREDITS["free"],
                current_period_start=now,
                current_period_end=None,
            )
            .on_conflict_do_nothing(index_elements=[Subscription.user_id])
        )
        return await _load(db, user_id)

    if sub.current_period_end is not None:
        now = utcnow()
        if now >= sub.current_period_end:
            ended = sub.current_period_end
            start_at, end_at = sub.current_period_start, sub.current_period_end
            while end_at <= now:
                start_at, end_at = end_at, end_at + BILLING_PERIOD
            await db.execute(
                update(Subscription)
                .where(Subscription.user_id == user_id, Subscription.current_period_end == ended)
                .values(
                    current_period_start=start_at,
                    current_period_end=end_at,
                    credits_remaining=Subscription.credits_allotment,
                )
                .execution_options(synchronize_session=False)
            )
            sub = await _load(db, user_id)
    return sub


def _exempt(action: str, cost: int, email: str | None) -> bool:
    return cost <= 0 or action not in ENFORCED_ACTIONS or _is_unlimited_credit_email(email)


async def spend_credits(db: AsyncSession, user_id, action: str, email: str | None = None) -> Subscription:
    """Deduct `action`'s cost from the user's balance, or raise 402.

    One conditional UPDATE: it only takes the credits if the subscription is
    active and the balance still covers the cost at that instant, so
    simultaneous requests can't both spend the same credits — the row lock
    makes the second wait, then re-check against the new balance.

    No deduction for un-metered actions (cost 0), actions not in
    ENFORCED_ACTIONS, or an email on the UNLIMITED_CREDIT_EMAILS allowlist
    (QA/test accounts) — but the subscription row is still resolved/created
    so a first metered call always has a balance to read.

    The deduction is part of the caller's transaction: commit it before a
    long model call (and refund_credits if that fails), or the row stays
    locked — and the user's other paid requests wait — until it ends.
    """
    sub = await resolve_subscription(db, user_id)
    cost = CREDIT_COSTS.get(action, 0)
    if _exempt(action, cost, email):
        return sub

    taken = (
        await db.execute(
            update(Subscription)
            .where(
                Subscription.user_id == user_id,
                Subscription.status == "active",
                Subscription.credits_remaining >= cost,
            )
            .values(credits_remaining=Subscription.credits_remaining - cost)
            .returning(Subscription.id)
            .execution_options(synchronize_session=False)
        )
    ).first()
    sub = await _load(db, user_id)
    if taken is None:
        if sub.status != "active":
            raise HTTPException(status_code=402, detail="Your subscription is not active.")
        raise _out_of_credits(action, cost, sub.credits_remaining)
    return sub


async def refund_credits(db: AsyncSession, user_id, action: str, email: str | None = None) -> None:
    """Give back `action`'s cost when spend_credits charged it but nothing was
    delivered — the model call failed, or (for work that may be free) no
    model ran after all. One atomic UPDATE, so it can't erase a spend
    happening at the same moment. Capped at credits_allotment so repeated
    refunds can't drift a balance above the plan's actual grant. No-op for
    an UNLIMITED_CREDIT_EMAILS account — nothing was deducted to give back."""
    cost = CREDIT_COSTS.get(action, 0)
    if _exempt(action, cost, email):
        return
    await db.execute(
        update(Subscription)
        .where(Subscription.user_id == user_id)
        .values(
            credits_remaining=func.least(
                Subscription.credits_remaining + cost, Subscription.credits_allotment
            )
        )
        .execution_options(synchronize_session=False)
    )


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

import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from supabase import create_client
from app.db.session import get_db
from app.db.models import Subscription
from app.core.security import require_admin
from app.core.config import settings
from app.core.credits import PLAN_CREDITS, BILLING_PERIOD, resolve_subscription
from app.db.models import utcnow
from app.schemas.admin import AdminUserOut, PlanUpdateIn

router = APIRouter(prefix="/admin", tags=["admin"])

# Singleton Supabase service-role client — same pattern as routers/me.py.
_sb_client = None


def _supabase():
    global _sb_client
    if _sb_client is None:
        _sb_client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    return _sb_client


def _default_free_fields() -> dict:
    return {
        "plan": "free",
        "status": "active",
        "credits_remaining": PLAN_CREDITS["free"],
        "credits_allotment": PLAN_CREDITS["free"],
        "current_period_end": None,
    }


@router.get("/users", response_model=list[AdminUserOut])
async def list_users(user=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Every Supabase auth user joined with their subscriptions row — users
    who've never hit a metered endpoint have no row yet, so they're shown
    with the free plan's defaults without creating one."""
    auth_users = []
    page = 1
    while True:
        batch = _supabase().auth.admin.list_users(page=page, per_page=200)
        if not batch:
            break
        auth_users.extend(batch)
        if len(batch) < 200:
            break
        page += 1

    subs_result = await db.execute(select(Subscription))
    subs_by_user = {sub.user_id: sub for sub in subs_result.scalars().all()}

    out = []
    for au in auth_users:
        uid = uuid.UUID(au.id)
        sub = subs_by_user.get(uid)
        fields = (
            {
                "plan": sub.plan,
                "status": sub.status,
                "credits_remaining": sub.credits_remaining,
                "credits_allotment": sub.credits_allotment,
                "current_period_end": sub.current_period_end,
            }
            if sub
            else _default_free_fields()
        )
        out.append(
            AdminUserOut(
                id=uid,
                email=au.email,
                created_at=au.created_at,
                last_sign_in_at=au.last_sign_in_at,
                **fields,
            )
        )
    return out


@router.patch("/users/{user_id}/plan", response_model=AdminUserOut)
async def update_user_plan(
    user_id: uuid.UUID,
    body: PlanUpdateIn,
    user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Manual plan override for emergencies — automatic upgrades/downgrades
    from billing go through a separate webhook (not built yet). Always
    grants the target plan's full credit allotment and resets billing
    status, same as a fresh subscription."""
    sub = await resolve_subscription(db, user_id)
    sub.plan = body.plan
    sub.status = "active"
    sub.credits_allotment = PLAN_CREDITS[body.plan]
    sub.credits_remaining = PLAN_CREDITS[body.plan]
    if body.plan == "premium":
        sub.current_period_start = utcnow()
        sub.current_period_end = utcnow() + BILLING_PERIOD
    else:
        sub.current_period_end = None
    await db.commit()

    try:
        auth_user = _supabase().auth.admin.get_user_by_id(str(user_id)).user
    except Exception:
        raise HTTPException(status_code=404, detail="User not found")

    return AdminUserOut(
        id=user_id,
        email=auth_user.email,
        created_at=auth_user.created_at,
        last_sign_in_at=auth_user.last_sign_in_at,
        plan=sub.plan,
        status=sub.status,
        credits_remaining=sub.credits_remaining,
        credits_allotment=sub.credits_allotment,
        current_period_end=sub.current_period_end,
    )


@router.post("/users/{user_id}/credits/refresh", response_model=AdminUserOut)
async def refresh_user_credits(
    user_id: uuid.UUID, user=Depends(require_admin), db: AsyncSession = Depends(get_db)
):
    """Manually tops the user's credits back up to their plan's full
    allotment — for support emergencies, not a substitute for the billing
    refill that already happens automatically each cycle."""
    sub = await resolve_subscription(db, user_id)
    sub.credits_remaining = sub.credits_allotment
    await db.commit()

    try:
        auth_user = _supabase().auth.admin.get_user_by_id(str(user_id)).user
    except Exception:
        raise HTTPException(status_code=404, detail="User not found")

    return AdminUserOut(
        id=user_id,
        email=auth_user.email,
        created_at=auth_user.created_at,
        last_sign_in_at=auth_user.last_sign_in_at,
        plan=sub.plan,
        status=sub.status,
        credits_remaining=sub.credits_remaining,
        credits_allotment=sub.credits_allotment,
        current_period_end=sub.current_period_end,
    )

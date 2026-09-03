import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.core.security import get_current_user
from app.core.credits import resolve_subscription, subscription_public

router = APIRouter(prefix="/me", tags=["me"])


@router.get("/subscription")
async def get_my_subscription(
    user=Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """The signed-in user's plan + credit balance + per-action costs. Creates
    a default free subscription on first call."""
    sub = await resolve_subscription(db, uuid.UUID(user["sub"]))
    await db.commit()  # persist a first-touch free row / any rollover
    return subscription_public(sub)

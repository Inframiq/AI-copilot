import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db
from app.db.models import Feedback
from app.core.security import get_current_user
from app.core.config import settings
from app.schemas.feedback import FeedbackIn, FeedbackOut, FeedbackAdminOut

router = APIRouter(prefix="/feedback", tags=["feedback"])


def _require_admin(user=Depends(get_current_user)) -> dict:
    admin_emails = {e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()}
    if (user.get("email") or "").lower() not in admin_emails:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@router.post("", response_model=FeedbackOut, status_code=201)
async def submit_feedback(
    body: FeedbackIn, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    item = Feedback(
        user_id=uuid.UUID(user["sub"]),
        rating=body.rating,
        comment=body.comment,
        page=body.page,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.get("", response_model=list[FeedbackAdminOut])
async def list_feedback(user=Depends(_require_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Feedback).order_by(Feedback.created_at.desc()))
    return result.scalars().all()

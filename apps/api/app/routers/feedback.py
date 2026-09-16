import uuid
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db
from app.db.models import Feedback
from app.core.security import get_current_user, require_admin
from app.core.supabase_admin import extract_name, list_all_auth_users
from app.schemas.feedback import FeedbackIn, FeedbackOut, FeedbackAdminOut

router = APIRouter(prefix="/feedback", tags=["feedback"])


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
async def list_feedback(user=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Feedback).order_by(Feedback.created_at.desc()))
    items = result.scalars().all()

    auth_users_by_id = {uuid.UUID(str(au.id)): au for au in list_all_auth_users()}

    out = []
    for item in items:
        au = auth_users_by_id.get(item.user_id)
        out.append(
            FeedbackAdminOut(
                id=item.id,
                rating=item.rating,
                comment=item.comment,
                page=item.page,
                created_at=item.created_at,
                user_id=item.user_id,
                name=extract_name(au) if au else None,
                email=au.email if au else None,
            )
        )
    return out

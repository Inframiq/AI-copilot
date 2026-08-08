import uuid
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.db.session import get_db
from app.db.models import LearningItem
from app.core.security import get_current_user
from app.schemas.ai import LearningItemIn, LearningItemOut

router = APIRouter(prefix="/learning", tags=["learning"])


class LearningItemStatusUpdate(BaseModel):
    status: Literal["not_started", "learning", "done"]


@router.get("", response_model=list[LearningItemOut])
async def list_learning_items(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(LearningItem)
        .where(LearningItem.user_id == uuid.UUID(user["sub"]))
        .order_by(LearningItem.created_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=LearningItemOut, status_code=201)
async def add_learning_item(
    body: LearningItemIn, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    item = LearningItem(
        user_id=uuid.UUID(user["sub"]),
        skill=body.skill,
        source_jd_title=body.source_jd_title,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=LearningItemOut)
async def update_learning_item(
    item_id: uuid.UUID,
    body: LearningItemStatusUpdate,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(LearningItem).where(
            LearningItem.id == item_id, LearningItem.user_id == uuid.UUID(user["sub"])
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Learning item not found")

    item.status = body.status
    await db.commit()
    await db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
async def delete_learning_item(
    item_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(LearningItem).where(
            LearningItem.id == item_id, LearningItem.user_id == uuid.UUID(user["sub"])
        )
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Learning item not found")

    await db.delete(item)
    await db.commit()

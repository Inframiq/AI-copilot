"""Career Path's own roadmap milestones — the ones the user adds. The page's
built-in milestones are worked out from activity and never stored."""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.models import CareerMilestone
from app.db.session import get_db

router = APIRouter(prefix="/career/milestones", tags=["career"])

# Enough for a roadmap; stops a runaway client filling the table.
MAX_MILESTONES = 50


def _clean(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    return v or None


class MilestoneIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)

    @field_validator("title")
    @classmethod
    def _title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Give the milestone a name.")
        return v

    @field_validator("description")
    @classmethod
    def _description(cls, v: str | None) -> str | None:
        return _clean(v)


class MilestoneUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    done: bool | None = None


class MilestoneOut(BaseModel):
    id: uuid.UUID
    title: str
    description: str | None
    done: bool
    created_at: datetime
    model_config = {"from_attributes": True}


async def _own(db: AsyncSession, user, milestone_id: uuid.UUID) -> CareerMilestone:
    m = (
        await db.execute(
            select(CareerMilestone).where(
                CareerMilestone.id == milestone_id,
                CareerMilestone.user_id == uuid.UUID(user["sub"]),
            )
        )
    ).scalar_one_or_none()
    if not m:
        raise HTTPException(status_code=404, detail="Milestone not found")
    return m


@router.get("", response_model=list[MilestoneOut])
async def list_milestones(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(CareerMilestone)
        .where(CareerMilestone.user_id == uuid.UUID(user["sub"]))
        .order_by(CareerMilestone.created_at)
    )
    return result.scalars().all()


@router.post("", response_model=MilestoneOut, status_code=201)
async def add_milestone(body: MilestoneIn, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    uid = uuid.UUID(user["sub"])
    count = (
        await db.execute(select(func.count(CareerMilestone.id)).where(CareerMilestone.user_id == uid))
    ).scalar_one()
    if count >= MAX_MILESTONES:
        raise HTTPException(status_code=409, detail=f"You can have up to {MAX_MILESTONES} milestones.")
    m = CareerMilestone(user_id=uid, title=body.title, description=body.description, done=False)
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return m


@router.patch("/{milestone_id}", response_model=MilestoneOut)
async def update_milestone(
    milestone_id: uuid.UUID,
    body: MilestoneUpdate,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    m = await _own(db, user, milestone_id)
    if body.title is not None:
        title = body.title.strip()
        if not title:
            raise HTTPException(status_code=422, detail="Give the milestone a name.")
        m.title = title
    if "description" in body.model_fields_set:
        m.description = _clean(body.description)
    if body.done is not None:
        m.done = body.done
    await db.commit()
    await db.refresh(m)
    return m


@router.delete("/{milestone_id}", status_code=204)
async def delete_milestone(
    milestone_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    m = await _own(db, user, milestone_id)
    await db.delete(m)
    await db.commit()

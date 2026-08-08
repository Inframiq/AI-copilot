import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db
from app.db.models import JobDescription
from app.core.security import get_current_user
from app.core.rate_limit import limiter
from app.schemas.jd import JDCreate, JDOut
from app.services.ai_engine.factory import get_ai_provider
from app.services.tailoring import extract_jd_skills

router = APIRouter(prefix="/jd", tags=["jd"])


@router.post("", response_model=JDOut, status_code=201)
@limiter.limit("20/minute")
async def create_jd(
    request: Request,
    body: JDCreate,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    provider = get_ai_provider()
    parsed = await extract_jd_skills(body.raw_text, provider)
    title = body.title or body.raw_text.strip().split("\n")[0][:120] or "Untitled JD"
    jd = JobDescription(
        user_id=uuid.UUID(user["sub"]),
        title=title,
        raw_text=body.raw_text,
        parsed=parsed.model_dump(),
    )
    db.add(jd)
    await db.commit()
    await db.refresh(jd)
    return jd


@router.get("", response_model=list[JDOut])
async def list_jds(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(JobDescription)
        .where(JobDescription.user_id == uuid.UUID(user["sub"]))
        .order_by(JobDescription.created_at.desc())
    )
    return result.scalars().all()


@router.get("/{jd_id}", response_model=JDOut)
async def get_jd(jd_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(JobDescription).where(
            JobDescription.id == jd_id,
            JobDescription.user_id == uuid.UUID(user["sub"]),
        )
    )
    jd = result.scalar_one_or_none()
    if not jd:
        raise HTTPException(status_code=404, detail="JD not found")
    return jd

import uuid
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db
from app.db.models import JobDescription, TailoringSession
from app.core.security import get_current_user
from app.core.rate_limit import limiter
from app.schemas.jd import JDCreate, JDOut, JDStatusUpdate, JDTitleUpdate
from app.services.ai_engine.factory import get_ai_provider
from app.services.tailoring import extract_jd_skills

router = APIRouter(prefix="/jd", tags=["jd"])


@router.post("", response_model=JDOut, status_code=201)
@limiter.limit("20/minute")
async def create_jd(
    request: Request,
    response: Response,
    body: JDCreate,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    uid = uuid.UUID(user["sub"])
    raw_text = body.raw_text.strip()

    # Re-submitting the same JD text (e.g. clicking "Analyze Description"
    # again on unchanged text) must not silently create a duplicate entry —
    # every duplicate starts with an empty parse cache, which defeats the
    # determinism /ai/analyze relies on (same JD → same cached skill list →
    # same score) and wastes an AI call re-parsing text we've already parsed.
    # .first() rather than .scalar_one_or_none() — accounts that used the app
    # before this dedup check existed can already have multiple rows with
    # identical raw_text (every resubmission used to create a new one), and
    # .scalar_one_or_none() throws MultipleResultsFound the moment more than
    # one match exists. Oldest first: the earliest entry for this text is the
    # one most likely to already carry an analyzed skill cache.
    existing = (
        await db.execute(
            select(JobDescription)
            .where(
                JobDescription.user_id == uid,
                JobDescription.raw_text == raw_text,
            )
            .order_by(JobDescription.created_at.asc())
            .limit(1)
        )
    ).scalars().first()
    if existing is not None:
        response.status_code = status.HTTP_200_OK
        return existing

    provider = get_ai_provider()
    parsed = await extract_jd_skills(raw_text, provider)
    title = body.title or raw_text.split("\n")[0][:120] or "Untitled JD"
    jd = JobDescription(
        user_id=uid,
        title=title,
        raw_text=raw_text,
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


@router.get("/{jd_id}/latest-session")
async def get_latest_session(jd_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Most recent tailoring session for this JD, if any — lets the frontend
    route a "prepare for interview?" prompt to an existing session without
    requiring the user to re-tailor just to get there."""
    result = await db.execute(
        select(TailoringSession.id)
        .where(
            TailoringSession.jd_id == jd_id,
            TailoringSession.user_id == uuid.UUID(user["sub"]),
        )
        .order_by(TailoringSession.created_at.desc())
        .limit(1)
    )
    session_id = result.scalar_one_or_none()
    return {"session_id": str(session_id) if session_id else None}


@router.delete("/{jd_id}", status_code=204)
async def delete_jd(
    jd_id: uuid.UUID,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(JobDescription).where(
            JobDescription.id == jd_id,
            JobDescription.user_id == uuid.UUID(user["sub"]),
        )
    )
    jd = result.scalar_one_or_none()
    if not jd:
        raise HTTPException(status_code=404, detail="JD not found")
    await db.delete(jd)
    await db.commit()


@router.patch("/{jd_id}/title", response_model=JDOut)
async def update_jd_title(
    jd_id: uuid.UUID,
    body: JDTitleUpdate,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(JobDescription).where(
            JobDescription.id == jd_id,
            JobDescription.user_id == uuid.UUID(user["sub"]),
        )
    )
    jd = result.scalar_one_or_none()
    if not jd:
        raise HTTPException(status_code=404, detail="JD not found")
    jd.title = body.title
    await db.commit()
    await db.refresh(jd)
    return jd


@router.patch("/{jd_id}/status", response_model=JDOut)
async def update_jd_status(
    jd_id: uuid.UUID,
    body: JDStatusUpdate,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(JobDescription).where(
            JobDescription.id == jd_id,
            JobDescription.user_id == uuid.UUID(user["sub"]),
        )
    )
    jd = result.scalar_one_or_none()
    if not jd:
        raise HTTPException(status_code=404, detail="JD not found")

    jd.status = body.status
    await db.commit()
    await db.refresh(jd)
    return jd

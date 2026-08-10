import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db
from app.db.models import Resume, JobDescription, TailoringSession, PrepQuestion
from app.core.security import get_current_user
from app.core.rate_limit import limiter
from app.schemas.ai import TailorRequest, TailorOut, PrepQuestionOut, AnalyzeRequest, AnalyzeOut
from app.services.ai_engine.factory import get_ai_provider
from app.services.tailoring import run_tailoring_pipeline, analyze_jd_match

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/analyze", response_model=AnalyzeOut)
@limiter.limit("20/minute")
async def analyze_jd(
    request: Request,
    body: AnalyzeRequest,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Read-only JD match analysis — the "Analyze Description" step. Does not
    touch the resume, create a tailoring session, or generate prep questions;
    that only happens when the user explicitly clicks "Tailor Resume"."""
    uid = uuid.UUID(user["sub"])
    resume_row = (
        await db.execute(select(Resume).where(Resume.id == body.resume_id, Resume.user_id == uid))
    ).scalar_one_or_none()
    jd_row = (
        await db.execute(select(JobDescription).where(JobDescription.id == body.jd_id, JobDescription.user_id == uid))
    ).scalar_one_or_none()
    if not resume_row or not jd_row:
        raise HTTPException(status_code=404, detail="Resume or JD not found")

    provider = get_ai_provider()
    analysis = await analyze_jd_match(
        resume_row.content,
        jd_row.raw_text,
        provider,
        company_name=body.company_name,
    )

    return AnalyzeOut(
        ats_score=analysis.ats_score,
        matched_skills=analysis.matched_skills,
        missing_skills=analysis.missing_skills,
        company_keywords=analysis.company_keywords,
    )


@router.post("/tailor", response_model=TailorOut)
@limiter.limit("10/minute")
async def tailor_resume(
    request: Request,
    body: TailorRequest,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    uid = uuid.UUID(user["sub"])
    resume_row = (
        await db.execute(select(Resume).where(Resume.id == body.resume_id, Resume.user_id == uid))
    ).scalar_one_or_none()
    jd_row = (
        await db.execute(select(JobDescription).where(JobDescription.id == body.jd_id, JobDescription.user_id == uid))
    ).scalar_one_or_none()
    if not resume_row or not jd_row:
        raise HTTPException(status_code=404, detail="Resume or JD not found")

    provider = get_ai_provider()
    result = await run_tailoring_pipeline(
        resume_row.content,
        jd_row.raw_text,
        body.humanize_level,
        provider,
        company_name=body.company_name,
    )

    session = TailoringSession(
        user_id=uid,
        resume_id=body.resume_id,
        jd_id=body.jd_id,
        ats_score=result.ats_score,
        matched_skills=result.matched_skills,
        missing_skills=result.missing_skills,
        tailored_content=result.tailored_content,
        humanize_level=body.humanize_level,
    )
    db.add(session)
    await db.flush()

    questions = [
        PrepQuestion(
            session_id=session.id,
            topic=q.topic,
            question=q.question,
            answer_framework=q.answer_framework,
            is_gap_based=q.is_gap_based,
            order_index=q.order_index,
        )
        for q in result.prep_questions
    ]
    db.add_all(questions)
    await db.commit()
    await db.refresh(session)

    return TailorOut(
        session_id=session.id,
        ats_score=result.ats_score,
        matched_skills=result.matched_skills,
        missing_skills=result.missing_skills,
        tailored_content=result.tailored_content,
        questions=[PrepQuestionOut.model_validate(q) for q in questions],
        company_keywords=result.company_keywords,
    )


@router.get("/sessions/{session_id}")
async def get_session(session_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Return a tailoring session's stored output so the frontend can reload a
    previous tailored resume without re-running the AI."""
    result = await db.execute(
        select(TailoringSession).where(
            TailoringSession.id == session_id,
            TailoringSession.user_id == uuid.UUID(user["sub"]),
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "session_id": str(session.id),
        "resume_id": str(session.resume_id),
        "jd_id": str(session.jd_id),
        "tailored_content": session.tailored_content,
        "ats_score": session.ats_score,
        "matched_skills": session.matched_skills,
        "missing_skills": session.missing_skills,
    }


@router.get("/sessions/{session_id}/questions", response_model=list[PrepQuestionOut])
async def get_questions(session_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PrepQuestion)
        .join(TailoringSession)
        .where(
            TailoringSession.id == session_id,
            TailoringSession.user_id == uuid.UUID(user["sub"]),
        )
        .order_by(PrepQuestion.order_index)
    )
    return result.scalars().all()


@router.patch("/questions/{question_id}/practice", response_model=PrepQuestionOut)
async def mark_question_practiced(
    question_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(PrepQuestion)
        .join(TailoringSession)
        .where(
            PrepQuestion.id == question_id,
            TailoringSession.user_id == uuid.UUID(user["sub"]),
        )
    )
    question = result.scalar_one_or_none()
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    question.practiced_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(question)
    return question

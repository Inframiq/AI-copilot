import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import attributes
from app.db.session import get_db
from app.db.models import Resume, JobDescription, TailoringSession, PrepQuestion
from app.core.security import get_current_user
from app.core.rate_limit import limiter
from app.schemas.ai import TailorRequest, TailorOut, PrepQuestionOut, AnalyzeRequest, AnalyzeOut, RewriteBulletRequest, RewriteBulletOut
from app.services.ai_engine.factory import get_ai_provider
from app.services.tailoring import run_tailoring_pipeline, analyze_jd_match, JDAnalysis

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

    # Reuse a previously cached Agent 1 parse when no company name is given —
    # the JD text hasn't changed, so re-parsing it produces the same logical
    # output but with random LLM variation.  Company-name analyses are always
    # re-run because company intel can be time-sensitive.
    cached_jd_analysis: JDAnalysis | None = None
    if not body.company_name:
        raw_cached = (jd_row.parsed or {}).get("agent1")
        if raw_cached:
            try:
                cached_jd_analysis = JDAnalysis(**raw_cached)
            except Exception:
                cached_jd_analysis = None  # corrupt cache — fall back to re-parsing

    analysis = await analyze_jd_match(
        resume_row.content,
        jd_row.raw_text,
        provider,
        company_name=body.company_name,
        cached_jd_analysis=cached_jd_analysis,
    )

    # Persist the Agent 1 result on the first call so all future no-company
    # analyses are deterministic (same JD text → same skill list → same score).
    if not body.company_name and not cached_jd_analysis:
        existing = dict(jd_row.parsed) if jd_row.parsed else {}
        existing["agent1"] = analysis.jd_analysis.model_dump()
        jd_row.parsed = existing
        attributes.flag_modified(jd_row, "parsed")
        await db.commit()

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

    # Reuse cached Agent 1 output (same logic as /analyze) so tailoring uses
    # the same skill list as a prior analysis — consistent ATS score throughout.
    cached_for_tailor: JDAnalysis | None = None
    if not body.company_name:
        raw_cached = (jd_row.parsed or {}).get("agent1")
        if raw_cached:
            try:
                cached_for_tailor = JDAnalysis(**raw_cached)
            except Exception:
                cached_for_tailor = None

    result = await run_tailoring_pipeline(
        resume_row.content,
        jd_row.raw_text,
        body.humanize_level,
        provider,
        company_name=body.company_name,
        priority_skills=body.priority_skills,
        cached_jd_analysis=cached_for_tailor,
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
        suggested_skills=result.suggested_skills,
    )


@router.post("/rewrite-bullet", response_model=RewriteBulletOut)
@limiter.limit("30/minute")
async def rewrite_bullet(
    request: Request,
    body: RewriteBulletRequest,
    user=Depends(get_current_user),
):
    """Rewrite or humanize a single bullet point using AI."""
    provider = get_ai_provider()

    if body.mode == "humanize":
        tone = (
            "Make this bullet sound natural and human. Reduce keyword density while keeping "
            "the meaning, metrics, and impact intact. The reader should feel it was written "
            "by a person, not an ATS optimiser."
            if body.humanize_level < 50
            else "Rewrite this bullet in fluent, confident prose — strong action verb, clear impact, "
            "reads like a senior professional wrote it naturally."
        )
        system = (
            f"You are an expert resume writer. {tone} "
            "Return ONLY the rewritten bullet — no quotes, no preamble, no explanation."
        )
        user_msg = f"Bullet:\n{body.bullet_text}"
    else:  # rewrite — re-optimize for the JD
        system = (
            "You are an elite ATS resume writer. Rewrite the bullet to better match the job "
            "description below. Inject relevant keywords naturally, lead with a strong action "
            "verb, and keep all metrics verbatim. "
            "Return ONLY the rewritten bullet — no quotes, no preamble."
        )
        jd_block = f"\nJob Description context:\n{body.jd_context}" if body.jd_context else ""
        user_msg = f"Bullet:\n{body.bullet_text}{jd_block}"

    rewritten = await provider.complete(system, user_msg, model_tier="fast")
    # Strip surrounding quotes if the model wrapped the output
    rewritten = rewritten.strip().strip('"').strip("'").strip()
    return RewriteBulletOut(rewritten_text=rewritten)


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

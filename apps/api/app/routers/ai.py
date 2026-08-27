import hashlib
import logging
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import attributes
from app.db.session import get_db, AsyncSessionLocal
from app.db.models import Resume, JobDescription, TailoringSession, PrepQuestion, SkillQuestionBank
from app.core.security import get_current_user
from app.core.rate_limit import limiter
from app.schemas.ai import (
    TailorRequest, TailorOut, TailorStartOut, PrepQuestionOut, PrepQuestionWithJdOut, AnalyzeRequest, AnalyzeOut,
    RewriteBulletRequest, RewriteBulletOut, SkillQuestionOut,
)
from app.services.ai_engine.factory import get_ai_provider
from app.services.tailoring import run_tailoring_pipeline, analyze_jd_match, JDAnalysis
from app.services.ats import build_resume_text
from app.services.resume_spec import HARD_LIMITS

router = APIRouter(prefix="/ai", tags=["ai"])
logger = logging.getLogger("app")


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

    content_for_analysis = body.content if body.content is not None else resume_row.content
    resume_fp = (
        hashlib.sha1(build_resume_text(content_for_analysis)[0].encode("utf-8")).hexdigest()
        if isinstance(content_for_analysis, dict)
        else None
    )

    # Reuse a previously cached Agent 1 parse when no company name is given —
    # the JD text hasn't changed, so re-parsing it produces the same logical
    # output but with random LLM variation.  Company-name analyses are always
    # re-run because company intel can be time-sensitive.
    #
    # The semantic-verdict cache is keyed by a fingerprint of the resume text
    # (it depends on both resume and JD): a repeat analyze of an unchanged
    # resume reuses the stored verdicts instead of re-hitting the model, so the
    # score doesn't jitter between clicks.
    cached_jd_analysis: JDAnalysis | None = None
    cached_semantic_verdicts: dict[str, str] | None = None
    raw_cached = None
    if not body.company_name:
        parsed_cache = jd_row.parsed or {}
        raw_cached = parsed_cache.get("agent1")
        if raw_cached:
            try:
                cached_jd_analysis = JDAnalysis(**raw_cached)
            except Exception:
                cached_jd_analysis = None  # corrupt cache — fall back to re-parsing
        sem_cache = parsed_cache.get("semantic")
        if sem_cache and resume_fp and sem_cache.get("fingerprint") == resume_fp:
            cached_semantic_verdicts = sem_cache.get("verdicts") or {}

    analysis = await analyze_jd_match(
        content_for_analysis,
        jd_row.raw_text,
        provider,
        company_name=body.company_name,
        cached_jd_analysis=cached_jd_analysis,
        cached_semantic_verdicts=cached_semantic_verdicts,
    )

    # Persist Agent 1 + semantic verdicts so future no-company analyses are
    # deterministic (same JD text → same skill list, same resume → same score).
    if not body.company_name:
        existing = dict(jd_row.parsed) if jd_row.parsed else {}
        changed = False
        if not raw_cached:
            existing["agent1"] = analysis.jd_analysis.model_dump()
            changed = True
        if resume_fp and cached_semantic_verdicts is None:
            existing["semantic"] = {
                "fingerprint": resume_fp,
                "verdicts": analysis.semantic_verdicts,
            }
            changed = True
        if changed:
            jd_row.parsed = existing
            attributes.flag_modified(jd_row, "parsed")
            await db.commit()

    return AnalyzeOut(
        ats_score=analysis.ats_score,
        matched_skills=analysis.matched_skills,
        missing_skills=analysis.missing_skills,
        company_keywords=analysis.company_keywords,
        title_match=analysis.title_match,
    )


async def _run_tailoring_background(
    session_id: uuid.UUID,
    resume_content: dict,
    jd_text: str,
    humanize_level: int,
    provider,
    company_name: str | None,
    priority_skills: list[str],
    cached_jd_analysis: JDAnalysis | None,
) -> None:
    """Runs the AI tailoring pipeline off the request path.

    Render's free-tier proxy returns a response with no CORS headers if the
    app doesn't answer within ~60s, which browsers then misreport as a CORS
    error. This pipeline chains 3 pro-model LLM calls and routinely takes
    30-90s+, especially on a cold start — well past that limit. POST
    /ai/tailor returns immediately with a pending session; this function
    does the actual work afterward and writes the result back onto it. Uses
    its own DB session (the request-scoped one may already be closed by the
    time this runs) — same pattern as _persist_pdf_to_storage in
    routers/resumes.py.
    """
    async with AsyncSessionLocal() as session_db:
        try:
            result = await run_tailoring_pipeline(
                resume_content,
                jd_text,
                humanize_level,
                provider,
                db=session_db,
                company_name=company_name,
                priority_skills=priority_skills,
                cached_jd_analysis=cached_jd_analysis,
            )
        except Exception:
            logger.exception("Tailoring pipeline failed for session %s", session_id)
            row_result = await session_db.execute(
                select(TailoringSession).where(TailoringSession.id == session_id)
            )
            row = row_result.scalar_one_or_none()
            if row:
                row.status = "failed"
                await session_db.commit()
            return

        row_result = await session_db.execute(
            select(TailoringSession).where(TailoringSession.id == session_id)
        )
        row = row_result.scalar_one_or_none()
        if not row:
            return  # session row is gone — nothing to update
        row.ats_score = result.ats_score
        row.matched_skills = result.matched_skills
        row.missing_skills = result.missing_skills
        row.tailored_content = result.tailored_content
        row.company_keywords = result.company_keywords
        row.suggested_skills = result.suggested_skills
        row.status = "completed"
        session_db.add_all(
            [
                PrepQuestion(
                    session_id=row.id,
                    topic=q.topic,
                    question=q.question,
                    answer_framework=q.answer_framework,
                    is_gap_based=q.is_gap_based,
                    source=q.source,
                    basis=q.basis,
                    order_index=q.order_index,
                )
                for q in result.prep_questions
            ]
        )
        await session_db.commit()


@router.post("/tailor", response_model=TailorStartOut, status_code=202)
@limiter.limit("10/minute")
async def tailor_resume(
    request: Request,
    body: TailorRequest,
    background_tasks: BackgroundTasks,
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

    session = TailoringSession(
        user_id=uid,
        resume_id=body.resume_id,
        jd_id=body.jd_id,
        humanize_level=body.humanize_level,
        status="pending",
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    background_tasks.add_task(
        _run_tailoring_background,
        session.id,
        resume_row.content,
        jd_row.raw_text,
        body.humanize_level,
        provider,
        body.company_name,
        body.priority_skills,
        cached_for_tailor,
    )

    return TailorStartOut(session_id=session.id, status="pending")


@router.post("/rewrite-bullet", response_model=RewriteBulletOut)
@limiter.limit("30/minute")
async def rewrite_bullet(
    request: Request,
    body: RewriteBulletRequest,
    user=Depends(get_current_user),
):
    """Rewrite, humanize, or custom-instruction-rewrite a single bullet or
    the resume's Summary using AI. Same lightweight single-call shape either
    way — field only changes prompt framing (one-line bullet vs. an
    80-word-cap flowing paragraph) and applies the summary word cap as a
    backstop, the same limit the Summary tab's textarea already enforces
    when the user types directly (resume_spec.py HARD_LIMITS["summary"])."""
    if body.mode == "custom" and not body.custom_instruction.strip():
        raise HTTPException(status_code=422, detail="custom_instruction is required for mode=custom")

    provider = get_ai_provider()
    is_summary = body.field == "summary"
    label = "professional summary" if is_summary else "bullet"
    format_rule = (
        f"Write it as a single flowing paragraph (no bullet points, no line breaks), "
        f"at most {HARD_LIMITS['summary']['max_words']} words."
        if is_summary
        else "Return a single resume bullet, one line."
    )

    if body.mode == "custom":
        system = (
            f"You are an expert resume writer. Rewrite this {label} following the user's instructions "
            "exactly. Keep every factual claim, metric, and skill truthful to the original — never "
            f"invent experience that isn't there. {format_rule} "
            "Return ONLY the rewritten text — no quotes, no preamble, no explanation."
        )
        user_msg = f"Original {label}:\n{body.bullet_text}\n\nInstructions:\n{body.custom_instruction}"
    elif body.mode == "humanize":
        tone = (
            f"Make this {label} sound natural and human. Reduce keyword density while keeping "
            "the meaning, metrics, and impact intact. The reader should feel it was written "
            "by a person, not an ATS optimiser."
            if body.humanize_level < 50
            else f"Rewrite this {label} in fluent, confident prose — clear impact, reads like a "
            "senior professional wrote it naturally."
        )
        system = (
            f"You are an expert resume writer. {tone} {format_rule} "
            "Return ONLY the rewritten text — no quotes, no preamble, no explanation."
        )
        user_msg = f"{label.capitalize()}:\n{body.bullet_text}"
    else:  # rewrite — re-optimize for the JD
        system = (
            f"You are an elite ATS resume writer. Rewrite the {label} to better match the job "
            "description below. Inject relevant keywords naturally and keep all metrics verbatim. "
            f"{format_rule} Return ONLY the rewritten text — no quotes, no preamble."
        )
        jd_block = f"\nJob Description context:\n{body.jd_context}" if body.jd_context else ""
        user_msg = f"{label.capitalize()}:\n{body.bullet_text}{jd_block}"

    # Small, fixed-shape output (one bullet or an 80-word-cap summary) — a
    # tight ceiling avoids giving the reasoning model unneeded headroom to
    # burn extra (billed) reasoning tokens. See tailoring.py's per-call
    # token-ceiling comment / docs/ai-pipeline.md.
    rewritten = await provider.complete(
        system, user_msg, model_tier="fast", max_output_tokens=1200, call_name="rewrite_bullet"
    )
    # Strip surrounding quotes if the model wrapped the output
    rewritten = rewritten.strip().strip('"').strip("'").strip()
    if is_summary:
        # Backstop — the prompt asks for the cap, but never trust it alone.
        words = rewritten.split()
        max_words = HARD_LIMITS["summary"]["max_words"]
        if len(words) > max_words:
            rewritten = " ".join(words[:max_words]).rstrip(",;:") + "."
    return RewriteBulletOut(rewritten_text=rewritten)


@router.get("/questions/browse", response_model=list[SkillQuestionOut])
async def browse_questions(
    topic: str | None = None,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Read-only browse of the shared skill-question bank — used by the
    Interview Center's "no active session" view so it shows real,
    previously-generated questions instead of nothing. Not personalized;
    same content for every user browsing the same topic."""
    query = select(SkillQuestionBank)
    if topic:
        query = query.where(SkillQuestionBank.topic == topic)
    query = query.order_by(SkillQuestionBank.created_at.desc()).limit(50)
    rows = (await db.execute(query)).scalars().all()
    return rows


@router.get("/sessions/latest")
async def get_latest_session(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Most recent completed tailoring session for this user, across every
    JD — used by Interview Center to resolve real, JD-specific questions on
    load instead of falling back to the unfiltered cross-user question bank
    just because the in-memory tailoring store (which only tracks the most
    recently *active* session, not the most recent one overall) is empty,
    e.g. after a page reload or navigating in directly.

    Registered before /sessions/{session_id} — "latest" would otherwise be
    parsed as that route's session_id and 422 on the UUID conversion.
    """
    uid = uuid.UUID(user["sub"])
    result = await db.execute(
        select(TailoringSession)
        .where(TailoringSession.user_id == uid, TailoringSession.status == "completed")
        .order_by(TailoringSession.created_at.desc())
        .limit(1)
    )
    session = result.scalars().first()
    if not session:
        return {"session_id": None}
    return {
        "session_id": str(session.id),
        # None once the input resume has since been deleted — tailored_content
        # below is a self-contained snapshot and doesn't depend on it.
        "resume_id": str(session.resume_id) if session.resume_id else None,
        "jd_id": str(session.jd_id),
        "status": session.status,
        "tailored_content": session.tailored_content,
        "ats_score": session.ats_score,
        "matched_skills": session.matched_skills,
        "missing_skills": session.missing_skills,
        "company_keywords": session.company_keywords,
        "suggested_skills": session.suggested_skills,
    }


@router.get("/sessions/{session_id}")
async def get_session(session_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Return a tailoring session's stored output so the frontend can reload a
    previous tailored resume without re-running the AI, or poll a pending one
    started by POST /ai/tailor."""
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
        # None once the input resume has since been deleted — tailored_content
        # below is a self-contained snapshot and doesn't depend on it.
        "resume_id": str(session.resume_id) if session.resume_id else None,
        "jd_id": str(session.jd_id),
        "status": session.status,
        "tailored_content": session.tailored_content,
        "ats_score": session.ats_score,
        "matched_skills": session.matched_skills,
        "missing_skills": session.missing_skills,
        "company_keywords": session.company_keywords,
        "suggested_skills": session.suggested_skills,
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


@router.get("/questions/mine", response_model=list[PrepQuestionWithJdOut])
async def get_my_questions(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Every prep question generated for this user, one JD's worth at a
    time — from each JD's most recent completed tailoring session only, so
    re-tailoring the same JD repeatedly doesn't pile up duplicate/stale
    question sets under its name. Powers Interview Center's "categorize by
    JD" grouping and its JD filter; both are computed client-side off this
    one list rather than a separate endpoint per JD."""
    uid = uuid.UUID(user["sub"])

    latest_per_jd = (
        select(
            TailoringSession.jd_id,
            func.max(TailoringSession.created_at).label("latest_created_at"),
        )
        .where(TailoringSession.user_id == uid, TailoringSession.status == "completed")
        .group_by(TailoringSession.jd_id)
        .subquery()
    )
    sessions_result = await db.execute(
        select(TailoringSession.id, TailoringSession.jd_id, JobDescription.title)
        .join(
            latest_per_jd,
            (TailoringSession.jd_id == latest_per_jd.c.jd_id)
            & (TailoringSession.created_at == latest_per_jd.c.latest_created_at),
        )
        .join(JobDescription, TailoringSession.jd_id == JobDescription.id)
        .where(TailoringSession.user_id == uid, TailoringSession.status == "completed")
    )
    session_jd = {row.id: (row.jd_id, row.title) for row in sessions_result.all()}
    if not session_jd:
        return []

    questions_result = await db.execute(
        select(PrepQuestion)
        .where(PrepQuestion.session_id.in_(session_jd.keys()))
        .order_by(PrepQuestion.order_index)
    )
    return [
        PrepQuestionWithJdOut(
            id=q.id,
            session_id=q.session_id,
            topic=q.topic,
            question=q.question,
            answer_framework=q.answer_framework,
            is_gap_based=q.is_gap_based,
            source=q.source,
            basis=q.basis,
            order_index=q.order_index,
            practiced_at=q.practiced_at,
            jd_id=session_jd[q.session_id][0],
            jd_title=session_jd[q.session_id][1],
        )
        for q in questions_result.scalars().all()
    ]


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

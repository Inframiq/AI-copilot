"""Interview prep questions: made when a tailored résumé is saved to its JD.

The one way questions come into being. Analyzing a JD makes none, and neither
does opening an interview page — saving the reviewed, tailored résumé for a JD
is the user saying "this is the version I'm applying with", and that version is
what the questions are about.

They hang off the tailoring run (PrepQuestion.session_id) that produced the
saved résumé, but are written from the résumé as saved, edits included.
"""
import logging
import uuid

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.usage import record_ai_usage
from app.db.models import JobDescription, PrepQuestion, TailoringSession
from app.db.session import AsyncSessionLocal
from app.services.ai_engine.factory import get_ai_provider
from app.services.tailoring import JDAnalysis, _agent1_parse_jd, get_or_generate_prep_questions

logger = logging.getLogger("app")


def sessions_with_questions():
    """Subquery: the ids of tailoring runs that have prep questions."""
    return select(PrepQuestion.session_id).distinct()


async def run_for_saved_resume(
    db: AsyncSession, user_id: uuid.UUID, jd_id: uuid.UUID,
    requested_session_id: uuid.UUID | None = None,
) -> TailoringSession | None:
    """The completed tailoring run a résumé saved for this JD came from.

    The run the client names when it is this user's, for this JD and finished;
    otherwise the JD's most recent completed run. None when the JD was only
    ever analyzed — then there is nothing to make questions from.
    """
    base = select(TailoringSession).where(
        TailoringSession.user_id == user_id,
        TailoringSession.jd_id == jd_id,
        TailoringSession.status == "completed",
    )
    if requested_session_id is not None:
        named = (
            await db.execute(base.where(TailoringSession.id == requested_session_id))
        ).scalar_one_or_none()
        if named is not None:
            return named
    return (
        await db.execute(base.order_by(TailoringSession.created_at.desc()).limit(1))
    ).scalars().first()


async def generate_for_session(
    db: AsyncSession, session: TailoringSession, jd: JobDescription, resume_content: dict,
) -> list[PrepQuestion]:
    """Writes this run's questions, from the saved résumé. A run that already
    has a set keeps it — saving the same JD again must not replace questions
    the user may already be practicing."""
    async def existing() -> list[PrepQuestion]:
        return list(
            (
                await db.execute(
                    select(PrepQuestion)
                    .where(PrepQuestion.session_id == session.id)
                    .order_by(PrepQuestion.order_index)
                )
            ).scalars().all()
        )

    if have := await existing():
        return have

    provider = get_ai_provider()
    # The JD's cached parse when it has one. A run made with a target company
    # leaves none behind (that parse is company-specific, so it isn't cached),
    # which used to mean no questions at all — parse the JD here instead.
    # Not cached either: the cache is what the displayed score was computed
    # from, and is only ever written by analyze/tailor.
    raw_cached = (jd.parsed or {}).get("agent1")
    jd_analysis: JDAnalysis | None = None
    if raw_cached:
        try:
            jd_analysis = JDAnalysis(**raw_cached)
        except Exception:
            jd_analysis = None
    if jd_analysis is None:
        jd_analysis = await _agent1_parse_jd(jd.raw_text, provider)

    async with record_ai_usage(session.user_id, "prep_questions"):
        questions = await get_or_generate_prep_questions(
            session.missing_skills or [],
            resume_content or session.tailored_content or {},
            provider,
            db,
            jd_analysis=jd_analysis,
            matched_skills=session.matched_skills or [],
        )
    rows = [
        PrepQuestion(
            session_id=session.id, topic=q.topic, question=q.question,
            answer_framework=q.answer_framework, is_gap_based=q.is_gap_based,
            source=q.source, basis=q.basis, order_index=q.order_index,
        )
        for q in questions
    ]
    # The save's background task and the JD page's "Generate questions" can
    # overlap; whichever finishes second keeps the first one's set.
    if have := await existing():
        return have
    if rows:
        db.add_all(rows)
        await db.commit()
        for r in rows:
            await db.refresh(r)
    return rows


async def generate_after_save(
    user_id: uuid.UUID, jd_id: uuid.UUID, session_id: uuid.UUID | None, resume_content: dict,
) -> None:
    """Background task behind Save to JD. Its own DB session — the request's
    is closed by the time this runs. Never raises: the save already succeeded,
    and a failure here leaves the JD page's "Generate questions" to retry."""
    async with AsyncSessionLocal() as db:
        try:
            jd = (
                await db.execute(
                    select(JobDescription).where(
                        JobDescription.id == jd_id, JobDescription.user_id == user_id
                    )
                )
            ).scalar_one_or_none()
            session = await run_for_saved_resume(db, user_id, jd_id, session_id)
            if jd is None or session is None:
                return
            await generate_for_session(db, session, jd, resume_content)
        except Exception:
            logger.exception("Prep question generation failed for JD %s", jd_id)


async def latest_session_with_questions(
    db: AsyncSession, user_id: uuid.UUID, jd_id: uuid.UUID,
) -> TailoringSession | None:
    """The JD's most recent completed run that has questions — the set the
    Interview Center and the JD page show. Not simply its latest run: a later
    re-tailor that was never saved has none, and used to hide the set that
    exists."""
    return (
        await db.execute(
            select(TailoringSession)
            .where(
                TailoringSession.user_id == user_id,
                TailoringSession.jd_id == jd_id,
                TailoringSession.status == "completed",
                TailoringSession.id.in_(sessions_with_questions()),
            )
            .order_by(TailoringSession.created_at.desc())
            .limit(1)
        )
    ).scalars().first()


def latest_with_questions_per_jd(user_id: uuid.UUID):
    """Subquery (jd_id, latest_created_at) over runs that have questions."""
    return (
        select(
            TailoringSession.jd_id,
            func.max(TailoringSession.created_at).label("latest_created_at"),
        )
        .where(
            TailoringSession.user_id == user_id,
            TailoringSession.status == "completed",
            TailoringSession.id.in_(sessions_with_questions()),
        )
        .group_by(TailoringSession.jd_id)
        .subquery()
    )

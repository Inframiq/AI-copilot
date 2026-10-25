"""Interview prep questions: made when a tailored résumé is saved to its JD.

The one way questions come into being. Analyzing a JD makes none, and neither
does opening an interview page — saving the reviewed, tailored résumé for a JD
is the user saying "this is the version I'm applying with", and that version is
what the questions are about.

The client asks for them (POST /jd/{id}/prep-questions) the moment its save
succeeds and waits on the answer. It used to be a background task the client
could not see finish, so every list of questions stayed empty until something
happened to fetch it again.

They hang off the tailoring run (PrepQuestion.session_id) that produced the
saved résumé, but are written from the résumé as saved, edits included.
"""
import logging
import uuid
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import delete, select, func, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.credits import refund_credits, spend_credits
from app.core.usage import record_ai_usage
from app.db.models import JobDescription, PrepFollowup, PrepQuestion, Resume, TailoringSession, utcnow
from app.services.ai_engine.factory import get_ai_provider
from app.services.tailoring import (
    JDAnalysis, _agent1_parse_jd, answer_followup, get_or_generate_prep_questions,
)

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
    *, replace: bool = False,
) -> tuple[list[PrepQuestion], bool]:
    """Writes this run's questions, from the saved résumé. A run that already
    has a set keeps it — saving the same JD again must not replace questions
    the user may already be practicing — unless the user asked for a new set
    (replace). Then the new set is made first and swapped in in one commit,
    so a failed or empty generation leaves the old set as it was (and
    returns []).

    Returns the run's questions and whether this call made them: False when
    it found a set (one another request made meanwhile included) or made
    nothing, which is what the caller refunds on."""
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

    if not replace and (have := await existing()):
        return have, False

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

    async with record_ai_usage(session.user_id, "prep_questions"):
        if jd_analysis is None:
            jd_analysis = await _agent1_parse_jd(jd.raw_text, provider)
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
            id=uuid.uuid4(), session_id=session.id, topic=q.topic, question=q.question,
            answer_framework=q.answer_framework, likely_answer=q.likely_answer or None,
            is_gap_based=q.is_gap_based, source=q.source, basis=q.basis, order_index=q.order_index,
        )
        for q in questions
    ]
    # Each question's first follow-up: shown with it, answered on request.
    followups = [
        PrepFollowup(question_id=row.id, position=1, question=q.follow_up)
        for row, q in zip(rows, questions)
        if q.follow_up
    ]
    if replace and not rows:
        return [], False  # nothing to swap in; the old set stays
    # Two requests can both get this far for one run: Save to JD pressed
    # twice, a second tab, or the JD page's "Generate questions" at the same
    # time. Checking for a set and then adding one used to let both add one
    # (test ATK-038). The run's row is now locked until this commits, so the
    # second waits here, then finds the first's set and keeps it.
    await db.execute(
        select(TailoringSession.id).where(TailoringSession.id == session.id).with_for_update()
    )
    if replace:
        await db.execute(delete(PrepQuestion).where(PrepQuestion.session_id == session.id))
    elif have := await existing():
        await db.commit()  # lets the next one in
        return have, False
    if rows:
        db.add_all(rows)
        await db.flush()  # the questions exist before their follow-ups point at them
        db.add_all(followups)
    await db.commit()
    for r in rows:
        await db.refresh(r)
    return rows, bool(rows)


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


async def followups_by_question(
    db: AsyncSession, question_ids: list[uuid.UUID],
) -> dict[uuid.UUID, list[PrepFollowup]]:
    """Each question's follow-up chain, in order."""
    if not question_ids:
        return {}
    rows = (
        await db.execute(
            select(PrepFollowup)
            .where(PrepFollowup.question_id.in_(question_ids))
            .order_by(PrepFollowup.question_id, PrepFollowup.position)
        )
    ).scalars().all()
    out: dict[uuid.UUID, list[PrepFollowup]] = {}
    for r in rows:
        out.setdefault(r.question_id, []).append(r)
    return out


# A claim older than this belongs to a request that died mid-answer.
_STALE_CLAIM = timedelta(minutes=3)


async def answer_followup_for_user(
    db: AsyncSession, user_id: uuid.UUID, email: str | None, followup_id: uuid.UUID,
) -> list[PrepFollowup]:
    """Writes the likely answer to one follow-up and adds the next follow-up.
    Returns the question's whole chain.

    Charged ("followup_answer") only when an answer is written: one already
    written comes back free. The row is claimed first, in its own commit, so
    a double click or a second tab can't pay twice for the same answer; a
    failed answer gives the credits back and releases the claim."""
    found = (
        await db.execute(
            select(PrepFollowup, PrepQuestion, TailoringSession)
            .join(PrepQuestion, PrepFollowup.question_id == PrepQuestion.id)
            .join(TailoringSession, PrepQuestion.session_id == TailoringSession.id)
            .where(PrepFollowup.id == followup_id, TailoringSession.user_id == user_id)
        )
    ).first()
    if found is None:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    followup, question, session = found
    # Plain values: a rollback below expires the ORM objects.
    fid, qid, position = followup.id, question.id, followup.position

    async def chain() -> list[PrepFollowup]:
        return (await followups_by_question(db, [qid])).get(qid, [])

    if followup.answer:
        return await chain()

    claimed = (
        await db.execute(
            update(PrepFollowup)
            .where(
                PrepFollowup.id == fid,
                PrepFollowup.answer.is_(None),
                (PrepFollowup.claimed_at.is_(None)) | (PrepFollowup.claimed_at < utcnow() - _STALE_CLAIM),
            )
            .values(claimed_at=utcnow())
            .returning(PrepFollowup.id)
            .execution_options(synchronize_session=False)
        )
    ).first()
    await db.commit()
    if claimed is None:
        await db.refresh(followup)
        if followup.answer:
            return await chain()
        raise HTTPException(status_code=409, detail="This answer is already being written.")

    async def release() -> None:
        await db.execute(
            update(PrepFollowup).where(PrepFollowup.id == fid).values(claimed_at=None)
            .execution_options(synchronize_session=False)
        )

    try:
        await spend_credits(db, user_id, "followup_answer", email=email)
    except HTTPException:
        await db.rollback()
        await release()
        await db.commit()
        raise
    await db.commit()

    try:
        jd = (
            await db.execute(select(JobDescription).where(JobDescription.id == session.jd_id))
        ).scalar_one_or_none()
        resume_content = session.tailored_content or {}
        if jd is not None and jd.tailored_resume_id:
            saved = (
                await db.execute(
                    select(Resume).where(Resume.id == jd.tailored_resume_id, Resume.user_id == user_id)
                )
            ).scalar_one_or_none()
            if saved is not None and saved.content:
                resume_content = saved.content
        jd_analysis: JDAnalysis | None = None
        raw_cached = ((jd.parsed if jd else None) or {}).get("agent1")
        if raw_cached:
            try:
                jd_analysis = JDAnalysis(**raw_cached)
            except Exception:
                jd_analysis = None
        earlier = [
            (f.question, f.answer)
            for f in await chain()
            if f.position < position and f.answer
        ]
        async with record_ai_usage(user_id, "followup_answer"):
            result = await answer_followup(
                jd_analysis=jd_analysis,
                jd_text=jd.raw_text if jd else "",
                matched_skills=session.matched_skills or [],
                missing_skills=session.missing_skills or [],
                resume_content=resume_content,
                question=question.question,
                likely_answer=question.likely_answer or question.answer_framework,
                earlier=earlier,
                follow_up=followup.question,
                provider=get_ai_provider(),
            )
        answer = result.likely_answer.strip()
        if not answer:
            raise ValueError("empty follow-up answer")
    except Exception:
        logger.exception("follow-up answer failed (followup=%s)", fid)
        await db.rollback()
        await refund_credits(db, user_id, "followup_answer", email=email)
        await release()
        await db.commit()
        raise HTTPException(
            status_code=502,
            detail="Couldn't write this answer. No credits were used — try again.",
        )

    await db.execute(
        update(PrepFollowup).where(PrepFollowup.id == fid)
        .values(answer=answer, claimed_at=None)
        .execution_options(synchronize_session=False)
    )
    next_question = result.next_follow_up.strip()
    if next_question:
        await db.execute(
            pg_insert(PrepFollowup)
            .values(id=uuid.uuid4(), question_id=qid, position=position + 1,
                    question=next_question, created_at=utcnow())
            .on_conflict_do_nothing(constraint="uq_prep_followups_question_position")
        )
    await db.commit()
    db.expire_all()
    return await chain()

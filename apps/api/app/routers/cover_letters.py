import asyncio
import base64
import logging
import uuid
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete, func, select
from supabase import create_client
from app.core.config import settings
from app.db.session import get_db, AsyncSessionLocal
from app.db.models import Resume, JobDescription, TailoringSession, CoverLetter
from app.core.security import get_current_user
from app.core.rate_limit import ai_global_limit, limiter
from app.core.credits import spend_credits, refund_credits
from app.schemas.cover_letter import (
    CoverLetterGenerateRequest, CoverLetterStartOut, CoverLetterOut, CoverLetterUpdate,
    CoverLetterPdfRequest,
)

def letter_title(jd_title: str, company: str | None) -> str:
    """A letter's name, after the job it is for."""
    name = f"Cover letter — {jd_title.strip()}"
    if company and company.strip():
        name += f", {company.strip()}"
    return name[:255]


# A draft nobody saved within this long was abandoned: cleared out the next
# time the same user generates a letter, so unsaved drafts don't pile up.
_DRAFT_TTL = timedelta(days=1)
from app.services.ai_engine.factory import get_ai_provider
from app.services.tailoring import write_cover_letter, analyze_jd_match, JDAnalysis
from app.services.pdf import generate_letter_pdf, upload_letter_pdf

router = APIRouter(prefix="/cover-letters", tags=["cover-letters"])
logger = logging.getLogger("app")

_sb_client = None


def _supabase():
    global _sb_client
    if _sb_client is None:
        _sb_client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    return _sb_client


async def _run_cover_letter_background(
    cover_letter_id: uuid.UUID,
    user_id: uuid.UUID,
    resume_content: dict,
    jd_text: str,
    jd_title: str,
    company_name: str | None,
    humanize_level: int,
    provider,
    cached_jd_analysis: JDAnalysis | None,
    user_email: str | None = None,
) -> None:
    """Runs letter generation off the request path — same reasoning as
    _run_tailoring_background in routers/ai.py: this chains a JD-analysis
    call (skipped if cached) and a pro-model writer call, which can exceed
    Render's ~60s proxy timeout. Uses its own DB session since the request-
    scoped one may already be closed by the time this runs."""
    async with AsyncSessionLocal() as session_db:
        try:
            match = await analyze_jd_match(
                resume_content, jd_text, provider, cached_jd_analysis=cached_jd_analysis,
            )
            result = await write_cover_letter(
                resume_content, match.jd_analysis, match.matched_skills,
                jd_title, company_name, humanize_level, provider,
            )
        except Exception:
            logger.exception("Cover letter generation failed for %s", cover_letter_id)
            row_result = await session_db.execute(
                select(CoverLetter).where(CoverLetter.id == cover_letter_id)
            )
            row = row_result.scalar_one_or_none()
            if row:
                row.status = "failed"
            # spend_credits already charged for this run before the background
            # job started — give it back since no letter was ever delivered.
            await refund_credits(session_db, user_id, "cover_letter", email=user_email)
            await session_db.commit()
            return

        row_result = await session_db.execute(
            select(CoverLetter).where(CoverLetter.id == cover_letter_id)
        )
        row = row_result.scalar_one_or_none()
        if not row:
            return
        row.content = result.body
        row.status = "completed"
        await session_db.commit()


@router.post("", response_model=CoverLetterStartOut, status_code=202)
@limiter.limit("10/minute")
@ai_global_limit
async def generate_cover_letter(
    request: Request,
    body: CoverLetterGenerateRequest,
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

    await spend_credits(db, uid, "cover_letter", email=user.get("email"))

    # Reuse the tailored resume content when a session is linked; otherwise
    # use the resume as saved.
    resume_content = resume_row.content
    if body.tailoring_session_id:
        session_row = (
            await db.execute(
                select(TailoringSession).where(
                    TailoringSession.id == body.tailoring_session_id,
                    TailoringSession.user_id == uid,
                )
            )
        ).scalar_one_or_none()
        if session_row and session_row.tailored_content:
            resume_content = session_row.tailored_content

    provider = get_ai_provider()

    cached_jd_analysis: JDAnalysis | None = None
    if not body.company_name:
        raw_cached = (jd_row.parsed or {}).get("agent1")
        if raw_cached:
            try:
                cached_jd_analysis = JDAnalysis(**raw_cached)
            except Exception:
                cached_jd_analysis = None

    await db.execute(
        delete(CoverLetter).where(
            CoverLetter.user_id == uid,
            CoverLetter.saved_at.is_(None),
            CoverLetter.created_at < datetime.now(timezone.utc) - _DRAFT_TTL,
        )
    )
    # A draft: nothing is kept until the user saves it (PATCH below).
    letter = CoverLetter(
        user_id=uid,
        resume_id=body.resume_id,
        jd_id=body.jd_id,
        tailoring_session_id=body.tailoring_session_id,
        humanize_level=body.humanize_level,
        status="pending",
        title=letter_title(jd_row.title, body.company_name or jd_row.company_name),
    )
    db.add(letter)
    await db.commit()
    await db.refresh(letter)

    background_tasks.add_task(
        _run_cover_letter_background,
        letter.id,
        uid,
        resume_content,
        jd_row.raw_text,
        jd_row.title,
        body.company_name,
        body.humanize_level,
        provider,
        cached_jd_analysis,
        user.get("email"),
    )

    return CoverLetterStartOut(cover_letter_id=letter.id, status="pending")


@router.get("/{cover_letter_id}", response_model=CoverLetterOut)
async def get_cover_letter(
    cover_letter_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(CoverLetter).where(
            CoverLetter.id == cover_letter_id, CoverLetter.user_id == uuid.UUID(user["sub"])
        )
    )
    letter = result.scalar_one_or_none()
    if not letter:
        raise HTTPException(status_code=404, detail="Cover letter not found")
    return letter


@router.get("", response_model=list[CoverLetterOut])
async def list_cover_letters(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Saved letters only: a draft is the user's to keep or leave.
    result = await db.execute(
        select(CoverLetter)
        .where(CoverLetter.user_id == uuid.UUID(user["sub"]), CoverLetter.saved_at.is_not(None))
        .order_by(CoverLetter.created_at.desc())
    )
    return result.scalars().all()


@router.patch("/{cover_letter_id}", response_model=CoverLetterOut)
async def update_cover_letter(
    cover_letter_id: uuid.UUID,
    body: CoverLetterUpdate,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CoverLetter).where(
            CoverLetter.id == cover_letter_id, CoverLetter.user_id == uuid.UUID(user["sub"])
        )
    )
    letter = result.scalar_one_or_none()
    if not letter:
        raise HTTPException(status_code=404, detail="Cover letter not found")
    # The editor's Save: the only thing that keeps a letter.
    letter.content = body.content
    title = body.title.strip() if body.title and body.title.strip() else letter.title
    # Saved for the first time under the name it was given, beside other
    # saved letters for the same job: numbered, so they can be told apart
    # ("… (2)"). Counted at save, so drafts nobody kept use no numbers, and
    # a name the user chose is left as they wrote it.
    if letter.saved_at is None and title and title == letter.title:
        others = (
            await db.execute(
                select(func.count()).select_from(CoverLetter).where(
                    CoverLetter.user_id == letter.user_id,
                    CoverLetter.jd_id == letter.jd_id,
                    CoverLetter.saved_at.is_not(None),
                    CoverLetter.id != letter.id,
                )
            )
        ).scalar_one()
        if others:
            title = f"{title} ({others + 1})"[:255]
    letter.title = title
    letter.saved_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(letter)
    return letter


@router.delete("/{cover_letter_id}", status_code=204)
async def delete_cover_letter(
    cover_letter_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(CoverLetter).where(
            CoverLetter.id == cover_letter_id, CoverLetter.user_id == uuid.UUID(user["sub"])
        )
    )
    letter = result.scalar_one_or_none()
    if not letter:
        raise HTTPException(status_code=404, detail="Cover letter not found")
    await db.delete(letter)
    await db.commit()


async def _persist_letter_pdf_to_storage(pdf_bytes: bytes, user_id: str, cover_letter_id: uuid.UUID) -> None:
    sb = _supabase()
    path = await upload_letter_pdf(pdf_bytes, user_id, str(cover_letter_id), sb)
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(CoverLetter).where(CoverLetter.id == cover_letter_id))
        letter = result.scalar_one_or_none()
        if letter:
            letter.pdf_url = path
            await session.commit()


@router.post("/{cover_letter_id}/pdf")
@limiter.limit("10/minute")
async def generate_cover_letter_pdf(
    request: Request,
    cover_letter_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    body: CoverLetterPdfRequest | None = None,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    uid = uuid.UUID(user["sub"])
    letter = (
        await db.execute(
            select(CoverLetter).where(CoverLetter.id == cover_letter_id, CoverLetter.user_id == uid)
        )
    ).scalar_one_or_none()
    content = (body.content if body and body.content is not None else letter.content) if letter else None
    if not letter or not content:
        raise HTTPException(status_code=404, detail="Cover letter not found or not yet generated")
    resume_row = (
        await db.execute(select(Resume).where(Resume.id == letter.resume_id, Resume.user_id == uid))
    ).scalar_one_or_none()
    contact = (resume_row.content or {}).get("contact", {}) if resume_row else {}
    now = datetime.now(timezone.utc)
    date_str = f"{now:%B} {now.day}, {now:%Y}"

    pdf_bytes = await asyncio.to_thread(generate_letter_pdf, contact, date_str, content)
    # Only a saved letter, as saved, gets its PDF kept: a draft's download is
    # stored nowhere.
    if letter.saved_at is not None and content == letter.content:
        background_tasks.add_task(_persist_letter_pdf_to_storage, pdf_bytes, str(uid), cover_letter_id)
    data_url = f"data:application/pdf;base64,{base64.b64encode(pdf_bytes).decode('ascii')}"
    return {"signed_url": data_url, "expires_in": None}

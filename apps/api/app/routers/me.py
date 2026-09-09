import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from supabase import create_client

from app.db.session import get_db
from app.core.config import settings
from app.core.security import get_current_user
from app.core.credits import resolve_subscription, subscription_public
from app.db.models import (
    AiUsageEvent,
    CoverLetter,
    ExternalContact,
    JobDescription,
    LearningItem,
    Resume,
    ResumeDeletionLog,
    Subscription,
    TailoringSession,
)

router = APIRouter(prefix="/me", tags=["me"])
logger = logging.getLogger("app")

# Singleton Supabase service-role client — one connection pool per process,
# same pattern as routers/resumes.py.
_sb_client = None


def _supabase():
    global _sb_client
    if _sb_client is None:
        _sb_client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    return _sb_client


@router.get("/subscription")
async def get_my_subscription(
    user=Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """The signed-in user's plan + credit balance + per-action costs. Creates
    a default free subscription on first call."""
    sub = await resolve_subscription(db, uuid.UUID(user["sub"]))
    await db.commit()  # persist a first-touch free row / any rollover
    return subscription_public(sub)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_my_account(
    user=Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Permanently delete the signed-in user's account and every row keyed to
    them, then remove the Supabase auth user itself. Irreversible.

    The auth user is deleted first: that immediately revokes the ability to
    sign in (and invalidates refresh tokens), so a partial failure in the
    data cleanup below leaves only orphaned rows keyed to a user that can no
    longer authenticate — harmless and sweepable — rather than a live login
    pointing at a half-wiped account.
    """
    uid = uuid.UUID(user["sub"])
    uid_str = str(uid)

    # ── Collect storage object paths before their rows are gone ──────────────
    resume_files_result = await db.execute(
        select(Resume.original_file_path, Resume.pdf_url).where(Resume.user_id == uid)
    )
    storage_paths: list[str] = []
    for original_path, pdf_path in resume_files_result.all():
        storage_paths.extend(p for p in (original_path, pdf_path) if p)
    cover_pdf_result = await db.execute(
        select(CoverLetter.pdf_url).where(CoverLetter.user_id == uid)
    )
    storage_paths.extend(p for (p,) in cover_pdf_result.all() if p)

    avatar_paths: list[str] = []
    try:
        photo_result = await db.execute(
            text("SELECT photo_path FROM career_profiles WHERE user_id = :uid"),
            {"uid": uid_str},
        )
        avatar_paths = [row[0] for row in photo_result.all() if row[0]]
    except Exception:  # career_profiles is Supabase-managed; never block deletion
        logger.warning("Could not read career_profiles.photo_path for %s", uid_str)

    # ── Delete the auth user (revokes sign-in immediately) ──────────────────
    try:
        _supabase().auth.admin.delete_user(uid_str)
    except Exception:
        logger.exception("Failed to delete Supabase auth user %s", uid_str)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not delete your account. Please try again or contact support.",
        )

    # ── Wipe application data. prep_questions rows go via their FK's
    #    ON DELETE CASCADE off tailoring_sessions (enforced by Postgres,
    #    ORM cascade not required for a Core bulk delete). ────────────────────
    for model in (
        CoverLetter,
        TailoringSession,
        JobDescription,
        Resume,
        LearningItem,
        ExternalContact,
        AiUsageEvent,
        Subscription,
        ResumeDeletionLog,
    ):
        await db.execute(delete(model).where(model.user_id == uid))

    # career_profiles lives outside this backend's ORM models — it's written
    # directly from the frontend via the Supabase client — but it's the same
    # physical Postgres database, so a raw DELETE finishes the job.
    await db.execute(
        text("DELETE FROM career_profiles WHERE user_id = :uid"), {"uid": uid_str}
    )
    await db.commit()
    logger.info("account_deleted user_id=%s", uid_str)

    # ── Best-effort storage cleanup — the account is already gone regardless ─
    if storage_paths:
        try:
            _supabase().storage.from_("resumes").remove(storage_paths)
        except Exception:
            logger.warning("Failed to remove resume storage objects for %s", uid_str)
    if avatar_paths:
        try:
            _supabase().storage.from_("avatars").remove(avatar_paths)
        except Exception:
            logger.warning("Failed to remove avatar storage objects for %s", uid_str)

    return Response(status_code=status.HTTP_204_NO_CONTENT)

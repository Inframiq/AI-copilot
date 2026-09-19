"""Requests to delete personal data, from anyone, signed in or not.

A signed-in user deletes their own account from the Account page, and that
takes effect immediately. This is for everyone who can't do that: a former
user locked out of their Google account, or someone who never signed up but
whose details a user entered. Because anyone can send one, a request only
records what was asked. An admin confirms who is asking before deleting
anything, and records the outcome.
"""
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.rate_limit import limiter
from app.core.security import require_admin
from app.core.supabase_admin import list_all_auth_users
from app.db.models import DeletionRequest
from app.db.session import get_db
from app.schemas.deletion_request import (
    DeletionRequestAdminOut,
    DeletionRequestIn,
    DeletionRequestUpdate,
)

router = APIRouter(prefix="/data-requests", tags=["data-requests"])
# Under /admin so an admin-only account (see main.py) can reach it.
admin_router = APIRouter(prefix="/admin/deletion-requests", tags=["admin"])
logger = logging.getLogger("app")


@router.post("/deletion", status_code=status.HTTP_202_ACCEPTED)
@limiter.limit("5/hour")
async def request_deletion(
    request: Request, body: DeletionRequestIn, db: AsyncSession = Depends(get_db)
):
    """Record a deletion request. No sign-in: the people this is for often
    can't. Answers the same way whether or not it was stored, so the
    response says nothing about who has an account."""
    if body.website:
        # The hidden field was filled in, so a bot sent this. Pretend it worked.
        return Response(status_code=status.HTTP_202_ACCEPTED)
    db.add(DeletionRequest(
        email=body.email.strip().lower(),
        name=(body.name or "").strip() or None,
        requester_type=body.requester_type,
        details=(body.details or "").strip() or None,
    ))
    await db.commit()
    logger.info("deletion_request_received requester_type=%s", body.requester_type)
    return Response(status_code=status.HTTP_202_ACCEPTED)


def _emails_with_accounts() -> set[str]:
    try:
        return {(u.email or "").lower() for u in list_all_auth_users() if u.email}
    except Exception:
        logger.warning("Could not list auth users for deletion requests", exc_info=True)
        return set()


def _admin_out(item: DeletionRequest, emails: set[str]) -> DeletionRequestAdminOut:
    return DeletionRequestAdminOut(
        id=item.id,
        email=item.email,
        name=item.name,
        requester_type=item.requester_type,
        details=item.details,
        status=item.status,
        resolution_note=item.resolution_note,
        created_at=item.created_at,
        resolved_at=item.resolved_at,
        has_account=item.email.lower() in emails,
    )


@admin_router.get("", response_model=list[DeletionRequestAdminOut])
async def list_deletion_requests(user=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Every request, open ones first, then newest first."""
    result = await db.execute(
        select(DeletionRequest).order_by(
            (DeletionRequest.status != "open"), DeletionRequest.created_at.desc()
        )
    )
    emails = _emails_with_accounts()
    return [_admin_out(item, emails) for item in result.scalars().all()]


@admin_router.patch("/{request_id}", response_model=DeletionRequestAdminOut)
async def update_deletion_request(
    request_id: uuid.UUID,
    body: DeletionRequestUpdate,
    user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Record what was done about a request."""
    item = await db.get(DeletionRequest, request_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Request not found")
    item.status = body.status
    item.resolution_note = (body.resolution_note or "").strip() or None
    item.resolved_at = None if body.status == "open" else datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(item)
    return _admin_out(item, _emails_with_accounts())

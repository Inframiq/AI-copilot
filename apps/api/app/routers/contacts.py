import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db
from app.db.models import ExternalContact
from app.core.security import get_current_user
from app.schemas.contacts import ExternalContactIn, ExternalContactOut, ExternalContactStatusUpdate

router = APIRouter(prefix="/contacts", tags=["contacts"])


@router.get("", response_model=list[ExternalContactOut])
async def list_contacts(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ExternalContact)
        .where(ExternalContact.user_id == uuid.UUID(user["sub"]))
        .order_by(ExternalContact.created_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=ExternalContactOut, status_code=201)
async def create_contact(
    body: ExternalContactIn, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    contact = ExternalContact(
        user_id=uuid.UUID(user["sub"]),
        name=body.name,
        role=body.role,
        company=body.company,
        status=body.status,
        notes=body.notes,
        email=body.email,
        linkedin_url=body.linkedin_url,
        last_contact=datetime.now(timezone.utc),
    )
    db.add(contact)
    await db.commit()
    await db.refresh(contact)
    return contact


@router.patch("/{contact_id}/status", response_model=ExternalContactOut)
async def update_contact_status(
    contact_id: uuid.UUID,
    body: ExternalContactStatusUpdate,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ExternalContact).where(
            ExternalContact.id == contact_id, ExternalContact.user_id == uuid.UUID(user["sub"])
        )
    )
    contact = result.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    contact.status = body.status
    await db.commit()
    await db.refresh(contact)
    return contact


@router.delete("/{contact_id}", status_code=204)
async def delete_contact(
    contact_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(ExternalContact).where(
            ExternalContact.id == contact_id, ExternalContact.user_id == uuid.UUID(user["sub"])
        )
    )
    contact = result.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    await db.delete(contact)
    await db.commit()

import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db
from app.db.models import Resume
from app.core.security import get_current_user
from app.schemas.resume import ResumeCreate, ResumeUpdate, ResumeOut
from app.services.pdf import generate_pdf, upload_pdf, get_signed_url
from supabase import create_client
from app.core.config import settings

router = APIRouter(prefix="/resumes", tags=["resumes"])


def _supabase():
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


@router.get("", response_model=list[ResumeOut])
async def list_resumes(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Resume).where(Resume.user_id == uuid.UUID(user["sub"])))
    return result.scalars().all()


@router.post("", response_model=ResumeOut, status_code=status.HTTP_201_CREATED)
async def create_resume(body: ResumeCreate, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    resume = Resume(user_id=uuid.UUID(user["sub"]), **body.model_dump())
    db.add(resume)
    await db.commit()
    await db.refresh(resume)
    return resume


@router.get("/{resume_id}", response_model=ResumeOut)
async def get_resume(resume_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Resume).where(Resume.id == resume_id, Resume.user_id == uuid.UUID(user["sub"]))
    )
    resume = result.scalar_one_or_none()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    return resume


@router.patch("/{resume_id}", response_model=ResumeOut)
async def update_resume(
    resume_id: uuid.UUID,
    body: ResumeUpdate,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Resume).where(Resume.id == resume_id, Resume.user_id == uuid.UUID(user["sub"]))
    )
    resume = result.scalar_one_or_none()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(resume, field, value)
    await db.commit()
    await db.refresh(resume)
    return resume


@router.delete("/{resume_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_resume(resume_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Resume).where(Resume.id == resume_id, Resume.user_id == uuid.UUID(user["sub"]))
    )
    resume = result.scalar_one_or_none()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    await db.delete(resume)
    await db.commit()


@router.post("/{resume_id}/pdf")
async def generate_resume_pdf(
    resume_id: uuid.UUID,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Resume).where(Resume.id == resume_id, Resume.user_id == uuid.UUID(user["sub"]))
    )
    resume = result.scalar_one_or_none()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    pdf_bytes = generate_pdf(resume.content, resume.template_id)
    sb = _supabase()
    path = await upload_pdf(pdf_bytes, str(user["sub"]), str(resume_id), sb)
    resume.pdf_url = path
    await db.commit()
    signed_url = get_signed_url(path, sb)
    return {"signed_url": signed_url, "expires_in": 3600}

import asyncio
import base64
import uuid
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db, AsyncSessionLocal
from app.db.models import Resume
from app.core.security import get_current_user
from app.core.rate_limit import limiter
from app.schemas.resume import ResumeCreate, ResumeUpdate, ResumeOut, PdfGenerateRequest
from app.services.pdf import generate_pdf, upload_pdf
from app.services.resume_parser import extract_text, parse_resume_text
from app.services.ai_engine.factory import get_ai_provider
from supabase import create_client
from app.core.config import settings

router = APIRouter(prefix="/resumes", tags=["resumes"])

_PARSE_TIMEOUT_SECONDS = 15

# Singleton Supabase service-role client — one connection pool per process
_sb_client = None


def _supabase():
    global _sb_client
    if _sb_client is None:
        _sb_client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    return _sb_client


# Allowed upload MIME types and their magic byte signatures
_ALLOWED_MIME = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
_MAGIC: list[tuple[bytes, str]] = [
    (b"%PDF", "pdf"),
    (b"PK\x03\x04", "docx"),
]

_VALID_TEMPLATES = {"ats_clean", "ats_modern", "ats_professional", "ats_minimal"}


def _check_magic_bytes(data: bytes) -> None:
    """Raise ValueError if the file doesn't start with a recognised magic sequence."""
    for magic, _ in _MAGIC:
        if data[: len(magic)] == magic:
            return
    raise ValueError("Unrecognised file format — only PDF and DOCX are supported.")


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


async def _persist_pdf_to_storage(pdf_bytes: bytes, user_id: str, resume_id: uuid.UUID) -> None:
    """Upload the rendered PDF and record its storage path, off the request path.

    Runs as a FastAPI background task after the response has already been sent,
    so it uses its own DB session rather than the (possibly closed) request-scoped
    one from get_db().
    """
    sb = _supabase()
    path = await upload_pdf(pdf_bytes, user_id, str(resume_id), sb)
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Resume).where(Resume.id == resume_id))
        resume = result.scalar_one_or_none()
        if resume:
            resume.pdf_url = path
            await session.commit()


@router.post("/{resume_id}/pdf")
@limiter.limit("10/minute")
async def generate_resume_pdf(
    request: Request,
    resume_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    body: PdfGenerateRequest | None = None,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Resume).where(Resume.id == resume_id, Resume.user_id == uuid.UUID(user["sub"]))
    )
    resume = result.scalar_one_or_none()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    template_id = (body.template_id if body else None) or resume.template_id
    if template_id not in _VALID_TEMPLATES:
        raise HTTPException(status_code=400, detail="Invalid template_id.")
    if template_id != resume.template_id:
        resume.template_id = template_id
        await db.commit()
    # WeasyPrint layout/rasterization is synchronous CPU work — offload it so it
    # doesn't block every other concurrent request (including autosave PATCHes)
    # on this worker for the duration of rendering.
    pdf_bytes = await asyncio.to_thread(generate_pdf, resume.content, template_id)
    # Hand the bytes straight back as a data URI so the browser can render the
    # preview immediately — the client no longer waits on a Supabase upload +
    # signed-URL round trip before it can show anything. Storage persistence
    # (for future re-download without re-rendering) happens after the response.
    background_tasks.add_task(_persist_pdf_to_storage, pdf_bytes, str(user["sub"]), resume_id)
    data_url = f"data:application/pdf;base64,{base64.b64encode(pdf_bytes).decode('ascii')}"
    return {"signed_url": data_url, "expires_in": None}


@router.post("/parse-upload", response_model=ResumeOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def parse_and_create_resume(
    request: Request,
    file: UploadFile = File(...),
    template_id: str = Form("ats_clean"),
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a PDF or DOCX resume, parse it with AI, and create a new Resume row."""
    if template_id not in _VALID_TEMPLATES:
        raise HTTPException(status_code=400, detail="Invalid template_id.")

    content_type = file.content_type or ""
    if content_type not in _ALLOWED_MIME and not (
        file.filename or ""
    ).lower().endswith((".pdf", ".docx", ".doc")):
        raise HTTPException(status_code=400, detail="Only PDF and DOCX files are supported.")

    raw_bytes = await file.read()

    if len(raw_bytes) > 10 * 1024 * 1024:  # 10 MB guard
        raise HTTPException(status_code=400, detail="File must be smaller than 10 MB.")

    # Magic byte check — prevents content-type spoofing
    try:
        _check_magic_bytes(raw_bytes)
    except ValueError:
        raise HTTPException(status_code=400, detail="Only PDF and DOCX files are supported.")

    try:
        # Run off the event loop with a hard deadline — a pathologically
        # crafted PDF/DOCX can make parsing take a long time, and this call
        # is synchronous CPU work that would otherwise block every other
        # concurrent request on this worker for its duration.
        raw_text = await asyncio.wait_for(
            asyncio.to_thread(extract_text, raw_bytes, content_type or file.filename or ""),
            timeout=_PARSE_TIMEOUT_SECONDS,
        )
    except ValueError as exc:
        # Surface user-facing constraint violations (e.g. page count exceeded)
        raise HTTPException(status_code=422, detail=str(exc))
    except asyncio.TimeoutError:
        raise HTTPException(status_code=422, detail="File took too long to process.")
    except Exception:
        raise HTTPException(status_code=422, detail="Could not extract text from the file.")

    if not raw_text.strip():
        raise HTTPException(status_code=422, detail="No text could be extracted from the file.")

    provider = get_ai_provider()
    parsed = await parse_resume_text(raw_text, provider)

    # Derive a sensible title from the candidate's name
    name = parsed.get("contact", {}).get("name", "").strip()
    title = f"{name}'s Resume" if name else (file.filename or "Uploaded Resume")

    resume = Resume(
        user_id=uuid.UUID(user["sub"]),
        title=title[:255],
        template_id=template_id,
        content=parsed,
    )
    db.add(resume)
    await db.commit()
    await db.refresh(resume)
    return resume

import asyncio
import base64
import logging
import uuid
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from app.db.session import get_db, AsyncSessionLocal
from app.db.models import Resume, JobDescription, ResumeDeletionLog
from app.core.security import get_current_user
from app.core.rate_limit import limiter
from app.schemas.resume import ResumeCreate, ResumeUpdate, ResumeOut, PdfGenerateRequest, OriginalFileOut
from app.schemas.ai import GenerateResumeRequest, GenerateResumeOut
from app.services.pdf import generate_pdf, upload_pdf, get_signed_url
from app.services.resume_parser import extract_text, parse_resume_text
from app.services.resume_generator import generate_resume
from app.services.ai_engine.factory import get_ai_provider
from supabase import create_client
from app.core.config import settings

router = APIRouter(prefix="/resumes", tags=["resumes"])
logger = logging.getLogger("app")

_PARSE_TIMEOUT_SECONDS = 15

# Singleton Supabase service-role client — one connection pool per process
_sb_client = None


def _supabase():
    global _sb_client
    if _sb_client is None:
        _sb_client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    return _sb_client


# Upload only accepts PDF — the uploaded file is stored untouched as the
# user's master copy and shown verbatim in Preview, so there's no DOCX/DOC
# conversion path (and no need for a LibreOffice dependency). Users with a
# DOCX resume convert it to PDF themselves before uploading.
_ALLOWED_MIME = {"application/pdf"}
_MAGIC: list[tuple[bytes, str]] = [
    (b"%PDF", "pdf"),
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
    uid = uuid.UUID(user["sub"])
    payload = body.model_dump(exclude={"jd_id"})

    jd = None
    if body.jd_id:
        result = await db.execute(
            select(JobDescription).where(JobDescription.id == body.jd_id, JobDescription.user_id == uid)
        )
        jd = result.scalar_one_or_none()
        if not jd:
            raise HTTPException(status_code=404, detail="JD not found")
        # A resume is already linked to this JD (e.g. a previous "Save as
        # new") — overwrite it in place instead of creating another row, so
        # re-tailoring the same JD and saving again doesn't pile up
        # duplicate resumes.
        if jd.tailored_resume_id:
            result = await db.execute(
                select(Resume).where(Resume.id == jd.tailored_resume_id, Resume.user_id == uid)
            )
            existing = result.scalar_one_or_none()
            if existing:
                for field, value in payload.items():
                    setattr(existing, field, value)
                await db.commit()
                await db.refresh(existing)
                return existing

    resume = Resume(user_id=uid, **payload)
    db.add(resume)
    await db.commit()
    await db.refresh(resume)
    if jd:
        jd.tailored_resume_id = resume.id
        await db.commit()
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


@router.get("/{resume_id}/original", response_model=OriginalFileOut)
async def get_original_resume_file(
    resume_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Signed URL for the untouched file the user uploaded — Preview's source
    of truth when one exists, instead of the AI-parsed/templated version."""
    result = await db.execute(
        select(Resume).where(Resume.id == resume_id, Resume.user_id == uuid.UUID(user["sub"]))
    )
    resume = result.scalar_one_or_none()
    if not resume or not resume.original_file_path:
        raise HTTPException(status_code=404, detail="No original file for this resume")
    signed_url = get_signed_url(resume.original_file_path, _supabase())
    return OriginalFileOut(signed_url=signed_url, file_name=resume.original_file_name)


@router.get("/{resume_id}/pdf", response_model=OriginalFileOut)
async def get_latest_resume_pdf(
    resume_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Signed URL for the most recently generated PDF, if this resume has
    one — a cheap storage lookup, not a re-render. Lets Studio show a saved
    resume's existing preview the moment it's opened instead of presenting
    "No PDF generated yet" for a resume that plainly already has one; the
    user can still hit Generate/Regenerate PDF (POST to this same path) at
    any time to render fresh content. 404 (not an empty/null body) when
    nothing has ever been generated, so the frontend can tell "never
    generated" apart from "the lookup itself failed" the same way it
    already does for /original."""
    result = await db.execute(
        select(Resume).where(Resume.id == resume_id, Resume.user_id == uuid.UUID(user["sub"]))
    )
    resume = result.scalar_one_or_none()
    if not resume or not resume.pdf_url:
        raise HTTPException(status_code=404, detail="No PDF generated yet for this resume")
    signed_url = get_signed_url(resume.pdf_url, _supabase())
    return OriginalFileOut(signed_url=signed_url, file_name=None)


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

    # Snapshot whether this resume was the user's linked master resume BEFORE
    # nulling that reference below, so the audit log answers "was this the
    # one my profile pointed at" directly instead of requiring a timestamp
    # cross-reference after the fact — exactly what took a live-debugging
    # session to reconstruct the last time this happened.
    master_check = await db.execute(
        text("SELECT 1 FROM career_profiles WHERE user_id = :uid AND master_resume_id = :rid"),
        {"uid": str(resume.user_id), "rid": str(resume_id)},
    )
    was_master_resume = master_check.first() is not None

    db.add(ResumeDeletionLog(
        resume_id=resume_id,
        user_id=resume.user_id,
        title=resume.title,
        was_master_resume=was_master_resume,
    ))

    # Captured before delete/commit — accessing ORM attributes on `resume`
    # after that point isn't reliable.
    storage_paths = [p for p in (resume.original_file_path, resume.pdf_url) if p]

    await db.delete(resume)
    # career_profiles lives outside this backend's ORM models — it's written
    # directly from the frontend via the Supabase client (lib/career-profile-
    # client.ts) — but it's the same physical Postgres database, so a raw
    # UPDATE here keeps its master_resume_id from dangling once this resume
    # is gone. Without this, the Profile page's fetch of that id 404s, gets
    # silently swallowed, and renders identically to "never uploaded a
    # resume" even though the user's career profile data is still intact.
    await db.execute(
        text("UPDATE career_profiles SET master_resume_id = NULL WHERE master_resume_id = :rid"),
        {"rid": str(resume_id)},
    )
    await db.commit()
    logger.info(
        "resume_deleted resume_id=%s user_id=%s title=%r was_master_resume=%s",
        resume_id, resume.user_id, resume.title, was_master_resume,
    )

    # Best-effort — the resume row is already gone regardless of whether
    # this succeeds. Without this, every deleted resume's PDF and original
    # upload sit in Supabase Storage forever with nothing pointing at them.
    if storage_paths:
        try:
            _supabase().storage.from_("resumes").remove(storage_paths)
        except Exception:
            logger.warning(
                "Failed to remove storage objects for deleted resume %s: %s",
                resume_id, storage_paths,
            )


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
    is_preview = body is not None and body.content is not None
    # template_id and the spacing prefs all persist onto the resume the same
    # way — a direct "how this resume renders" setting change, not tied to
    # any one render — except during a content-override preview, where nothing
    # persists (the resume's own saved content isn't even what's rendering).
    if not is_preview:
        changed = False
        if template_id != resume.template_id:
            resume.template_id = template_id
            changed = True
        if body and body.line_spacing is not None and body.line_spacing != resume.line_spacing:
            resume.line_spacing = body.line_spacing
            changed = True
        if body and body.paragraph_spacing is not None and body.paragraph_spacing != resume.paragraph_spacing:
            resume.paragraph_spacing = body.paragraph_spacing
            changed = True
        if changed:
            await db.commit()
    content = body.content if is_preview else resume.content
    # WeasyPrint layout/rasterization is synchronous CPU work — offload it so it
    # doesn't block every other concurrent request (including autosave PATCHes)
    # on this worker for the duration of rendering.
    pdf_bytes = await asyncio.to_thread(
        generate_pdf, content, template_id, resume.line_spacing, resume.paragraph_spacing
    )
    # Hand the bytes straight back as a data URI so the browser can render the
    # preview immediately — the client no longer waits on a Supabase upload +
    # signed-URL round trip before it can show anything. Storage persistence
    # (for future re-download without re-rendering) happens after the response,
    # and only for the resume's actually-saved content — an unsaved preview
    # (e.g. AI tailoring the user hasn't accepted) must never overwrite the
    # stored pdf_url with content that isn't in resume.content yet.
    if not is_preview:
        background_tasks.add_task(_persist_pdf_to_storage, pdf_bytes, str(user["sub"]), resume_id)
    data_url = f"data:application/pdf;base64,{base64.b64encode(pdf_bytes).decode('ascii')}"
    return {"signed_url": data_url, "expires_in": None}


@router.post("/generate", response_model=GenerateResumeOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def generate_resume_endpoint(
    request: Request,
    response: Response,
    body: GenerateResumeRequest,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate a full, spec-compliant resume from a raw candidate profile —
    relevance-filtered, evidence-bound, and validated/compressed against the
    hard content limits in resume_spec.py. See services/resume_generator.py."""
    if body.template_id not in _VALID_TEMPLATES:
        raise HTTPException(status_code=400, detail="Invalid template_id.")

    existing: Resume | None = None
    if body.resume_id is not None:
        result = await db.execute(
            select(Resume).where(Resume.id == body.resume_id, Resume.user_id == uuid.UUID(user["sub"]))
        )
        existing = result.scalar_one_or_none()
        if existing is None:
            raise HTTPException(status_code=404, detail="Resume not found")

    provider = get_ai_provider()
    generated = await generate_resume(
        body.profile,
        body.candidate_type,
        provider,
        target_role=body.target_role,
        jd_text=body.jd_text,
        template_id=body.template_id,
    )

    name = (generated.resume_content.get("contact") or {}).get("name", "").strip()
    title = body.title or (f"{name}'s Resume" if name else "Generated Resume")

    if existing is not None:
        existing.title = title[:255]
        existing.template_id = body.template_id
        existing.content = generated.resume_content
        await db.commit()
        await db.refresh(existing)
        resume = existing
        response.status_code = status.HTTP_200_OK
    else:
        resume = Resume(
            user_id=uuid.UUID(user["sub"]),
            title=title[:255],
            template_id=body.template_id,
            content=generated.resume_content,
        )
        db.add(resume)
        await db.commit()
        await db.refresh(resume)

    return GenerateResumeOut(
        resume_id=resume.id,
        content=generated.resume_content,
        template_id=body.template_id,
        valid=generated.validation.valid,
        violations=generated.validation.to_dict()["violations"],
    )


@router.post("/parse-upload", response_model=ResumeOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def parse_and_create_resume(
    request: Request,
    response: Response,
    file: UploadFile = File(...),
    template_id: str = Form("ats_clean"),
    # When set (the Profile page's "Replace" flow), the parsed content
    # overwrites this existing resume in place instead of creating a new,
    # orphaned row — otherwise every re-upload left the old resume dangling
    # and callers that pick "the" resume by id could keep resolving to it.
    resume_id: uuid.UUID | None = Form(None),
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a PDF or DOCX resume, parse it with AI, and create (or replace) a Resume row."""
    if template_id not in _VALID_TEMPLATES:
        raise HTTPException(status_code=400, detail="Invalid template_id.")

    existing_resume: Resume | None = None
    if resume_id is not None:
        result = await db.execute(
            select(Resume).where(Resume.id == resume_id, Resume.user_id == uuid.UUID(user["sub"]))
        )
        existing_resume = result.scalar_one_or_none()
        if existing_resume is None:
            raise HTTPException(status_code=404, detail="Resume not found")

    content_type = file.content_type or ""
    if content_type not in _ALLOWED_MIME and not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported. Convert your resume to PDF and re-upload.")

    raw_bytes = await file.read()

    if len(raw_bytes) > 10 * 1024 * 1024:  # 10 MB guard
        raise HTTPException(status_code=400, detail="File must be smaller than 10 MB.")

    # Magic byte check — prevents content-type spoofing
    try:
        _check_magic_bytes(raw_bytes)
    except ValueError:
        raise HTTPException(status_code=400, detail="Only PDF files are supported. Convert your resume to PDF and re-upload.")

    # Fixed up front (rather than left to the DB default) so the original file
    # can be uploaded to its final storage path before the Resume row exists.
    resume_id = existing_resume.id if existing_resume is not None else uuid.uuid4()

    # Store the untouched original — this is the user's master copy, shown
    # verbatim in Preview. Synchronous and required (unlike the best-effort
    # background upload used for generated preview PDFs): if this fails, the
    # whole upload fails rather than leaving a Resume row with no master file.
    original_path = f"resumes/{user['sub']}/{resume_id}/original.pdf"
    try:
        _supabase().storage.from_("resumes").upload(
            original_path, raw_bytes, {"content-type": "application/pdf", "upsert": "true"}
        )
    except Exception:
        raise HTTPException(status_code=502, detail="Could not store the uploaded file. Please try again.")

    try:
        # Run off the event loop with a hard deadline — a pathologically
        # crafted PDF can make parsing take a long time, and this call is
        # synchronous CPU work that would otherwise block every other
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

    if existing_resume is not None:
        existing_resume.title = title[:255]
        existing_resume.template_id = template_id
        existing_resume.content = parsed
        existing_resume.original_file_path = original_path
        existing_resume.original_file_name = file.filename
        await db.commit()
        await db.refresh(existing_resume)
        response.status_code = status.HTTP_200_OK
        return existing_resume

    resume = Resume(
        id=resume_id,
        user_id=uuid.UUID(user["sub"]),
        title=title[:255],
        template_id=template_id,
        content=parsed,
        original_file_path=original_path,
        original_file_name=file.filename,
    )
    db.add(resume)
    await db.commit()
    await db.refresh(resume)
    return resume

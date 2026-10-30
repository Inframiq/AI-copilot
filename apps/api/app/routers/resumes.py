import asyncio
import base64
import logging
import uuid
from datetime import timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text, update
from app.db.session import get_db, AsyncSessionLocal
from app.db.models import Resume, JobDescription, ResumeDeletionLog
from app.core.security import get_current_user
from app.core.rate_limit import ai_global_limit, limiter
from app.core.credits import spend_credits, refund_credits
from app.schemas.resume import (
    ResumeCreate, ResumeUpdate, ResumeOut, UploadedResumeOut, UnplacedSection, PdfGenerateRequest,
    OriginalFileOut,
)
from app.schemas.ai import GenerateResumeRequest, GenerateResumeOut
from app.services.pdf import (
    generate_pdf, generate_pdf_with_meta, upload_pdf, get_signed_url,
    render_resume_html_with_meta, PhotoRequiredError, photo_owned_by,
)
from app.services.resume_parser import ResumeUnreadable, parse_resume_text
from app.services import sandbox
from app.services.resume_generator import generate_resume
from app.services.ai_engine.factory import get_ai_provider
from supabase import create_client
from app.core.config import settings

router = APIRouter(prefix="/resumes", tags=["resumes"])
logger = logging.getLogger("app")

# Singleton Supabase service-role client — one connection pool per process
_sb_client = None


def _supabase():
    global _sb_client
    if _sb_client is None:
        _sb_client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    return _sb_client


def _remove_stored_file(path: str) -> None:
    """Best effort: a file left behind is wasted space, never a broken
    résumé, so a failure here is logged rather than raised."""
    try:
        _supabase().storage.from_("resumes").remove([path])
    except Exception:
        logger.warning("could not remove stored file %s", path, exc_info=True)


_MAX_RESUMES_PER_USER = 5


async def _ensure_room_for_a_new_resume(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Refuse (409) to create a résumé past _MAX_RESUMES_PER_USER — never
    delete one to make room. The oldest unprotected résumé used to be deleted
    silently, and people lost work without being asked.

    The refusal carries what the web app's popup needs to ask instead: every
    résumé (newest first) with whether it's the profile's main résumé or the
    one saved for a JD, how many must go (more than one for anyone already
    over the limit — protected résumés were never evicted), and which would
    have gone (the oldest unprotected). The user exports or picks, the app
    deletes through DELETE /resumes/{id}, then retries the create.

    Called before any credits are charged, so a refusal costs nothing.
    """
    rows = (
        await db.execute(
            select(Resume.id, Resume.title, Resume.updated_at, Resume.template_id)
            .where(Resume.user_id == user_id)
            .order_by(Resume.updated_at.desc())
        )
    ).all()
    if len(rows) < _MAX_RESUMES_PER_USER:
        return

    master = (
        await db.execute(
            text(
                "SELECT master_resume_id FROM career_profiles "
                "WHERE user_id = :uid AND master_resume_id IS NOT NULL"
            ),
            {"uid": str(user_id)},
        )
    ).scalar_one_or_none()
    master_id = uuid.UUID(str(master)) if master else None
    jd_for: dict[uuid.UUID, str] = {
        rid: title
        for rid, title in (
            await db.execute(
                select(JobDescription.tailored_resume_id, JobDescription.title).where(
                    JobDescription.user_id == user_id,
                    JobDescription.tailored_resume_id.isnot(None),
                )
            )
        ).all()
    }

    need = len(rows) - _MAX_RESUMES_PER_USER + 1
    oldest_first = list(reversed(rows))
    unprotected = [r.id for r in oldest_first if r.id != master_id and r.id not in jd_for]
    protected = [r.id for r in oldest_first if r.id == master_id or r.id in jd_for]
    suggested = (unprotected + protected)[:need]

    raise HTTPException(
        status_code=409,
        detail={
            "code": "resume_limit",
            "message": (
                f"You can keep up to {_MAX_RESUMES_PER_USER} résumés. "
                + ("Delete one" if need == 1 else f"Delete {need}")
                + " to add another."
            ),
            "limit": _MAX_RESUMES_PER_USER,
            "need": need,
            "suggested": [str(i) for i in suggested],
            "resumes": [
                {
                    "id": str(r.id),
                    "title": r.title,
                    "updated_at": r.updated_at.isoformat() if r.updated_at else None,
                    "template_id": r.template_id,
                    "is_master": r.id == master_id,
                    "jd_title": jd_for.get(r.id),
                }
                for r in rows
            ],
        },
    )


async def _claim_room_for_a_new_resume(db: AsyncSession, user_id: uuid.UUID) -> None:
    """_ensure_room_for_a_new_resume, made safe for requests sent together:
    called in the transaction that inserts the résumé, it holds this user's
    résumé count still until that commits. Unlocked, several creates sent at
    once with four résumés all counted four and all went in (test ATK-038);
    now each waits its turn and the one past the limit is refused. Callers
    that run a model first still check up front, so a refusal is usually
    free, and refund if this later check refuses."""
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"kripax:resumes:{user_id}"},
    )
    await _ensure_room_for_a_new_resume(db, user_id)


async def _is_master_resume(db: AsyncSession, user_id: uuid.UUID, resume_id: uuid.UUID) -> bool:
    """Whether career_profiles.master_resume_id points at this résumé."""
    result = await db.execute(
        text("SELECT 1 FROM career_profiles WHERE user_id = :uid AND master_resume_id = :rid"),
        {"uid": str(user_id), "rid": str(resume_id)},
    )
    return result.first() is not None


async def _dedupe_title(db: AsyncSession, user_id: uuid.UUID, base_title: str) -> str:
    """Appends "(2)", "(3)", ... when base_title collides with one of this
    user's existing resume titles — otherwise every upload/generate of the
    same underlying resume (re-uploading the same PDF, regenerating from the
    same profile) produces an identically-titled row with no way to tell
    them apart in a list."""
    existing = (
        await db.execute(select(Resume.title).where(Resume.user_id == user_id))
    ).scalars().all()
    if base_title not in existing:
        return base_title
    existing_set = set(existing)
    n = 2
    while f"{base_title} ({n})" in existing_set:
        n += 1
    return f"{base_title} ({n})"


# Upload only accepts PDF — the uploaded file is stored untouched as the
# user's master copy and shown verbatim in Preview, so there's no DOCX/DOC
# conversion path (and no need for a LibreOffice dependency). Users with a
# DOCX resume convert it to PDF themselves before uploading.
_ALLOWED_MIME = {"application/pdf"}
_MAX_UPLOAD_BYTES = 10 * 1024 * 1024
_MAGIC: list[tuple[bytes, str]] = [
    (b"%PDF", "pdf"),
]

_VALID_TEMPLATES = {
    "ats_clean", "ats_modern", "ats_sidebar", "ats_professional", "ats_minimal",
    "ats_executive", "ats_compact", "ats_banner", "ats_portrait", "ats_technical",
}


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
    # Saving with jd_id is what makes the JD's interview prep questions: the
    # client calls POST /jd/{jd_id}/prep-questions straight after, and waits
    # on it, so every view of the questions updates the moment they exist.
    uid = uuid.UUID(user["sub"])
    payload = body.model_dump(exclude={"jd_id"})
    # The size columns are NOT NULL; None means "not chosen", which the
    # column default already encodes. Passing it through writes a NULL.
    for field in ("heading_size_delta", "body_size_delta"):
        if payload.get(field) is None:
            payload.pop(field, None)

    jd = None
    if body.jd_id:
        # Locked until this save commits: Save and Export pressed together, or
        # Save twice, send two of these at once. Unlocked, both saw no linked
        # résumé and made one each; now the second waits, then finds the
        # first's résumé linked and updates it.
        result = await db.execute(
            select(JobDescription)
            .where(JobDescription.id == body.jd_id, JobDescription.user_id == uid)
            .with_for_update()
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
            # Never overwrite the profile's master résumé, even if an older
            # flow linked it to this JD: a tailored save goes to its own row,
            # and the link moves to that row below.
            if existing and await _is_master_resume(db, uid, existing.id):
                existing = None
            if existing:
                for field, value in payload.items():
                    setattr(existing, field, value)
                await db.commit()
                await db.refresh(existing)
                return existing

    await _claim_room_for_a_new_resume(db, uid)
    resume = Resume(user_id=uid, **payload)
    db.add(resume)
    # One commit for the résumé and the JD's link to it: committing the
    # résumé first released the JD lock before the link existed, and a
    # failure in between left a résumé the JD didn't know about.
    await db.flush()
    if jd:
        jd.tailored_resume_id = resume.id
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
    # Locked, so two saves made from the same version can't both pass the
    # check below: the second waits, then sees the first's updated_at.
    result = await db.execute(
        select(Resume)
        .where(Resume.id == resume_id, Resume.user_id == uuid.UUID(user["sub"]))
        .with_for_update()
    )
    resume = result.scalar_one_or_none()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    expected = body.expected_updated_at
    if expected is not None:
        if expected.tzinfo is None:
            expected = expected.replace(tzinfo=timezone.utc)
        if resume.updated_at != expected:
            # Another device saved since this one loaded the résumé. Its
            # updated_at goes back so "keep mine" can save over exactly that.
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "resume_changed",
                    "message": "This résumé was changed on another device.",
                    "updated_at": resume.updated_at.isoformat(),
                },
            )
    for field, value in body.model_dump(exclude_none=True, exclude={"expected_updated_at"}).items():
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
        # No title: the log outlives the resume, and a title is often the
        # user's name. The ids answer "who deleted what, when" without it.
        title="",
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
        "resume_deleted resume_id=%s user_id=%s was_master_resume=%s",
        resume_id, resume.user_id, was_master_resume,
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
        # updated_at set to itself: a cached export isn't an edit. Bumping it
        # would make the device's next autosave look stale (see update_resume)
        # and reorder the résumé list on a download.
        result = await session.execute(
            update(Resume)
            .where(Resume.id == resume_id)
            .values(pdf_url=path, updated_at=Resume.updated_at)
        )
        await session.commit()
    if result.rowcount == 0:
        # Deleted while it rendered: nothing will ever point at this file.
        _remove_stored_file(path)


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
        if body and body.font_choice is not None and body.font_choice != resume.font_choice:
            resume.font_choice = body.font_choice
            changed = True
        if body and body.accent_color is not None and body.accent_color != resume.accent_color:
            resume.accent_color = body.accent_color
            changed = True
        if changed:
            await db.commit()
    # Only the user's own photo: the render reads the private bucket with the
    # service key, so a photo URL is never trusted on the content's word.
    content = photo_owned_by((body.content if is_preview else resume.content) or {}, user["sub"])
    # WeasyPrint layout/rasterization is synchronous CPU work — offload it so it
    # doesn't block every other concurrent request (including autosave PATCHes)
    # on this worker for the duration of rendering.
    # The request's own settings win over the saved row: an unsaved preview
    # (a tailored draft not yet saved to its JD) persists none of them, so
    # reading the row would export the master's layout, not the draft's.
    try:
        pdf_bytes, page_meta = await asyncio.to_thread(
            generate_pdf_with_meta,
            content,
            template_id,
            _given(body, "line_spacing", resume.line_spacing),
            _given(body, "paragraph_spacing", resume.paragraph_spacing),
            _given(body, "font_choice", resume.font_choice),
            _given(body, "accent_color", resume.accent_color),
            _given(body, "heading_size_delta", resume.heading_size_delta) or 0,
            _given(body, "body_size_delta", resume.body_size_delta) or 0,
        )
    except PhotoRequiredError as exc:
        # 409, matching the /html route. The Studio keys the "add a photo"
        # prompt off this status, and the two routes disagreeing meant the
        # same refusal raised the prompt on one path and a generic error on
        # the other.
        raise HTTPException(
            status_code=409,
            detail="This template requires a profile photo. Add one before previewing or downloading.",
        ) from exc
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
    # page_count / page_fill / underfilled drive the "resume is shorter than a
    # page" advisory banner in Studio's preview pane and the tailoring review
    # panel (both render through this endpoint).
    # updated_at: saving the template or spacing above moves the résumé's
    # version, and the device must carry the new one or its next autosave is
    # refused as stale.
    return {
        "signed_url": data_url, "expires_in": None, **page_meta,
        "updated_at": resume.updated_at.isoformat() if resume.updated_at else None,
    }


def _given(body, field: str, saved):
    """The request's value for *field*, falling back to *saved* only when the
    request omitted it. An explicit 0 or "" is a value, not an omission."""
    value = getattr(body, field, None) if body else None
    return saved if value is None else value


@router.post("/{resume_id}/html")
@limiter.limit("30/minute")
async def render_resume_html_endpoint(
    request: Request,
    resume_id: uuid.UUID,
    body: PdfGenerateRequest | None = None,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The document the Studio edits in place.

    Same template path as the PDF route, so what the user edits is exactly
    what will export. Unlike that route this persists nothing and uploads
    nothing — it is a pure render, which is why its rate limit is looser.
    """
    result = await db.execute(
        select(Resume).where(Resume.id == resume_id, Resume.user_id == uuid.UUID(user["sub"]))
    )
    resume = result.scalar_one_or_none()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")

    template_id = (body.template_id if body else None) or resume.template_id
    if template_id not in _VALID_TEMPLATES:
        raise HTTPException(status_code=400, detail="Invalid template_id.")

    content = photo_owned_by(
        (body.content if body and body.content is not None else resume.content) or {}, user["sub"]
    )
    try:
        html, meta = await asyncio.to_thread(
            render_resume_html_with_meta,
            content,
            template_id,
            # `x or saved` would drop a paragraph_spacing of 0, which the
            # Studio's Custom slider can produce: the user drags it to zero
            # and the saved value silently comes back instead.
            _given(body, "line_spacing", resume.line_spacing),
            _given(body, "paragraph_spacing", resume.paragraph_spacing),
            _given(body, "font_choice", resume.font_choice),
            _given(body, "accent_color", resume.accent_color),
            _given(body, "heading_size_delta", resume.heading_size_delta),
            _given(body, "body_size_delta", resume.body_size_delta),
        )
    except PhotoRequiredError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    # photo_placeholder rides along so the Studio can say the portrait on
    # screen is a stand-in. Silence here is what would let it reach a PDF.
    return {"html": html, "photo_placeholder": meta["photo_placeholder"]}


@router.post("/generate", response_model=GenerateResumeOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
@ai_global_limit
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

    if existing is None:
        await _ensure_room_for_a_new_resume(db, uuid.UUID(user["sub"]))

    # Three model calls. The deduction is committed up front (so the
    # balance isn't held locked through them) and refunded if anything
    # after it fails.
    await spend_credits(db, uuid.UUID(user["sub"]), "generate_resume", email=user.get("email"))
    await db.commit()
    try:
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
            # Only dedupe the auto-generated fallback title — an explicit
            # body.title is the caller's deliberate choice (e.g. "Save As"),
            # same as create_jd honoring an explicit title on a content match.
            await _claim_room_for_a_new_resume(db, uuid.UUID(user["sub"]))
            final_title = title if body.title else await _dedupe_title(db, uuid.UUID(user["sub"]), title[:255])
            resume = Resume(
                user_id=uuid.UUID(user["sub"]),
                title=final_title[:255],
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
            # Computed inside generate_resume from the final content (see
            # GenerationResult.underfilled) — advisory, independent of `valid`.
            underfilled=generated.underfilled,
        )
    except Exception:
        # Charged above and committed — nothing was delivered, give it back.
        await db.rollback()
        await refund_credits(db, uuid.UUID(user["sub"]), "generate_resume", email=user.get("email"))
        await db.commit()
        raise


def _uploaded(resume: Resume, unplaced: list[dict]) -> UploadedResumeOut:
    out = UploadedResumeOut.model_validate(resume)
    out.unplaced = [UnplacedSection(**g) for g in unplaced]
    return out


@router.post("/parse-upload", response_model=UploadedResumeOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
@ai_global_limit
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

    # Kept as the résumé's file name (and its title when the parse finds no
    # name): no NUL, which the database can't store, and no longer than the
    # column. Either one used to fail the save after the parse (test ATK-029).
    file_name = (file.filename or "").replace("\x00", "")[:255] or None

    content_type = file.content_type or ""
    if content_type not in _ALLOWED_MIME and not (file_name or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported. Convert your resume to PDF and re-upload.")

    # Read one byte past the limit rather than the whole upload: a
    # multi-gigabyte file must not be pulled into memory just to be refused.
    raw_bytes = await file.read(_MAX_UPLOAD_BYTES + 1)

    if len(raw_bytes) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File must be smaller than 10 MB.")

    # Magic byte check — prevents content-type spoofing
    try:
        _check_magic_bytes(raw_bytes)
    except ValueError:
        raise HTTPException(status_code=400, detail="Only PDF files are supported. Convert your resume to PDF and re-upload.")

    if existing_resume is None:
        await _ensure_room_for_a_new_resume(db, uuid.UUID(user["sub"]))

    # A model call reads the text into fields. Charged before anything is
    # stored, so a refusal leaves no orphaned file. The deduction is
    # committed up front (so the balance isn't held locked through the
    # parse) and refunded if anything after it fails.
    await spend_credits(db, uuid.UUID(user["sub"]), "parse_resume", email=user.get("email"))
    await db.commit()
    # What the failure path has to undo (test DB-004): the file stored for
    # this upload, until the row pointing at it is committed. After that
    # commit the upload has happened; nothing is undone or refunded.
    stored_path: str | None = None
    saved = False
    try:

        # Fixed up front (rather than left to the DB default) so the original file
        # can be uploaded to its final storage path before the Resume row exists.
        resume_id = existing_resume.id if existing_resume is not None else uuid.uuid4()

        try:
            # Opened only in the sandbox (app/services/sandbox.py): a separate
            # process with none of the API's secrets, locked down and killed
            # outright on timeout — a thread could only be stopped waiting
            # for (security review M5). It also refuses a PDF carrying
            # scripts, launch actions or embedded files.
            raw_text = await asyncio.to_thread(sandbox.extract_pdf_text, raw_bytes)
        except sandbox.SandboxRejected as exc:
            # Too long, password-protected, or active content: the reason.
            raise HTTPException(status_code=422, detail=str(exc))
        except sandbox.SandboxTimeout:
            raise HTTPException(status_code=422, detail="File took too long to process.")
        except sandbox.SandboxBusy:
            raise HTTPException(status_code=503, detail="Too many uploads right now. Try again in a minute.")
        except Exception:
            logger.warning("upload text extraction failed", exc_info=True)
            raise HTTPException(status_code=422, detail="Could not extract text from the file.")

        if not raw_text.strip():
            raise HTTPException(status_code=422, detail="No text could be extracted from the file.")

        # Stored only now, once the sandbox has read it and found nothing
        # active in it — a refused file never reaches storage. This is the
        # user's master copy, shown verbatim in Preview. Synchronous and
        # required (unlike the best-effort background upload used for
        # generated preview PDFs): if this fails, the whole upload fails
        # rather than leaving a Resume row with no master file.
        # A name of its own per upload: replacing a résumé used to overwrite
        # its original.pdf before parsing, so a failed parse left the old
        # résumé showing the new file. The old file goes once the row points
        # at the new one.
        original_path = f"resumes/{user['sub']}/{resume_id}/original-{uuid.uuid4().hex}.pdf"
        try:
            _supabase().storage.from_("resumes").upload(
                original_path, raw_bytes, {"content-type": "application/pdf", "upsert": "true"}
            )
        except Exception:
            raise HTTPException(status_code=502, detail="Could not store the uploaded file. Please try again.")
        stored_path = original_path

        provider = get_ai_provider()
        try:
            parsed = await parse_resume_text(raw_text, provider)
        except ResumeUnreadable:
            logger.warning("upload parse returned unreadable output")
            raise HTTPException(
                status_code=502,
                detail="We couldn't read your résumé this time. Your credit was refunded — please try again.",
            )
        # Points printed under no job go back to the page for the profile's
        # Miscellaneous; the résumé keeps only what it printed in place.
        unplaced = parsed.pop("unplaced", [])

        # Derive a sensible title from the candidate's name
        name = parsed.get("contact", {}).get("name", "").strip()
        title = f"{name}'s Resume" if name else (file_name or "Uploaded Resume")

        if existing_resume is not None:
            previous_path = existing_resume.original_file_path
            existing_resume.title = title[:255]
            existing_resume.template_id = template_id
            existing_resume.content = parsed
            existing_resume.original_file_path = original_path
            existing_resume.original_file_name = file_name
            await db.commit()
            saved = True
            if previous_path and previous_path != original_path:
                _remove_stored_file(previous_path)
            await db.refresh(existing_resume)
            response.status_code = status.HTTP_200_OK
            return _uploaded(existing_resume, unplaced)

        await _claim_room_for_a_new_resume(db, uuid.UUID(user["sub"]))
        title = await _dedupe_title(db, uuid.UUID(user["sub"]), title[:255])
        resume = Resume(
            id=resume_id,
            user_id=uuid.UUID(user["sub"]),
            title=title[:255],
            template_id=template_id,
            content=parsed,
            original_file_path=original_path,
            original_file_name=file_name,
        )
        db.add(resume)
        await db.commit()
        saved = True
        await db.refresh(resume)
        return _uploaded(resume, unplaced)
    except Exception:
        if saved:
            raise
        # Charged above and committed — nothing was delivered: drop the file
        # stored for it and give the credit back.
        await db.rollback()
        if stored_path:
            _remove_stored_file(stored_path)
        await refund_credits(db, uuid.UUID(user["sub"]), "parse_resume", email=user.get("email"))
        await db.commit()
        raise

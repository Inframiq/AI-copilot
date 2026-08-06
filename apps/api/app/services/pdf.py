"""PDF generation service using WeasyPrint and Jinja2 templates."""

from pathlib import Path

from jinja2 import Environment, FileSystemLoader

TEMPLATES_DIR = Path(__file__).parent.parent.parent / "templates"
ALLOWED_TEMPLATES = {"ats_clean", "ats_modern"}

_jinja_env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)), autoescape=True)


def generate_pdf(resume_content: dict, template_id: str) -> bytes:
    """Render resume_content with the named template and return PDF bytes.

    Args:
        resume_content: Dict with keys: contact, experience, education, skills.
        template_id: One of "ats_clean" or "ats_modern".

    Returns:
        Raw PDF bytes (starts with b"%PDF").

    Raises:
        ValueError: If template_id is not in ALLOWED_TEMPLATES.
    """
    import weasyprint  # deferred so import errors surface as ImportError, not module-level

    if template_id not in ALLOWED_TEMPLATES:
        raise ValueError(
            f"Unknown template: {template_id!r}. Use one of {sorted(ALLOWED_TEMPLATES)}"
        )
    template = _jinja_env.get_template(f"{template_id}.html")
    html = template.render(**resume_content)
    return weasyprint.HTML(string=html).write_pdf()


async def upload_pdf(
    pdf_bytes: bytes,
    user_id: str,
    resume_id: str,
    supabase_client,
) -> str:
    """Upload PDF bytes to Supabase Storage and return the storage path.

    Args:
        pdf_bytes: Raw PDF bytes to upload.
        user_id: Owner's user UUID.
        resume_id: Resume UUID used as the filename.
        supabase_client: Initialised Supabase client.

    Returns:
        Storage path string in the format "resumes/{user_id}/{resume_id}.pdf".
    """
    path = f"resumes/{user_id}/{resume_id}.pdf"
    supabase_client.storage.from_("resumes").upload(
        path,
        pdf_bytes,
        {"content-type": "application/pdf", "upsert": "true"},
    )
    return path


def get_signed_url(
    storage_path: str,
    supabase_client,
    expires_in: int = 3600,
) -> str:
    """Generate a time-limited signed URL for a stored PDF.

    Args:
        storage_path: Path returned by upload_pdf (e.g. "resumes/uid/rid.pdf").
        supabase_client: Initialised Supabase client.
        expires_in: Seconds until the signed URL expires (default 3600).

    Returns:
        Signed URL string.
    """
    result = supabase_client.storage.from_("resumes").create_signed_url(
        storage_path, expires_in
    )
    return result["signedURL"]

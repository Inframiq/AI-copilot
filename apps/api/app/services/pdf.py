"""PDF generation service using WeasyPrint and Jinja2 templates."""

from pathlib import Path
from urllib.parse import urlparse

from jinja2 import Environment, FileSystemLoader

from app.core.config import settings

TEMPLATES_DIR = Path(__file__).parent.parent.parent / "templates"
ALLOWED_TEMPLATES = {"ats_clean", "ats_modern", "ats_sidebar", "ats_professional", "ats_minimal"}

_jinja_env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)), autoescape=True)


def _sanitize_resume_content(resume_content: dict) -> dict:
    """Strip contact.photo_url unless it points at the trusted Supabase Storage host.

    Some templates render photo_url into an <img src="..."> tag, which WeasyPrint
    fetches server-side. Since resume content is fully user-controlled, an
    unrestricted URL here is an SSRF vector (cloud metadata endpoints, internal
    services, etc.), so only allow https URLs on our own storage host through.
    """
    contact = resume_content.get("contact")
    photo_url = contact.get("photo_url") if isinstance(contact, dict) else None
    if not photo_url:
        return resume_content

    allowed_host = urlparse(settings.supabase_url).hostname
    parsed = urlparse(photo_url)
    if parsed.scheme != "https" or not allowed_host or parsed.hostname != allowed_host:
        resume_content = {**resume_content, "contact": {**contact, "photo_url": None}}

    return resume_content


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
    resume_content = _sanitize_resume_content(resume_content)
    template = _jinja_env.get_template(f"{template_id}.html")
    html = template.render(**resume_content)
    return weasyprint.HTML(string=html, url_fetcher=_blocked_url_fetcher).write_pdf()


def _blocked_url_fetcher(url: str, *args, **kwargs):
    """Default-deny fetcher: only data: URIs are allowed, no network/file access.

    Belt-and-suspenders alongside _sanitize_resume_content — even if some other
    field is ever rendered as a fetchable URL, WeasyPrint cannot reach the
    network or local filesystem while generating a PDF.
    """
    if url.startswith("data:"):
        import weasyprint.urls

        return weasyprint.urls.default_url_fetcher(url, *args, **kwargs)
    raise ValueError(f"Blocked fetch of untrusted URL in PDF rendering: {url!r}")


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

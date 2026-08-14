"""PDF generation service using WeasyPrint and Jinja2 templates."""

import re
from pathlib import Path
from urllib.parse import urlparse

from jinja2 import Environment, FileSystemLoader
from markupsafe import Markup, escape

from app.core.config import settings

TEMPLATES_DIR = Path(__file__).parent.parent.parent / "templates"
ALLOWED_TEMPLATES = {"ats_clean", "ats_modern", "ats_sidebar", "ats_professional", "ats_minimal"}


def _highlight_keywords(text: str, keywords: list) -> Markup:
    """Wrap any keyword found in *text* in a <strong class="kw"> tag.

    Steps:
    1. HTML-escape the raw text so user content can never inject tags.
    2. Apply the keyword regex on the escaped string and insert our own
       controlled <strong> tags.
    3. Return Markup so Jinja2 does not escape the result a second time.
    """
    if not keywords or not text:
        return Markup(escape(text or ""))

    safe_text = str(escape(text))
    # Sort longest first so "Machine learning" matches before "learning"
    sorted_kw = sorted(
        (str(k) for k in keywords if str(k).strip()),
        key=len,
        reverse=True,
    )
    if not sorted_kw:
        return Markup(safe_text)

    pattern = "|".join(re.escape(k) for k in sorted_kw)
    highlighted = re.sub(
        f"(?i)({pattern})",
        r'<strong class="kw">\1</strong>',
        safe_text,
    )
    return Markup(highlighted)


_jinja_env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)), autoescape=True)
_jinja_env.filters["highlight"] = _highlight_keywords


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


_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def _dedupe_redundant_headline(resume_content: dict) -> dict:
    """Drop a headline that adds nothing beyond a job title already in Experience.

    A headline reading "Sr. Business Analyst" is redundant not just when some
    Experience entry's title matches it exactly, but also when that title is
    a superset of it — e.g. "Sr. Business Analyst (Process Excellence)" —
    since every word in the headline is already fully present in the title;
    the headline contributes nothing the title doesn't already say. Checks
    every entry, not just the most recent one — the redundancy holds
    regardless of which role it echoes. A headline that adds a word or scope
    the title DOESN'T have (e.g. "Sr. Business Analyst — Data & Process
    Automation" against a bare "Business Analyst" title) is left alone,
    since that's genuinely distinguishing information.
    """
    headline = (resume_content.get("headline") or "").strip()
    experience = resume_content.get("experience") or []
    if not headline:
        return resume_content
    normalized_headline = _NON_ALNUM.sub("", headline.lower())
    if not normalized_headline:
        return resume_content
    for job in experience:
        title = (job.get("title") or "").strip()
        if not title:
            continue
        normalized_title = _NON_ALNUM.sub("", title.lower())
        if normalized_headline in normalized_title:
            return {**resume_content, "headline": ""}
    return resume_content


def _render_html(
    resume_content: dict,
    template_id: str,
    line_spacing: float = 1.25,
    paragraph_spacing: int = 12,
) -> str:
    """Validate template_id and render resume_content to an HTML string.

    Shared by generate_pdf (→ bytes) and count_pdf_pages (→ int), so both
    always render from the exact same template + sanitization path.
    count_pdf_pages always uses the defaults — it measures the from-scratch
    generator's page-overflow compression loop, which doesn't know about a
    user's per-resume spacing preference.
    """
    if template_id not in ALLOWED_TEMPLATES:
        raise ValueError(
            f"Unknown template: {template_id!r}. Use one of {sorted(ALLOWED_TEMPLATES)}"
        )
    resume_content = _sanitize_resume_content(resume_content)
    resume_content = _dedupe_redundant_headline(resume_content)
    template = _jinja_env.get_template(f"{template_id}.html")
    return template.render(**resume_content, line_spacing=line_spacing, paragraph_spacing=paragraph_spacing)


def generate_pdf(
    resume_content: dict,
    template_id: str,
    line_spacing: float = 1.25,
    paragraph_spacing: int = 12,
) -> bytes:
    """Render resume_content with the named template and return PDF bytes.

    Args:
        resume_content: Dict with keys: contact, experience, education, skills.
        template_id: One of "ats_clean" or "ats_modern".
        line_spacing: CSS line-height multiplier (matches Resume.line_spacing).
        paragraph_spacing: Space in px after each bullet list / summary /
            plain list (matches Resume.paragraph_spacing) — the "how much
            air is between sections" knob, distinct from line_spacing's
            "how tight are lines within a paragraph".

    Returns:
        Raw PDF bytes (starts with b"%PDF").

    Raises:
        ValueError: If template_id is not in ALLOWED_TEMPLATES.
    """
    import weasyprint  # deferred so import errors surface as ImportError, not module-level

    html = _render_html(resume_content, template_id, line_spacing, paragraph_spacing)
    return weasyprint.HTML(string=html, url_fetcher=_blocked_url_fetcher).write_pdf()


def count_pdf_pages(resume_content: dict, template_id: str) -> int:
    """Render resume_content and return the actual number of PDF pages.

    Uses WeasyPrint's render() (not write_pdf()) so we get a Document with
    a real .pages list instead of guessing page count from word/line counts —
    the only way to know if content fits the page-count budget is to lay it
    out exactly as the real renderer would.
    """
    import weasyprint  # deferred, same reason as generate_pdf

    html = _render_html(resume_content, template_id)
    document = weasyprint.HTML(string=html, url_fetcher=_blocked_url_fetcher).render()
    return len(document.pages)


def _render_letter_html(contact: dict, date_str: str, body: str) -> str:
    """Render a cover letter to an HTML string. Separate from _render_html
    since letter content isn't shaped like resume_content (no experience/
    education/skills sections) and needs no photo_url sanitization — the
    letter template never renders an image."""
    template = _jinja_env.get_template("cover_letter.html")
    return template.render(contact=contact, date_str=date_str, body=body)


def generate_letter_pdf(contact: dict, date_str: str, body: str) -> bytes:
    """Render a cover letter and return PDF bytes."""
    import weasyprint  # deferred, same reason as generate_pdf

    html = _render_letter_html(contact, date_str, body)
    return weasyprint.HTML(string=html, url_fetcher=_blocked_url_fetcher).write_pdf()


async def upload_letter_pdf(
    pdf_bytes: bytes,
    user_id: str,
    cover_letter_id: str,
    supabase_client,
) -> str:
    """Upload a cover letter PDF to the same Storage bucket resumes use
    (no separate bucket provisioning needed), under its own path prefix."""
    path = f"cover-letters/{user_id}/{cover_letter_id}.pdf"
    supabase_client.storage.from_("resumes").upload(
        path,
        pdf_bytes,
        {"content-type": "application/pdf", "upsert": "true"},
    )
    return path


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

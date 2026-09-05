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

    The pattern is anchored with alphanumeric lookaround (not \\b) — the same
    approach as ats.py's _exact_pattern — so "Java" doesn't partially match
    inside "JavaScript" and "React" doesn't get truncated inside "ReactJS",
    while symbol-suffixed skills like "C++" or "Node.js" still match in full
    (a bare \\b breaks on those since +/. aren't word characters).
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
        f"(?i)(?<![A-Za-z0-9])({pattern})(?![A-Za-z0-9])",
        r'<strong class="kw">\1</strong>',
        safe_text,
    )
    return Markup(highlighted)


_jinja_env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)), autoescape=True)
_jinja_env.filters["highlight"] = _highlight_keywords


_MAX_PHOTO_BYTES = 5 * 1024 * 1024  # 5 MB — a portrait photo has no business being bigger


def _sanitize_resume_content(resume_content: dict) -> dict:
    """Strip contact.photo_url unless it points at the trusted Supabase Storage host,
    and inline whatever survives as a data: URI.

    Some templates render photo_url into an <img src="..."> tag, which WeasyPrint
    fetches server-side via _blocked_url_fetcher — a default-deny fetcher that only
    ever allows data: URIs (never http/https, even to our own trusted host, since a
    render-time network fetch is itself part of the SSRF surface this function
    guards against). So a trusted https:// URL that made it past the host check
    below would still fail to render: it must be fetched and inlined here instead.
    """
    contact = resume_content.get("contact")
    photo_url = contact.get("photo_url") if isinstance(contact, dict) else None
    if not photo_url:
        return resume_content

    allowed_host = urlparse(settings.supabase_url).hostname
    parsed = urlparse(photo_url)
    if parsed.scheme != "https" or not allowed_host or parsed.hostname != allowed_host:
        return {**resume_content, "contact": {**contact, "photo_url": None}}

    data_uri = _fetch_photo_as_data_uri(photo_url)
    return {**resume_content, "contact": {**contact, "photo_url": data_uri}}


def _fetch_photo_as_data_uri(photo_url: str) -> str | None:
    """Fetch a trusted photo URL and return it as a data: URI, or None on any failure.

    Runs synchronously — callers (generate_pdf/count_pdf_pages) are always invoked
    via asyncio.to_thread, same as the WeasyPrint render itself, so this blocking
    call doesn't tie up the event loop. A missing/oversized/non-image photo should
    degrade to "no photo in the PDF", not fail the whole resume download.
    """
    import base64

    import httpx

    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.get(photo_url)
            response.raise_for_status()
            content_type = response.headers.get("content-type", "").split(";")[0].strip()
            if not content_type.startswith("image/") or len(response.content) > _MAX_PHOTO_BYTES:
                return None
            encoded = base64.b64encode(response.content).decode("ascii")
            return f"data:{content_type};base64,{encoded}"
    except httpx.HTTPError:
        return None


# Every stack ends in a bare generic (sans-serif/serif) deliberately — the
# render host (see Dockerfile/nixpacks.toml) installs no font packages at
# all, so "Arial"/"Georgia" never actually resolve there. What renders today
# is whatever fontconfig's default falls back to for the trailing generic
# keyword. A font choice that didn't end in one of these two generics could
# silently fail to find any face on some hosts.
FONT_STACKS = {
    "sans": "Arial, Helvetica, sans-serif",
    "modern_sans": '"Helvetica Neue", Arial, sans-serif',
    "serif": 'Georgia, "Times New Roman", serif',
    "classic_serif": '"Times New Roman", Times, serif',
}

# Each template's current hardcoded accent hex, preserved as the default so
# an unset accent_color (None) renders identically to before this existed.
TEMPLATE_DEFAULT_ACCENT = {
    "ats_clean": "#111111",
    "ats_modern": "#5c6bc0",
    "ats_sidebar": "#4c6178",
    "ats_professional": "#1f5fbf",
    "ats_minimal": "#1a1a1a",
}


def _derived_spacing(line_spacing: float, paragraph_spacing: int) -> dict:
    """Values the templates need beyond the two raw user-facing settings.

    line_spacing/paragraph_spacing only ever mapped to `body { line-height }`
    and the bottom margin of a bullet list — nothing tied the gap *between*
    individual bullets, between distinct experience/education entries, or
    above section headers to either setting, so those stayed fixed no matter
    what the sliders were set to. Per real resume-formatting guidance
    (Teal, WashU Career Engagement, Hireflow — see docs/ai-pipeline.md-style
    reasoning in the commit message): bullet-to-bullet gaps belong in a
    narrow 3-6px band scaled off line_spacing (line spacing governing "space
    within a unit of text" naturally extends to the gap between sibling
    bullets); section-to-section separation should run 1.5-2x a single
    paragraph gap, scaled off paragraph_spacing.

    bullet_gap: 3px at line_spacing's floor (1.0) up to 6px at its ceiling
    (1.6) — see the line-spacing <input type=range> bounds in
    PreviewPanel.tsx.
    section_gap: 1.5x paragraph_spacing, rounded to a whole px.
    """
    bullet_gap = round(3 + (line_spacing - 1.0) * 5, 1)
    section_gap = round(paragraph_spacing * 1.5)
    return {"bullet_gap": bullet_gap, "section_gap": section_gap}


def _group_experience_by_company(experience: list) -> list[dict]:
    """Group consecutive experience entries that share a company (a
    promotion or internal transfer produces one entry per role, same
    company repeated) so templates can render one company header with each
    role nested under it, instead of repeating the full company/dates line
    for every role.

    Only ADJACENT entries are grouped — matching by company name anywhere
    in the list, regardless of position, would silently reorder a
    candidate's actual employment history for the rare case of a boomerang
    return to a former employer with an unrelated job in between.
    Comparison is case-insensitive/trimmed so "Acme Corp" and "acme corp "
    still group, but distinct employers never do.

    Returns a list of {"company": str, "roles": [entry, ...]} — a group of
    one role is the normal case and renders identically to before this
    existed; a group of 2+ is what triggers the nested rendering.
    """
    groups: list[dict] = []
    for entry in experience or []:
        company = (entry.get("company") or "").strip()
        if groups and company and groups[-1]["company"].strip().lower() == company.lower():
            groups[-1]["roles"].append(entry)
        else:
            groups.append({"company": entry.get("company", ""), "roles": [entry]})
    return groups


def _render_html(
    resume_content: dict,
    template_id: str,
    line_spacing: float = 1.25,
    paragraph_spacing: int = 12,
    font_choice: str = "sans",
    accent_color: str | None = None,
) -> str:
    """Validate template_id and render resume_content to an HTML string.

    Shared by generate_pdf (→ bytes) and count_pdf_pages (→ int), so both
    always render from the exact same template + sanitization path.
    count_pdf_pages always uses the defaults — it measures the from-scratch
    generator's page-overflow compression loop, which doesn't know about a
    user's per-resume spacing/font/color preference.
    """
    if template_id not in ALLOWED_TEMPLATES:
        raise ValueError(
            f"Unknown template: {template_id!r}. Use one of {sorted(ALLOWED_TEMPLATES)}"
        )
    resume_content = _sanitize_resume_content(resume_content)
    template = _jinja_env.get_template(f"{template_id}.html")
    if accent_color and re.fullmatch(r"#[0-9a-fA-F]{6}", accent_color):
        resolved_accent = accent_color
    else:
        resolved_accent = TEMPLATE_DEFAULT_ACCENT[template_id]
    return template.render(
        **resume_content,
        line_spacing=line_spacing,
        paragraph_spacing=paragraph_spacing,
        # Markup: these two are fixed, server-controlled CSS fragments (a
        # lookup into FONT_STACKS / a regex-checked hex color), never user
        # content — autoescape would otherwise HTML-entity-encode the font
        # stack's quotes inside the <style> block and corrupt the CSS.
        font_family=Markup(FONT_STACKS.get(font_choice, FONT_STACKS["sans"])),
        accent_color=Markup(resolved_accent),
        experience_groups=_group_experience_by_company(resume_content.get("experience") or []),
        **_derived_spacing(line_spacing, paragraph_spacing),
    )


def generate_pdf(
    resume_content: dict,
    template_id: str,
    line_spacing: float = 1.25,
    paragraph_spacing: int = 12,
    font_choice: str = "sans",
    accent_color: str | None = None,
) -> bytes:
    """Render resume_content with the named template and return PDF bytes.

    Args:
        resume_content: Dict with keys: contact, experience, education, skills.
        template_id: One of ALLOWED_TEMPLATES.
        line_spacing: CSS line-height multiplier (matches Resume.line_spacing).
        paragraph_spacing: Space in px after each bullet list / summary /
            plain list (matches Resume.paragraph_spacing) — the "how much
            air is between sections" knob, distinct from line_spacing's
            "how tight are lines within a paragraph".
        font_choice: Key into FONT_STACKS (matches Resume.font_choice).
        accent_color: "#RRGGBB" or None for the template's own default
            (matches Resume.accent_color).

    Returns:
        Raw PDF bytes (starts with b"%PDF").

    Raises:
        ValueError: If template_id is not in ALLOWED_TEMPLATES.
    """
    import weasyprint  # deferred so import errors surface as ImportError, not module-level

    html = _render_html(resume_content, template_id, line_spacing, paragraph_spacing, font_choice, accent_color)
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

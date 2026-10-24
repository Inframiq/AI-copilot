"""Hostile text in any résumé field renders as text on every template (tests
CODE-001 and ATK-025).

The Studio shows a résumé by putting this same HTML into the page, so
anything the templates let through would run in the browser of whoever
opens it. Every field gets a script-injection string; the rendered page may
hold only the elements and attributes the same template uses for ordinary
content, plus the bold/italic/underline the rich-text allowlist keeps, with
no event handlers and no link that is not http(s), mailto or tel."""
from html.parser import HTMLParser
from itertools import cycle
from unittest.mock import patch

import pytest

from app.services.pdf import ALLOWED_TEMPLATES, TEMPLATES_REQUIRING_PHOTO, _render_letter_html, render_resume_html

TRUSTED_HOST = "https://test-project.supabase.co"
PHOTO_URL = f"{TRUSTED_HOST}/storage/v1/object/public/avatars/u/r.png"
ONE_PIXEL_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c6360606060000000050001a5f645ee0000000049454e44ae426082"
)

TEXT_PAYLOADS = [
    '<script>alert("x")</script>',
    '"><img src=x onerror=alert(1)>',
    "<svg onload=alert(1)>",
    "<b onmouseover=alert(1)>bold</b>",
    "<a href=javascript:alert(1)>x</a>",
    "'><iframe src=javascript:alert(1)>",
    "<style>body{display:none}</style>",
]
LINK_PAYLOADS = ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", " JaVaScRiPt:alert(1)", "vbscript:msgbox(1)"]
LINK_FIELDS = {"linkedin", "github", "website", "link"}
# Rich-text formatting the summary and bullets may keep, never with attributes.
FORMATTING = {"b", "i", "u", "strong", "em"}
# Never on a page, even where a template has its own (it has none). Anything
# else the template does not use for ordinary content is refused as well.
NEVER = {"script", "iframe", "object", "embed", "svg", "math"}

SHAPE = {
    "contact": {
        "name": "Jane Doe", "email": "jane@example.com", "phone": "555-0100", "location": "NYC",
        "linkedin": "linkedin.com/in/jane", "linkedin_label": "LinkedIn", "github": "github.com/jane",
        "github_label": "GitHub", "website": "jane.dev", "website_label": "Site",
    },
    "headline": "Senior Engineer",
    "summary": "Backend engineer.",
    "experience": [{"company": "Acme", "title": "Engineer", "location": "NYC", "start": "2022", "end": "2024",
                    "bullets": ["Built APIs", "Led a team"]}],
    "projects": [{"name": "Market", "tech_stack": "React", "link": "github.com/jane/m", "start": "2024-01", "end": "2024-05",
                  "bullets": ["Built a listings app"]}],
    "education": [{"institution": "MIT", "degree": "B.S.", "year": "2022", "location": "Boston"}],
    "skills": ["Python", "FastAPI"],
    "languages": [{"name": "English", "level": "Native"}],
    "certifications": ["AWS Architect"],
    "awards": ["Employee of the Year"],
}


def _hostile(value, key=None, texts=None, links=None):
    """SHAPE with every string replaced by an injection string."""
    if isinstance(value, dict):
        return {k: _hostile(v, k, texts, links) for k, v in value.items()}
    if isinstance(value, list):
        return [_hostile(v, key, texts, links) for v in value]
    return next(links) if key in LINK_FIELDS else next(texts)


class _Elements(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.found = []  # (tag, {attr: value})

    def handle_starttag(self, tag, attrs):
        self.found.append((tag, dict(attrs)))

    handle_startendtag = handle_starttag


def _elements(html: str):
    parser = _Elements()
    parser.feed(html)
    return parser.found


def _render(template_id: str, content: dict, monkeypatch) -> str:
    if template_id in TEMPLATES_REQUIRING_PHOTO:
        content = {**content, "contact": {**content["contact"], "photo_url": PHOTO_URL}}
    from app.services import pdf

    monkeypatch.setattr(pdf, "_download_avatar", lambda path: ONE_PIXEL_PNG)
    with patch("app.services.pdf.settings") as settings:
        settings.supabase_url = TRUSTED_HOST
        return render_resume_html(content, template_id)


def _unsafe(elements, allowed_tags) -> list[str]:
    problems = []
    for tag, attrs in elements:
        if tag in NEVER or tag not in allowed_tags:
            problems.append(f"<{tag}> element")
        for name, value in attrs.items():
            if name.startswith("on"):
                problems.append(f"<{tag} {name}=...> event handler")
            if name in ("href", "src", "action", "formaction", "xlink:href") and value is not None:
                v = value.strip().lower()
                if not (v.startswith(("http://", "https://", "mailto:", "tel:", "#")) or (tag == "img" and v.startswith("data:image/"))):
                    problems.append(f"<{tag} {name}={value[:40]!r}>")
    return problems


@pytest.mark.parametrize("template_id", sorted(ALLOWED_TEMPLATES))
@pytest.mark.parametrize("shift", range(len(TEXT_PAYLOADS)))
def test_hostile_text_in_every_field_renders_as_text(template_id, shift, monkeypatch):
    # Each run shifts which string lands in which field, so every field meets every string.
    texts = cycle(TEXT_PAYLOADS[shift:] + TEXT_PAYLOADS[:shift])
    links = cycle(LINK_PAYLOADS[shift % len(LINK_PAYLOADS):] + LINK_PAYLOADS[:shift % len(LINK_PAYLOADS)])
    ordinary = _elements(_render(template_id, SHAPE, monkeypatch))
    allowed = {tag for tag, _ in ordinary} | FORMATTING
    rendered = _render(template_id, _hostile(SHAPE, texts=texts, links=links), monkeypatch)
    elements = _elements(rendered)

    assert _unsafe(elements, allowed) == []
    ordinary_attrs = {(tag, frozenset(attrs)) for tag, attrs in ordinary}
    for tag, attrs in elements:
        if tag in FORMATTING and (tag, frozenset(attrs)) not in ordinary_attrs:
            assert attrs == {}, f"<{tag}> kept attributes {attrs}"
    assert "alert(" in rendered  # the strings are still shown, as text


def test_hostile_text_in_a_cover_letter_renders_as_text():
    contact = {k: v for k, v in _hostile(SHAPE["contact"], texts=cycle(TEXT_PAYLOADS), links=cycle(LINK_PAYLOADS)).items()}
    body = "\n\n".join(TEXT_PAYLOADS)
    ordinary = _elements(_render_letter_html(SHAPE["contact"], "January 1, 2026", "Dear team,\n\nHello."))
    elements = _elements(_render_letter_html(contact, "January 1, 2026", body))
    assert _unsafe(elements, {tag for tag, _ in ordinary}) == []


def test_the_check_catches_what_it_should():
    found = _elements('<p><img src=x onerror="alert(1)"><a href="javascript:alert(1)">x</a><script>1</script></p>')
    problems = _unsafe(found, {"p", "a"})
    assert any("onerror" in p for p in problems)
    assert any("javascript" in p for p in problems)
    assert any("<script>" in p for p in problems)
    assert any("<img>" in p for p in problems)

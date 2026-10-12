"""Text out of an untrusted PDF — the part of résumé parsing that touches
the uploaded file.

Imports nothing from the app (no settings, no secrets, no database), only
pypdf: the sandbox worker (app/services/sandbox_worker.py) loads this module
alone, in a separate process that holds none of the API's secrets. Nothing
in the API process should call these on an uploaded file directly — go
through app.services.sandbox.
"""
import io
import re
from typing import NamedTuple

MAX_PDF_PAGES = 50
MAX_TEXT_CHARS = 100_000


class _Link(NamedTuple):
    """A hyperlink's destination, plus what the reader saw: the clickable
    text ("GitHub", "Live") and the whole line it sat on. The URL alone
    can't say which project a link belongs to, or whether it is the repo
    or the running app."""
    url: str
    anchor: str = ""
    line: str = ""


def _page_fragments(page) -> list[tuple[float, float, str]]:
    """Every run of text on the page with where it starts, in page space."""
    fragments: list[tuple[float, float, str]] = []

    def visit(text, cm, tm, _font, _size):
        if not text or not text.strip():
            return
        x = tm[4] * cm[0] + tm[5] * cm[2] + cm[4]
        y = tm[4] * cm[1] + tm[5] * cm[3] + cm[5]
        fragments.append((x, y, text.replace("\n", " ")))

    try:
        page.extract_text(visitor_text=visit)
    except Exception:
        return []
    return fragments


def _join(fragments) -> str:
    return re.sub(r"\s+", " ", " ".join(t for _, _, t in sorted(fragments))).strip()


def _extract_links(page) -> list[_Link]:
    """PDF hyperlinks (e.g. the word "GitHub" linking to a profile/repo URL)
    never show up in page.extract_text() — it only returns the visible
    anchor text, never the destination. Pulling the URIs straight from the
    page's link annotations lets the parser prompt see the real URL instead
    of just the word "GitHub"/"LinkedIn"/"Portfolio"; the text under each
    link's rectangle, and the line around it, say what it was for."""
    links: list[_Link] = []
    fragments: list[tuple[float, float, str]] | None = None
    for annot_ref in page.get("/Annots") or []:
        try:
            annot = annot_ref.get_object()
            if annot.get("/Subtype") != "/Link":
                continue
            action = annot.get("/A")
            uri = action.get("/URI") if action and action.get("/S") == "/URI" else None
            if not uri:
                continue
            if fragments is None:
                fragments = _page_fragments(page)
            x0, y0, x1, y1 = (float(v) for v in annot.get("/Rect"))
            x0, x1 = min(x0, x1), max(x0, x1)
            y0, y1 = min(y0, y1), max(y0, y1)
            # A run's origin sits on its baseline, just above the rect's
            # bottom edge; a little slack keeps a tight rect from missing it.
            anchor = _join(f for f in fragments if x0 - 2 <= f[0] < x1 - 1 and y0 - 2 <= f[1] <= y1)
            line = _join(f for f in fragments if y0 - 2 <= f[1] <= y1)
            links.append(_Link(str(uri), anchor, line))
        except Exception:
            continue
    return links


def _append_link_hints(text: str, links: list[_Link]) -> str:
    """Same hint block for both PDF and DOCX extraction — see
    _extract_links' docstring for why this exists at all."""
    if not links:
        return text
    seen: set[str] = set()
    unique = [link for link in links if not (link.url in seen or seen.add(link.url))]

    def hint(link: _Link) -> str:
        out = f'- "{link.anchor}" -> {link.url}' if link.anchor and link.anchor != link.url else f"- {link.url}"
        if link.line and link.line != link.anchor:
            out += f' (on the line: "{link.line[:160]}")'
        return out

    return (
        text
        + '\n\nHyperlinks found in this document (the real destination behind clickable '
        + 'text like "GitHub", "LinkedIn" or "Live", with the text it was shown as and the '
        + "line it sat on — match each to the right field by its domain and that line):\n"
        + "\n".join(hint(link) for link in unique)
    )


def extract_text_from_pdf(file_bytes: bytes) -> str:
    """The résumé's text, with its hyperlinks' real destinations appended.

    Raises PdfRejected for a PDF that's too long or carries active content.
    """
    import pypdf  # type: ignore

    reader = pypdf.PdfReader(io.BytesIO(file_bytes))
    if reader.is_encrypted:
        raise PdfRejected("This PDF is password-protected. Save a copy without a password and upload that.")
    if len(reader.pages) > MAX_PDF_PAGES:
        raise PdfRejected(f"PDF exceeds maximum page count ({MAX_PDF_PAGES} pages).")
    risky = find_active_content(reader)
    if risky:
        raise PdfRejected(
            "This PDF contains " + ", ".join(risky) + ", which a résumé doesn't need. "
            "Export it again as a plain PDF (Save as PDF or Print to PDF) and upload that."
        )
    pages = []
    links: list[_Link] = []
    for page in reader.pages:
        pages.append(page.extract_text() or "")
        links.extend(_extract_links(page))
    text = "\n".join(pages).strip()
    return _append_link_hints(text, links)[:MAX_TEXT_CHARS]


# Things a PDF can carry that run, launch, submit or embed something. A
# résumé needs none of them, and each is how PDF malware usually works, so a
# PDF with any of them is refused rather than parsed, stored and later opened.
_RISKY_ACTIONS = {
    "/JavaScript": "a script",
    "/Launch": "an action that launches a program",
    "/ImportData": "a data-import action",
    "/SubmitForm": "a form-submit action",
    "/Rendition": "a media action",
    "/GoToE": "a jump into an embedded file",
    "/GoToR": "a jump to another file",
}
_RISKY_ANNOTATIONS = {
    "/FileAttachment": "an attached file",
    "/RichMedia": "embedded media",
    "/Movie": "embedded media",
    "/Sound": "embedded media",
    "/Screen": "embedded media",
    "/3D": "embedded 3D content",
}


def _resolve(obj):
    try:
        return obj.get_object() if obj is not None and hasattr(obj, "get_object") else obj
    except Exception:
        return None


def _action_risks(action, found: set[str], depth: int = 0) -> None:
    """Risky action types in *action* and the chain it continues into (/Next)."""
    action = _resolve(action)
    if depth > 20 or action is None:
        return
    if isinstance(action, list):
        for a in action:
            _action_risks(a, found, depth + 1)
        return
    if not hasattr(action, "get"):
        return
    kind = action.get("/S")
    if kind in _RISKY_ACTIONS:
        found.add(_RISKY_ACTIONS[kind])
    if kind == "/URI":
        uri = str(_resolve(action.get("/URI")) or "").strip().lower()
        if uri and not uri.startswith(("http://", "https://", "mailto:", "tel:")):
            found.add("a link that isn't a web address")
    if action.get("/JS") is not None:
        found.add(_RISKY_ACTIONS["/JavaScript"])
    _action_risks(action.get("/Next"), found, depth + 1)


def find_active_content(reader) -> list[str]:
    """What in this PDF could run or launch something, in words; [] if none.

    Walks the parsed objects rather than grepping the bytes: names can be
    escaped (/J#61vaScript) and objects compressed into object streams,
    which a byte search misses and pypdf has already decoded.
    """
    found: set[str] = set()
    root = _resolve(reader.trailer.get("/Root"))
    if root is None:
        return []
    open_action = _resolve(root.get("/OpenAction"))
    # An open action that is just "open at this page" is a list (a
    # destination) or a plain GoTo; anything else runs on open.
    if hasattr(open_action, "get"):
        if open_action.get("/S") not in (None, "/GoTo"):
            found.add("an action that runs when the file opens")
        _action_risks(open_action, found)
    if root.get("/AA") is not None:
        found.add("an action that runs when the file opens")
    names = _resolve(root.get("/Names"))
    if hasattr(names, "get"):
        if names.get("/JavaScript") is not None:
            found.add(_RISKY_ACTIONS["/JavaScript"])
        if names.get("/EmbeddedFiles") is not None:
            found.add("an embedded file")
    form = _resolve(root.get("/AcroForm"))
    if hasattr(form, "get") and form.get("/XFA") is not None:
        found.add("an XFA form")
    for page in reader.pages:
        if page.get("/AA") is not None:
            found.add("an action that runs when a page opens")
        for ref in page.get("/Annots") or []:
            annot = _resolve(ref)
            if not hasattr(annot, "get"):
                continue
            subtype = annot.get("/Subtype")
            if subtype in _RISKY_ANNOTATIONS:
                found.add(_RISKY_ANNOTATIONS[subtype])
            _action_risks(annot.get("/A"), found)
            additional = _resolve(annot.get("/AA"))
            if hasattr(additional, "values"):
                for a in additional.values():
                    _action_risks(a, found)
    return sorted(found)


class PdfRejected(ValueError):
    """The PDF is refused, with a reason fit to show the person who uploaded it."""

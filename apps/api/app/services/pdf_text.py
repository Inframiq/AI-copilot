"""Text out of an untrusted PDF — the part of résumé parsing that touches
the uploaded file.

Imports nothing from the app (no settings, no secrets, no database), only
pypdf and pdfminer: the sandbox worker (app/services/sandbox_worker.py) loads this module
alone, in a separate process that holds none of the API's secrets. Nothing
in the API process should call these on an uploaded file directly — go
through app.services.sandbox.
"""
import io
import re
from typing import NamedTuple

MAX_PDF_PAGES = 50
MAX_TEXT_CHARS = 100_000
# pdfminer reads this many pages for the word check below: a résumé's, and
# few enough to stay well inside the sandbox's time limit on a long PDF.
REFERENCE_PAGES = 6


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
    reference = _reference_words(file_bytes)
    if reference is not None:
        # Apart first: "•Winner-T echSprint" joins only once the bullet is off.
        text = rejoin_split_words(split_glued_words(text, *reference), *reference)
    return _append_link_hints(text, links)[:MAX_TEXT_CHARS]


# ── Spaces pypdf gets wrong ─────────────────────────────────────────────────
#
# pypdf puts a space wherever a run of text starts past where it thinks the
# previous run ended. It works that end out without the PDF's extra letter
# and word spacing, so in many PDFs (Word's justified text, a capital kerned
# into the next letter) it sees a gap inside a word: "Indi a", "T echnical",
# "new -hire", "35 -40%". And where a PDF moves to the next word without
# drawing a space (LaTeX and Typst do, around bold text, links and a date
# set at the right margin) it sees none: "pipelinefor", "usingPython",
# "Ltd.July". pdfminer places every character where it is drawn and gets
# both right — but reads columns and lines in a worse order, so pypdf stays
# the reader and pdfminer is asked only which words the file holds.

# In a PDF that spaces out its letters pdfminer reads "E x p e r i e n c e":
# then most of its words are one letter, and it says nothing about words.
# A résumé it reads well has 1-2% of them.
LETTER_BY_LETTER = 0.25


def _reference_words(file_bytes: bytes) -> tuple[set[str], set[tuple[str, str]]] | None:
    """Every word pdfminer reads in the file, and every pair of words it
    reads side by side; None when it can't read the file, or reads it letter
    by letter (the text is then left as pypdf read it)."""
    try:
        import logging

        from pdfminer.high_level import extract_text
        from pdfminer.layout import LAParams

        logging.getLogger("pdfminer").setLevel(logging.ERROR)
        words = extract_text(io.BytesIO(file_bytes), laparams=LAParams(), maxpages=REFERENCE_PAGES).split()
    except Exception:
        return None
    if not words or sum(1 for w in words if len(w) == 1 and w.isalpha()) / len(words) > LETTER_BY_LETTER:
        return None
    return set(words), set(zip(words, words[1:]))


_WORDLIKE = re.compile(r"\w")
# "Fundam entals" is two pieces; three covers a word split twice.
MAX_PIECES = 3


def rejoin_split_words(text: str, words: set[str], pairs: set[tuple[str, str]]) -> str:
    """text with "a b" made "ab" wherever "ab" is one word in the reference
    and "a b" is never two words side by side in it — so two real words
    stay apart even where they also occur joined. Both pieces must hold a
    letter or digit: a separator glyph neither reader could name ("71.63% ?
    2023") is no piece of a word."""
    def known(pieces: list[str]) -> bool:
        if "".join(pieces) in words:
            return True
        # Two words hyphenated, the second split: "Winner-T echSprint," where
        # pdfminer reads "Winner - TechSprint,".
        head, dash, tail = pieces[0].rpartition("-")
        return bool(dash) and head in words and tail + "".join(pieces[1:]) in words

    def joined(pieces: list[str]) -> bool:
        return (all(_WORDLIKE.search(p) for p in pieces) and known(pieces)
                and not any(pair in pairs for pair in zip(pieces, pieces[1:])))

    def line_of(line: str) -> str:
        parts = line.split(" ")
        out: list[str] = []
        i = 0
        while i < len(parts):
            # The longest run of up to MAX_PIECES pieces that is one word.
            take = next((n for n in range(min(MAX_PIECES, len(parts) - i), 1, -1)
                         if joined(parts[i:i + n])), 1)
            out.append("".join(parts[i:i + take]))
            i += take
        return " ".join(out)

    return "\n".join(line_of(line) for line in text.split("\n"))


# Where one word ends and the next begins, with no space between them: a
# small letter then a capital or digit ("SystemJan", "Engineering2024"), a
# digit then a letter, or a stop, colon or bracket then the next word
# ("Ltd.July", "CS:Data"). Not a hyphen: "e-commerce" is one word.
_BOUNDARY = re.compile(r"[a-z][A-Z0-9]|[A-Za-z][0-9]|[0-9][A-Za-z]|[.:;,)\]][A-Za-z0-9(]")
# Never apart, even where pdfminer reads them so: two digits ("070"), two
# capitals or a capital and a small letter ("THPi", "PLt2" — a formula, an
# acronym), or either side of a dash or slash ("STATISTICS-3", "2–3",
# "doi:10.1145/2347736").
_NO_CUT = re.compile(r"[0-9][0-9]|[A-Z][A-Za-z]|[-–—/].|.[-–—/]")
_ACRONYM_THEN_WORD = re.compile(r"[A-Z]{2}[a-z]{3}")
# A run of words with no space between them at all: "usingEfficientNet-B2across6,000+".
MAX_GLUED_WORDS = 6
_ONE_LETTER_WORDS = {"a", "A", "I"}
_NUMBER = re.compile(r"[(\[]?[0-9][0-9.,%+/\-–]*[)\]]?")
_LETTER = re.compile(r"[^\W\d_]")


def _whole(piece: str) -> bool:
    """A piece that can be a word of its own: two letters or more ("for",
    "(MPC)", "4-agent"), "a" or "I", or a number ("2024", "300+", "2-3", "1.")."""
    return (len(_LETTER.findall(piece)) > 1 or piece in _ONE_LETTER_WORDS
            or bool(_NUMBER.fullmatch(piece)))


def _bullet_glyph(piece: str) -> bool:
    """A bullet neither reader could name ("?Built"): one non-ASCII mark."""
    return len(piece) == 1 and not piece.isascii() and not piece.isalnum()


def _split_point(token: str, words: set[str], pairs: set[tuple[str, str]],
                 followers: dict[str, set[str]]) -> int | None:
    """Where *token* is two words pdfminer read apart, or None."""
    cuts = [k for k in range(1, len(token)) if not _NO_CUT.fullmatch(token[k - 1:k + 1])]
    # Read side by side: "pipelinefor" where pdfminer has "pipeline for"
    # (and "teamsusingPython" where it has "teams using Python").
    for k in range(1, len(token)):
        a, b = token[:k], token[k:]
        if not (_whole(b) and (_whole(a) or _bullet_glyph(a)) and len(a) + len(b) > 2):
            continue
        if k in cuts and ((a, b) in pairs or any(b.startswith(n) for n in followers.get(a, ()))):
            return k
        # An acronym, then a word: "Grad-CAMexplainability" where pdfminer
        # reads exactly "Grad-CAM explainability".
        if (a, b) in pairs and _ACRONYM_THEN_WORD.fullmatch(token[max(0, k - 2):k + 3]):
            return k
    # Read in different places (a date at the margin, a column apart), so
    # only at a plain word boundary: "Engineering2024", "Ltd.July".
    for k in cuts:
        a, b = token[:k], token[k:]
        if (a in words and b in words and _whole(a) and _whole(b) and min(len(a), len(b)) > 1
                and _BOUNDARY.fullmatch(token[k - 1:k + 1])):
            return k
    return None


def split_glued_words(text: str, words: set[str], pairs: set[tuple[str, str]]) -> str:
    """text with "ab" made "a b" wherever pdfminer never reads "ab" as one
    word but reads "a" and "b" as two: a space the PDF shows by position,
    with no space character, which pypdf misses. A word pdfminer also reads
    whole anywhere in the file is left as it is."""
    # The words pdfminer reads right after each word: "teams" -> "using".
    followers: dict[str, set[str]] = {}
    for a, b in pairs:
        if _whole(b):
            followers.setdefault(a, set()).add(b)

    def token_of(token: str) -> str:
        out: list[str] = []
        rest = token
        while rest and rest not in words and len(out) < MAX_GLUED_WORDS - 1:
            k = _split_point(rest, words, pairs, followers)
            if k is None:
                break
            out.append(rest[:k])
            rest = rest[k:]
        return " ".join([*out, rest])

    return "\n".join(" ".join(token_of(t) for t in line.split(" ")) for line in text.split("\n"))


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

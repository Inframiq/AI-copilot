"""Inline formatting the Studio can apply and the PDF can keep.

The Studio's B / I / U write real markup into the résumé, so the résumé now
stores strings that may contain tags. Everything that renders them has to
treat them as hostile input: this is the one place that decides what a tag is
allowed to be, and it is used on both the render path and the write path.

The policy is deliberately tiny — five tags, no attributes. `execCommand`
emits `style=""` unprompted, and a style attribute alone is enough to break a
page's layout or pull a remote resource through url(), so attributes are
dropped wholesale rather than filtered.
"""

from html.parser import HTMLParser

from markupsafe import Markup, escape

ALLOWED_TAGS = ("b", "i", "u", "strong", "em")


class _InlineSanitizer(HTMLParser):
    """Escape everything, then re-admit the allowed tags, balanced."""

    def __init__(self) -> None:
        # convert_charrefs turns &amp; back into & in the data stream; the
        # escape() below re-encodes it, so entities round-trip exactly once.
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.open: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in ALLOWED_TAGS:
            self.parts.append(f"<{tag}>")
            self.open.append(tag)
        else:
            # Escaped, not dropped: a bullet that mentions <script> or <div>
            # is describing code, and silently eating it loses what the
            # candidate wrote. Escaped it is inert and still visible.
            self.parts.append(str(escape(self.get_starttag_text() or "")))

    def handle_startendtag(self, tag: str, attrs) -> None:
        # <b/> opens nothing and closes nothing, so an allowed tag in this
        # form contributes no output; anything else is escaped like any tag.
        if tag not in ALLOWED_TAGS:
            self.parts.append(str(escape(self.get_starttag_text() or "")))

    def handle_endtag(self, tag: str) -> None:
        if tag not in ALLOWED_TAGS:
            self.parts.append(str(escape(f"</{tag}>")))
            return
        if tag not in self.open:
            return
        # Close out to the matching tag, so crossed nesting (<b>a<i>b</b>c</i>)
        # comes out as valid markup rather than as-written.
        while self.open:
            current = self.open.pop()
            self.parts.append(f"</{current}>")
            if current == tag:
                return

    def handle_data(self, data: str) -> None:
        self.parts.append(str(escape(data)))

    def result(self) -> str:
        while self.open:
            self.parts.append(f"</{self.open.pop()}>")
        return "".join(self.parts)


def sanitize_inline(raw: str | None) -> Markup:
    """Return *raw* with only ALLOWED_TAGS surviving, everything else escaped.

    Returns Markup, so Jinja renders it without a second escaping pass. Any
    caller handing this to a template is asserting that this function — not
    the template — is what makes the value safe.
    """
    parser = _InlineSanitizer()
    parser.feed(raw or "")
    parser.close()
    return Markup(parser.result())


def strip_inline_tags(raw: str | None) -> str:
    """The plain text of *raw*, for everything that is not rendering it.

    The résumé now stores formatting, and every other consumer — the ATS
    scorer, the tailoring prompts, the Builder's textareas — wants the words
    without it. Left in, a <b> dropped into the middle of a phrase splits it
    in two and quietly costs the candidate a keyword match.
    """
    parser = _TextOnly()
    parser.feed(raw or "")
    parser.close()
    return "".join(parser.parts)


class _TextOnly(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

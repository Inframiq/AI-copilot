"""Text as a person types it on a normal keyboard.

Model-written text carries characters nobody types: curly quotes, long
dashes, the one-character ellipsis, fancy bullets and arrows, and odd-width
or invisible spaces. They read as an AI footprint on a résumé or a letter,
so everything saved — written by the model, pasted, or read from an upload —
goes through plain_text() first, and every PDF renders from plain text.

apps/web/lib/plain-text.ts is the same function for what the browser saves
straight to the database; packages/types/plain-text-cases.json holds the
cases both must pass. Letters with accents, currency signs and anything
else a person writes stay as they are.
"""
import re

from pydantic import BaseModel

# Odd-width spaces. A run holding one or more becomes a single space; runs of
# ordinary spaces alone were typed, and stay.
_ODD_SPACES = "\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000"
_SPACE_RUN = re.compile(f"[ {_ODD_SPACES}]*[{_ODD_SPACES}][ {_ODD_SPACES}]*")

# Zero-width characters with no visible job: removed.
_INVISIBLE = re.compile("[\u200b\u2060\ufeff\u00ad\u180e]")
# Zero-width (non-)joiners shape Indic scripts and emoji, so they stay after
# those; after Latin text or at the start they do nothing and go.
_JOINER = re.compile("(?<![\u0370-\U0010ffff])[\u200c\u200d]")

# A long dash between two words reads as a spaced hyphen; anywhere else
# (starting a line, ending one) it is just a hyphen.
_LONG_DASHES = "\u2014\u2015\u2e3a\u2e3b"
_LONG_DASH_BETWEEN = re.compile(f"(?<=\\S)[ \\t]*[{_LONG_DASHES}][ \\t]*(?=\\S)")
_LONG_DASH = re.compile(f"[{_LONG_DASHES}]")

_BULLETS = (
    "\u2022\u2023\u2043\u2219\u00b7\u25e6\u25cf\u25cb\u25a0\u25a1\u25aa\u25ab\u25c6\u25c7"
    "\u2666\u25ba\u25b6\u25b8\u25b9\u27a2\u27a3\u27a4\u2713\u2714\u2756\u2605\u2606"
    "\u29bf\u26ab\u26ac\u25c9\u25d8"
)
_ARROWS = {
    "->": "\u2192\u27f6\u2794\u279c\u279d\u279e\u2799\u279b\u21e8\u21fe",
    "<-": "\u2190\u27f5\u21e6",
    "<->": "\u2194\u27f7",
    "=>": "\u21d2\u27f9",
    "<=": "\u21d0",
    "<=>": "\u21d4",
}

_SINGLE = {
    **{c: '"' for c in "\u201c\u201d\u201e\u201f"},
    **{c: "'" for c in "\u2018\u2019\u201a\u201b"},
    **{c: "-" for c in "\u2010\u2011\u2012\u2013\u2212"},
    "\u2026": "...",
    **{c: "-" for c in _BULLETS},
    **{c: plain for plain, chars in _ARROWS.items() for c in chars},
}
_TABLE = str.maketrans(_SINGLE)


# The Studio's formatted text is stored as HTML, where a browser writes a
# non-breaking space as &nbsp; — and the renderer turns it back into the
# character. These entities are read as their characters; every other one
# (&amp;, &lt;, &eacute;) is left exactly as it is.
_NAMED = {
    "nbsp": "\u00a0", "ensp": "\u2002", "emsp": "\u2003", "emsp13": "\u2004",
    "emsp14": "\u2005", "numsp": "\u2007", "puncsp": "\u2008", "thinsp": "\u2009",
    "hairsp": "\u200a", "MediumSpace": "\u205f", "NoBreak": "\u2060",
    "ZeroWidthSpace": "\u200b", "zwj": "\u200d", "zwnj": "\u200c", "shy": "\u00ad",
    "mdash": "\u2014", "ndash": "\u2013", "horbar": "\u2015", "hyphen": "\u2010",
    "dash": "\u2010", "minus": "\u2212", "hellip": "\u2026", "mldr": "\u2026",
    "lsquo": "\u2018", "rsquo": "\u2019", "rsquor": "\u2019", "sbquo": "\u201a",
    "ldquo": "\u201c", "rdquo": "\u201d", "rdquor": "\u201d", "bdquo": "\u201e",
    "bull": "\u2022", "bullet": "\u2022", "middot": "\u00b7", "centerdot": "\u00b7",
    "rarr": "\u2192", "larr": "\u2190", "harr": "\u2194", "rArr": "\u21d2",
    "lArr": "\u21d0", "hArr": "\u21d4", "check": "\u2713",
}
_ENTITY = re.compile(r"&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]*);")


def _entity_char(match: re.Match) -> str:
    """The character an entity stands for, when it is one plain_text
    replaces; otherwise the entity as written."""
    ref = match.group(1)
    if ref[0] == "#":
        code = int(ref[2:], 16) if ref[1] in "xX" else int(ref[1:])
        char = chr(code) if 0 < code <= 0x10FFFF else ""
    else:
        char = _NAMED.get(ref, "")
    return char if char and _plain(char) != char else match.group(0)


def plain_text(text: str) -> str:
    """The same text, typed on a normal keyboard."""
    if not text:
        return text
    return _plain(_ENTITY.sub(_entity_char, text))


def _plain(text: str) -> str:
    text = _INVISIBLE.sub("", text)
    text = _JOINER.sub("", text)
    text = _SPACE_RUN.sub(" ", text)
    text = _LONG_DASH_BETWEEN.sub(" - ", text)
    text = _LONG_DASH.sub("-", text)
    return text.translate(_TABLE)


def plain_deep(value):
    """plain_text over every string inside a dict/list (a résumé's content,
    a letter, a set of questions). Keys and non-text values are left alone."""
    if isinstance(value, str):
        return plain_text(value)
    if isinstance(value, list):
        return [plain_deep(v) for v in value]
    if isinstance(value, dict):
        return {k: plain_deep(v) for k, v in value.items()}
    if isinstance(value, BaseModel):
        return plain_model(value)
    return value


def plain_model(model: BaseModel) -> BaseModel:
    """plain_text over every string field of a model's answer, in place —
    nested models, lists and dicts included. Set directly, not re-validated:
    the answer was validated once already, and only characters change."""
    for name in type(model).model_fields:
        model.__dict__[name] = plain_deep(model.__dict__.get(name))
    return model

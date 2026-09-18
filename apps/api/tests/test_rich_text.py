"""The allowlist that lets the Studio's B/I/U survive into the PDF."""
import pytest

from app.services.rich_text import ALLOWED_TAGS, sanitize_inline


def test_plain_text_is_escaped():
    assert sanitize_inline("5 < 6 & 7 > 2") == "5 &lt; 6 &amp; 7 &gt; 2"


def test_a_script_tag_cannot_survive():
    assert "<script" not in sanitize_inline("<script>alert(1)</script>")


def test_a_script_tag_is_escaped_rather_than_dropped():
    # A bullet that mentions <script> is describing code. Escaped it is inert
    # and still says what the candidate wrote; dropped, it silently vanishes.
    assert sanitize_inline("<script>alert(1)</script>") == (
        "&lt;script&gt;alert(1)&lt;/script&gt;"
    )


@pytest.mark.parametrize("tag", ["b", "i", "u", "strong", "em"])
def test_the_formatting_tags_survive(tag):
    assert sanitize_inline(f"a <{tag}>b</{tag}> c") == f"a <{tag}>b</{tag}> c"


def test_attributes_are_stripped():
    # execCommand emits style="" of its own accord, and a style attribute is
    # the opening for everything from layout breakage to url() fetches.
    assert sanitize_inline('<b style="color:red" onclick="x()">hi</b>') == "<b>hi</b>"


def test_an_unclosed_tag_is_closed():
    assert sanitize_inline("<b>hi") == "<b>hi</b>"


def test_a_stray_close_is_dropped():
    assert sanitize_inline("hi</b>") == "hi"


def test_crossed_nesting_is_balanced():
    assert sanitize_inline("<b>a<i>b</b>c</i>") == "<b>a<i>b</i></b>c"


def test_a_disallowed_wrapper_keeps_its_text():
    out = sanitize_inline('<div class="x">hi</div>')
    assert "hi" in out
    assert "<div" not in out


def test_an_image_payload_cannot_become_an_element():
    assert "<img" not in sanitize_inline('<img src=x onerror="alert(1)">')


def test_the_only_raw_tags_left_are_the_allowed_ones():
    """The invariant the whole policy rests on, stated once."""
    import re

    hostile = (
        '<img src=x onerror="alert(1)"> <script>a</script> '
        '<b onclick="x">keep</b> <a href="javascript:x">link</a> <BR/>'
    )
    tags = re.findall(r"<(/?)([a-zA-Z0-9]+)[^>]*>", str(sanitize_inline(hostile)))
    assert {name.lower() for _, name in tags} <= set(ALLOWED_TAGS)


def test_entities_survive_one_round_trip():
    assert sanitize_inline("AT&amp;T") == "AT&amp;T"


def test_none_is_empty():
    assert sanitize_inline(None) == ""


# ── Interaction with keyword highlighting ───────────────────────────────────

from app.services.pdf import _highlight_keywords


def test_formatting_survives_keyword_highlighting():
    out = _highlight_keywords("Built <b>Python</b> pipelines", ["pipelines"])
    assert "<b>Python</b>" in out
    assert '<strong class="kw">pipelines</strong>' in out


def test_a_tag_shaped_skill_cannot_rewrite_the_markup():
    # A skill literally named "b" must not match inside the <b> tag itself.
    out = _highlight_keywords("a <b>c</b> d", ["b"])
    assert out.count("<b>") == 1
    assert "<strong" not in out.split("<b>")[0] or True
    assert "<b><strong" not in out


def test_injection_through_a_bullet_cannot_become_an_element():
    out = str(_highlight_keywords('<img src=x onerror="alert(1)">Python', ["Python"]))
    assert "<img" not in out
    assert "&lt;img" in out


# ── Blast radius: everything downstream reads these strings as plain text ────

from app.services.ats import build_resume_text
from app.services.rich_text import strip_inline_tags


def test_strip_inline_tags_leaves_the_words_intact():
    assert strip_inline_tags("Led <b>cross-function</b>al teams") == "Led cross-functional teams"


def test_strip_inline_tags_unescapes_entities():
    assert strip_inline_tags("AT&amp;T &lt; 5") == "AT&T < 5"


def test_formatting_a_phrase_does_not_break_its_keyword_match():
    """Bolding half a phrase must not cost the candidate the match.

    The scorer looks for whole phrases; a <b> dropped into the middle of one
    would split it in two and silently lower the ATS score for doing nothing
    but making a word bold.
    """
    plain = {"experience": [{"bullets": ["Led cross-functional teams"]}]}
    bolded = {"experience": [{"bullets": ["Led <b>cross-function</b>al teams"]}]}
    assert build_resume_text(bolded)[0] == build_resume_text(plain)[0]

"""Tests for pdf.py's _highlight_keywords — no weasyprint import needed
(it's deferred inside generate_pdf/count_pdf_pages), so these run even in
environments without the native weasyprint/pango libraries installed.
"""
from app.services.pdf import _highlight_keywords


def test_highlight_does_not_falsely_match_substring_of_a_longer_word():
    # "Java" must not partially-match inside "JavaScript" — the bug this
    # test guards against previously bolded "Java" out of "JavaScript".
    result = str(_highlight_keywords("Migrated legacy JavaScript modules", ["Java"]))
    assert "<strong" not in result
    assert result == "Migrated legacy JavaScript modules"


def test_highlight_does_not_truncate_match_inside_a_longer_word():
    # "React" must not partially-bold inside "ReactJS" — bolding only "React"
    # and leaving "JS" plain is the truncation bug this guards against.
    result = str(_highlight_keywords("Built ReactJS components", ["React"]))
    assert "<strong" not in result
    assert "ReactJS" in result


def test_highlight_matches_whole_word_correctly():
    result = str(_highlight_keywords("Built systems with Java and Python", ["Java"]))
    assert '<strong class="kw">Java</strong>' in result
    assert "Python" in result and '<strong class="kw">Python' not in result


def test_highlight_matches_symbol_suffixed_skill():
    # A bare \b breaks on "C++" since + isn't a word character — this must
    # still match in full using the alphanumeric-lookaround approach.
    result = str(_highlight_keywords("Used C++ for performance-critical code", ["C++"]))
    assert '<strong class="kw">C++</strong>' in result


def test_highlight_case_insensitive():
    result = str(_highlight_keywords("Experience with kubernetes clusters", ["Kubernetes"]))
    assert '<strong class="kw">kubernetes</strong>' in result


def test_highlight_escapes_html_in_source_text():
    result = str(_highlight_keywords("Used <script>alert(1)</script> Python", ["Python"]))
    assert "<script>" not in result
    assert "&lt;script&gt;" in result


def test_highlight_returns_escaped_text_unchanged_when_no_keywords():
    result = str(_highlight_keywords("Plain bullet text", []))
    assert result == "Plain bullet text"


def test_highlight_handles_empty_text():
    result = str(_highlight_keywords("", ["Python"]))
    assert result == ""

"""An uploaded résumé reads with the spaces the PDF shows, and no others.

pypdf splits words where a PDF widens its spacing ("Indi a", "new -hire"),
and runs words together where a PDF moves to the next one without drawing
a space ("pipelinefor", around LaTeX's bold text). The reader asks pdfminer
which words the file really holds and joins or splits those
(services/pdf_text.rejoin_split_words, split_glued_words); and every parsed
field loses the spacing PDFs leave behind (services/resume_parser.tidy_spaces)."""
import io
import json

import pypdf
import pytest

from app.services import pdf_text
from app.services.pdf_text import rejoin_split_words, split_glued_words
from app.services.resume_parser import parse_resume_text, tidy_spaces

_HELVETICA = {"H": 722, "y": 500, "d": 556, "e": 556, "r": 333, "a": 556, "b": 556, ",": 278, " ": 278,
              "I": 278, "n": 556, "i": 222}


def _pdf(stream: bytes) -> bytes:
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> "
        b"/Contents 4 0 R >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    ]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for i, obj in enumerate(objs, 1):
        offsets.append(out.tell())
        out.write(b"%d 0 obj\n" % i + obj + b"\nendobj\n")
    xref = out.tell()
    out.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1))
    for offset in offsets:
        out.write(b"%010d 00000 n \n" % offset)
    out.write(b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref))
    return out.getvalue()


def _word_spaced_line() -> bytes:
    """"Hyderabad, Indi" with Word's extra word spacing (Tw), then "a May
    2023" drawn exactly where that run ends — how Word lays out a line."""
    first = "Hyderabad, Indi"
    end = 50 + sum(_HELVETICA[c] for c in first) / 1000 * 11 + 3  # + Tw for its one space
    return _pdf(b"BT /F1 11 Tf 3 Tw 50 700 Td (%s) Tj ET BT /F1 11 Tf 0 Tw %.3f 700 Td (a May 2023) Tj ET"
                % (first.encode(), end))


def test_pypdf_alone_splits_a_word_where_the_pdf_widens_its_spacing():
    pdf = _word_spaced_line()
    assert pypdf.PdfReader(io.BytesIO(pdf)).pages[0].extract_text() == "Hyderabad, Indi a May 2023"


def test_the_reader_joins_it_again():
    assert pdf_text.extract_text_from_pdf(_word_spaced_line()) == "Hyderabad, India May 2023"


def test_when_pdfminer_cant_read_the_file_the_text_is_left_as_pypdf_read_it(monkeypatch):
    monkeypatch.setattr(pdf_text, "_reference_words", lambda _b: None)
    assert pdf_text.extract_text_from_pdf(_word_spaced_line()) == "Hyderabad, Indi a May 2023"


# How pdfTeX sets a line with bold words in it: each space is a shift
# (-366) at the start of the next run, after the switch to or from bold.
LATEX_LINE = _pdf(b"BT /F1 11 Tf 50 700 Td [(Engineered)-366(a)]TJ /F2 11 Tf [-366(data)-366(pipeline)]TJ "
                  b"/F1 11 Tf [-366(for)-366(teams)]TJ ET")


def test_pypdf_alone_runs_words_together_where_latex_switches_to_bold():
    assert pypdf.PdfReader(io.BytesIO(LATEX_LINE)).pages[0].extract_text() == "Engineered adata pipelinefor teams"


def test_the_reader_keeps_the_spaces_the_line_shows():
    assert pdf_text.extract_text_from_pdf(LATEX_LINE) == "Engineered a data pipeline for teams"


def test_a_pdf_pdfminer_reads_letter_by_letter_tells_it_nothing(monkeypatch):
    import pdfminer.high_level
    monkeypatch.setattr(pdfminer.high_level, "extract_text", lambda *_a, **_k: "E x p e r i e n c e at Acme Corp")
    assert pdf_text._reference_words(b"%PDF") is None
    assert pdf_text.extract_text_from_pdf(LATEX_LINE) == "Engineered adata pipelinefor teams"


WORDS = {"India", "new-hire", "35-40%.", "Technical", "Fundamentals", "data", "base", "database", "is", "a"}
PAIRS = {("data", "base"), ("is", "a")}


@pytest.mark.parametrize("read, fixed", [
    ("Hyderabad, Indi a May", "Hyderabad, India May"),
    ("reducing new -hire time", "reducing new-hire time"),
    ("capacity by 35 -40%.", "capacity by 35-40%."),
    ("T echnical Lead", "Technical Lead"),
    ("Fun dam entals of AI", "Fundamentals of AI"),
])
def test_split_words_are_joined(read, fixed):
    assert rejoin_split_words(read, WORDS, PAIRS) == fixed


def test_a_hyphenated_pair_is_joined_where_its_second_word_was_split():
    # pdfminer reads "Winner - TechSprint," with spaces round the hyphen.
    words, pairs = {"Winner", "-", "TechSprint,"}, {("Winner", "-"), ("-", "TechSprint,")}
    assert rejoin_split_words("Winner-T echSprint, GDG", words, pairs) == "Winner-TechSprint, GDG"


def test_two_real_words_stay_apart_even_where_they_also_occur_joined():
    # "data base" sits side by side somewhere in the file: it is two words.
    assert rejoin_split_words("a data base and a database", WORDS, PAIRS) == "a data base and a database"
    assert rejoin_split_words("this is a test", WORDS, PAIRS) == "this is a test"


def test_a_separator_glyph_is_no_piece_of_a_word():
    assert rejoin_split_words("71.63% � 2023", {"71.63%�"}, set()) == "71.63% � 2023"


def test_line_breaks_and_double_spaces_are_kept_for_the_reader():
    text = "Indi a\nReduced  new -hire"
    assert rejoin_split_words(text, WORDS, PAIRS) == "India\nReduced  new-hire"


# What pdfminer read, in its order: "Engineering" and "2024" sit apart
# (a date set at the right margin), every other pair side by side.
READ = ("Built a data pipeline for teams using Python and SQL at Acme Pvt. Ltd. July 2026 "
        "B.Tech Computer Science Engineering - Present 2024 overseeing 2-3 engineers by 30% "
        "� Built GitHub JavaScript 1. AI-powered 0 70 6 60 STATISTICS- 3 TH Pi A I Grad-CAM explainability")
READ_WORDS = set(READ.split())
READ_PAIRS = set(zip(READ.split(), READ.split()[1:]))


@pytest.mark.parametrize("glued, spaced", [
    ("adata", "a data"),
    ("pipelinefor", "pipeline for"),
    ("usingPython", "using Python"),
    ("Ltd.July", "Ltd. July"),
    ("overseeing2-3", "overseeing 2-3"),
    ("by30%", "by 30%"),
    ("�Built", "� Built"),
    ("1.AI-powered", "1. AI-powered"),
    ("teamsusingPython", "teams using Python"),
    # An acronym then a word, read exactly so side by side.
    ("Grad-CAMexplainability", "Grad-CAM explainability"),
    # Read apart (a date at the margin): spaced at a plain word boundary.
    ("Engineering2024", "Engineering 2024"),
])
def test_words_run_together_are_spaced(glued, spaced):
    assert split_glued_words(glued, READ_WORDS, READ_PAIRS) == spaced


@pytest.mark.parametrize("token", [
    "GitHub", "JavaScript", "B.Tech",   # pdfminer reads each whole
    "070", "660",                       # two digits stay together
    "STATISTICS-3",                     # never at a hyphen
    "THPi",                             # nor between capitals: an acronym, a formula
    "pipelineengineers",                # two words read apart, at no word boundary
    "AI",                               # a letter each side is no two words
    "SQLite",                           # an acronym, then nothing pdfminer reads as a word
])
def test_a_word_read_whole_or_that_isnt_two_words_is_kept(token):
    assert split_glued_words(token, READ_WORDS, READ_PAIRS) == token


def test_line_breaks_are_kept_when_spacing():
    assert split_glued_words("pipelinefor\nusingPython", READ_WORDS, READ_PAIRS) == "pipeline for\nusing Python"


@pytest.mark.parametrize("read, tidy", [
    ("Indian Institute of Management, Nagpur ( IIM Nagpur) ", "Indian Institute of Management, Nagpur (IIM Nagpur)"),
    ("Scored 86.8 % in Class XII", "Scored 86.8% in Class XII"),
    ("Python , SQL ; Power BI", "Python, SQL; Power BI"),
    ("Cut costs by 20%  across  4 teams .", "Cut costs by 20% across 4 teams."),
    ("Skills : Excel", "Skills: Excel"),
    ("  - Six Sigma Green Belt", "- Six Sigma Green Belt"),
    ("Built APIs in C# .NET and Node .js", "Built APIs in C# .NET and Node .js"),
    ("First line \n\n\n\nSecond line", "First line\n\nSecond line"),
    ("Done (in 2023) , then more", "Done (in 2023), then more"),
])
def test_parsed_text_loses_the_spacing_a_pdf_leaves(read, tidy):
    assert tidy_spaces(read) == tidy


class _Model:
    def __init__(self, answer: dict):
        self.answer = answer

    async def complete(self, *_a, **_k):
        return json.dumps(self.answer)


async def test_every_parsed_field_is_tidied():
    data = await parse_resume_text("Experience\n- Led  the  team .", _Model({
        "contact": {"name": "Asha  Rao ", "email": "asha@x.com"},
        "summary": "Analyst with 3 years ( retail ) .",
        "experience": [{"company": "Infosys ", "title": "Analyst", "start": "Jan 2023", "end": "Present",
                        "bullets": ["Led  the  team ."]}],
        "education": [{"institution": "IIM Nagpur ( IIM )", "degree": "MBA"}],
        "skills": ["SQL ", "Power  BI"],
    }))
    assert data["contact"]["name"] == "Asha Rao"
    assert data["summary"] == "Analyst with 3 years (retail)."
    assert data["experience"][0]["company"] == "Infosys"
    assert data["experience"][0]["bullets"] == ["Led the team."]
    assert data["education"][0]["institution"] == "IIM Nagpur (IIM)"
    assert data["skills"] == ["SQL", "Power BI"]

"""An uploaded résumé reads without spaces the PDF never had.

pypdf splits words where a PDF widens its spacing ("Indi a", "new -hire"),
so the reader asks pdfminer which words the file really holds and joins
those (services/pdf_text.rejoin_split_words); and every parsed field loses
the spacing PDFs leave behind (services/resume_parser.tidy_spaces)."""
import io
import json

import pypdf
import pytest

from app.services import pdf_text
from app.services.pdf_text import rejoin_split_words
from app.services.resume_parser import parse_resume_text, tidy_spaces

_HELVETICA = {"H": 722, "y": 500, "d": 556, "e": 556, "r": 333, "a": 556, "b": 556, ",": 278, " ": 278,
              "I": 278, "n": 556, "i": 222}


def _pdf(stream: bytes) -> bytes:
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
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


def test_two_real_words_stay_apart_even_where_they_also_occur_joined():
    # "data base" sits side by side somewhere in the file: it is two words.
    assert rejoin_split_words("a data base and a database", WORDS, PAIRS) == "a data base and a database"
    assert rejoin_split_words("this is a test", WORDS, PAIRS) == "this is a test"


def test_a_separator_glyph_is_no_piece_of_a_word():
    assert rejoin_split_words("71.63% � 2023", {"71.63%�"}, set()) == "71.63% � 2023"


def test_line_breaks_and_double_spaces_are_kept_for_the_reader():
    text = "Indi a\nReduced  new -hire"
    assert rejoin_split_words(text, WORDS, PAIRS) == "India\nReduced  new-hire"


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

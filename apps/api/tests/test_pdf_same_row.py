"""A row of side-by-side runs reads as one line (pdf_text._page_text).

The Kaggle résumé set (Qt-made, all 2,484 files) draws a job's header row
("Company Name · July 2011 to November 2012 · Accountant") as separately
placed runs, and pypdf ended a line after every one: thirteen lines per
row, and the model lost the jobs' dates and two of nine jobs.
"""
from app.services.pdf_text import _page_text

# pypdf's visitor stream for that row as the file gives it: a text run, an
# empty run where it ended, a break, the next run a few points on.
ROW = [
    ("Experience", 33.3, 529.6), ("", 69.3, 529.6), ("\n", 28.5, 813.5),
    ("Company Name", 33.3, 517.6), ("", 89.1, 517.6), ("\n", 28.5, 813.5),
    (" ", 93.3, 517.6), ("", 93.3, 517.6), ("\n", 28.5, 813.5),
    ("July 2011", 95.7, 517.6), ("", 126.3, 517.6), ("\n", 28.5, 813.5),
    (" ", 131.1, 517.6), ("", 131.1, 517.6), ("\n", 28.5, 813.5),
    ("to ", 133.5, 517.6), ("", 140.7, 517.6), ("\n", 28.5, 813.5),
    ("November 2012", 143.1, 517.6), ("", 198.9, 517.6), ("\n", 28.5, 813.5),
    ("I was responsible for the General Ledger.", 33.3, 505.6), ("", 200.0, 505.6),
]
# Two columns of a skills table: the second starts far to the right, back
# at the top row — a different line each, as printed.
COLUMNS = [
    ("Account reconciliations", 59.1, 723.5), ("", 150.0, 723.5), ("\n", 28.5, 813.5),
    ("Critical thinking", 59.1, 711.5), ("", 110.7, 711.5), ("\n", 28.5, 813.5),
    ("Accounting operations professional", 169.5, 723.5), ("", 294.4, 723.5), ("\n", 28.5, 813.5),
    ("Excellent facilitator", 169.5, 711.5), ("", 234.4, 711.5),
]
# Side by side on one row, but a column apart: kept as two lines.
FAR = [("Skills", 33.3, 400.0), ("", 60.0, 400.0), ("\n", 28.5, 813.5), ("Python", 300.0, 400.0), ("", 330.0, 400.0)]


class _Page:
    def __init__(self, runs, plain=None):
        self.runs, self.plain = runs, plain

    def extract_text(self, visitor_text=None):
        for text, x, y in self.runs if visitor_text else []:
            visitor_text(text, [1, 0, 0, 1, 0, 0], [1, 0, 0, 1, x, y], None, 10)
        return self.plain if self.plain is not None else "".join(t for t, _, _ in self.runs)


def test_a_row_of_runs_reads_as_one_line():
    assert _page_text(_Page(ROW)).splitlines() == [
        "Experience",
        "Company Name July 2011 to November 2012",
        "I was responsible for the General Ledger.",
    ]


def test_columns_and_rows_keep_their_line_breaks():
    assert _page_text(_Page(COLUMNS)).splitlines() == [
        "Account reconciliations", "Critical thinking", "Accounting operations professional", "Excellent facilitator",
    ]
    assert _page_text(_Page(FAR)).splitlines() == ["Skills", "Python"]


def test_a_page_whose_runs_are_not_its_text_is_left_as_pypdf_reads_it():
    page = _Page(ROW, plain="pypdf's own reading")
    assert _page_text(page) == "pypdf's own reading"

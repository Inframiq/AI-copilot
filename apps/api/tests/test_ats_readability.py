"""Every template, read back the way an ATS reads it.

The ATS reference's export checks, enforced on our own renderer: name and
contact first, every heading a standard one on its own line and before its
content, links as visible addresses, dates in one style, no broken
characters, at least 98% of the résumé's words in the text, and each job's
title/company/dates together.

Each template is read two ways, because parsers differ:
  - pypdf, in content-stream order (what copy-and-paste into Notepad gives —
    the reference's quick test, and what services/ats_check.py runs live);
  - pdfminer's layout analysis, which reorders text boxes by position. It
    is what put centred section headings after their own content in
    ats_executive/ats_portrait before 2026-11-01, while the stream order
    was fine.

Requires pdfminer.six (dev-only) and WeasyPrint's system libraries.
"""
import io
from unittest.mock import patch

import pytest

pytest.importorskip("weasyprint")
pdfminer_high_level = pytest.importorskip("pdfminer.high_level")

from pypdf import PdfReader  # noqa: E402

from app.services import pdf as P  # noqa: E402
from app.services.ats_check import check_pdf, check_text  # noqa: E402
from app.services.resume_dates import is_standard_date, tidy_date, tidy_resume_dates  # noqa: E402

RICH = {
    "contact": {
        "name": "Asha Rao", "email": "asha.rao@example.com", "phone": "+91 98765 43210",
        "location": "Visakhapatnam, Andhra Pradesh, India",
        "linkedin": "https://www.linkedin.com/in/asharao/", "linkedin_label": "LinkedIn",
        "github": "github.com/asharao", "github_label": "GitHub", "website": "asharao.dev",
    },
    "summary": "Backend engineer building financial workflow systems in Python and Go for fintech teams.",
    "experience": [
        # Two roles at one company: the grouped, nested rendering.
        {"title": "Senior Software Engineer", "company": "Fintech Pvt Ltd", "location": "Remote",
         "start": "06/2025", "end": "Current",
         "bullets": ["Built a financial reconciliation workflow in Python, cutting effort by 40%.",
                     "Profiled efficient office file flows with fluent fixtures."]},
        {"title": "Software Engineer", "company": "Fintech Pvt Ltd", "location": "Remote",
         "start": "January 2023", "end": "May 2025",
         "bullets": ["Shipped an offline-first ledger used by 12 branches."]},
        # Short title and company: the content-length case that once
        # scrambled dates to the end of the text.
        {"title": "Eng", "company": "Acme", "start": "2021", "end": "2022",
         "bullets": ["Did stuff."]},
    ],
    "projects": [
        {"name": "Ledger", "link": "github.com/asharao/ledger", "live_link": "ledger.asharao.dev",
         "tech_stack": "Python, FastAPI", "start": "Jan 2024", "end": "Mar 2024",
         "bullets": ["Wrote the sync engine."]},
    ],
    "education": [
        {"degree": "Bachelor of Technology (B.Tech), Computer Science", "institution": "Andhra University",
         "year": "2021", "gpa": "8.5/10", "honors": "First Class"},
    ],
    "skills": ["Python", "Go", "PostgreSQL", "Node.js", "C++"],
    "certifications": ["AWS Certified Cloud Practitioner"],
    "achievements": ["Won the campus hackathon"],
    "leadership": ["Led the coding club"],
    "volunteer": ["Taught Python at a local school"],
    "languages": [{"name": "English", "level": "Fluent"}, {"name": "Telugu", "level": "Native"}],
    "interests": ["Chess"],
}


def _render(content: dict, template_id: str, **kwargs) -> bytes:
    """generate_pdf with the photo templates given the placeholder portrait
    — the photo itself is not what is under test."""
    status = P.PHOTO_UNAVAILABLE if template_id in P.TEMPLATES_REQUIRING_PHOTO else P.PHOTO_NONE
    with patch.object(P, "_sanitize_resume_content", lambda c: (c, status)):
        return P.generate_pdf(content, template_id, **kwargs)


def _errors(findings) -> list:
    return [(f.id, f.field, f.message) for f in findings if f.level == "error"]


@pytest.mark.parametrize("page_size", ["A4", "Letter"])
@pytest.mark.parametrize("template_id", sorted(P.ALLOWED_TEMPLATES))
def test_every_template_reads_clean_in_stream_order(template_id, page_size):
    pdf = _render(RICH, template_id, page_size=page_size)
    text, findings = check_pdf(RICH, pdf, template_id)
    assert _errors(findings) == [], text


# The settings a user can move. Line breaks and the gaps between lines shift
# with each, and extraction depends on those gaps (a tight gap under the
# name once ran it into the email), so each template is read at the edges.
STYLE_EDGES = {
    "small-tight": {"heading_size_delta": -1, "body_size_delta": -1, "line_spacing": 1.0, "paragraph_spacing": 0},
    "large-airy": {"heading_size_delta": 1, "body_size_delta": 1, "line_spacing": 1.6, "paragraph_spacing": 24},
    "serif-letter": {"font_choice": "classic_serif", "page_size": "Letter"},
    "lato": {"font_choice": "modern_sans"},
}


@pytest.mark.parametrize("edge", sorted(STYLE_EDGES))
@pytest.mark.parametrize("template_id", sorted(P.ALLOWED_TEMPLATES))
def test_every_template_reads_clean_at_every_style_edge(template_id, edge):
    pdf = _render(RICH, template_id, **STYLE_EDGES[edge])
    text, findings = check_pdf(RICH, pdf, template_id)
    assert _errors(findings) == [], text
    layout = pdfminer_high_level.extract_text(io.BytesIO(pdf))
    assert _errors(check_text(RICH, layout, template_id)) == [], layout


def test_stray_list_bullets_are_caught():
    text = "\n".join(["Asha Rao", "a@x.com | +91 98765 43210", "AWARDS", "Dean's List", "•", "•"])
    content = {"contact": {"name": "Asha Rao", "email": "a@x.com", "phone": "+91 98765 43210"}, "awards": ["Dean's List"]}
    assert "stray-bullets" in {f.id for f in check_text(content, text)}


@pytest.mark.parametrize("template_id", sorted(P.ALLOWED_TEMPLATES))
def test_every_template_reads_clean_by_layout_analysis(template_id):
    pdf = _render(RICH, template_id)
    text = pdfminer_high_level.extract_text(io.BytesIO(pdf))
    assert _errors(check_text(RICH, text, template_id)) == [], text


@pytest.mark.parametrize("font_choice", sorted(P.FONT_STACKS))
def test_every_font_embeds_its_bundled_face_and_keeps_fi_words_whole(font_choice):
    """No ligatures: "fi", "fl" and "ff" stay two letters, so "financial",
    "workflow" and "efficient" come out whole in both extractors."""
    pdf = _render(RICH, "ats_clean", font_choice=font_choice)
    reader = PdfReader(io.BytesIO(pdf))
    fonts = {str(f.get_object()["/BaseFont"]) for f in reader.pages[0]["/Resources"]["/Font"].values()}
    family = next(f for f in P.BUNDLED_FONTS if P.FONT_STACKS[font_choice].startswith(f'"{f}"'))
    assert all(family.replace(" ", "-") in name for name in fonts), fonts
    for text in (reader.pages[0].extract_text(), pdfminer_high_level.extract_text(io.BytesIO(pdf))):
        for word in ("financial", "workflow", "efficient", "office", "fluent", "offline"):
            assert word in text, word


def test_the_pdf_title_is_the_name_and_resume():
    reader = PdfReader(io.BytesIO(_render(RICH, "ats_clean")))
    assert reader.metadata.title == "Asha Rao - Resume"


def test_page_size_sets_the_paper():
    a4 = PdfReader(io.BytesIO(_render(RICH, "ats_clean"))).pages[0].mediabox
    letter = PdfReader(io.BytesIO(_render(RICH, "ats_clean", page_size="Letter"))).pages[0].mediabox
    assert (round(float(a4.width)), round(float(a4.height))) == (595, 842)
    assert (round(float(letter.width)), round(float(letter.height))) == (612, 792)


def test_an_unknown_page_size_renders_a4():
    box = PdfReader(io.BytesIO(_render(RICH, "ats_clean", page_size="Tabloid"))).pages[0].mediabox
    assert round(float(box.width)) == 595


@pytest.mark.parametrize("template_id", sorted(P.ALLOWED_TEMPLATES))
def test_links_print_as_addresses_never_labels(template_id):
    text = PdfReader(io.BytesIO(_render(RICH, template_id))).pages[0].extract_text()
    assert "linkedin.com/in/asharao" in text
    assert "github.com/asharao" in text
    assert "asharao.dev" in text


@pytest.mark.parametrize("template_id", sorted(P.ALLOWED_TEMPLATES))
def test_dates_print_in_one_style_with_present(template_id):
    text = PdfReader(io.BytesIO(_render(RICH, template_id))).pages[0].extract_text()
    assert "Jun 2025" in text and "Jan 2023" in text
    assert "Present" in text
    for raw in ("06/2025", "January 2023", "Current"):
        assert raw not in text


# ── The check itself catches what it is for ─────────────────────────────────
# Text the old templates really produced (2026-11-01 probe), each with the
# finding it must raise.

def test_letter_spaced_headings_are_caught():
    text = "Asha Rao\nasha.rao@example.com | +91 98765 43210\nS U M M A RY\nBackend engineer"
    content = {"contact": RICH["contact"] | {"linkedin": None, "github": None, "website": None},
               "summary": "Backend engineer"}
    assert ("heading-unreadable", "summary") in {(f.id, f.field) for f in check_text(content, text)}


def test_a_heading_after_its_content_is_caught():
    text = ("Asha Rao\nasha.rao@example.com | +91 98765 43210\nSUMMARY\nBackend engineer\n"
            "B.Tech, Computer Science, Andhra University | 2021\nEDUCATION")
    content = {"contact": RICH["contact"] | {"linkedin": None, "github": None, "website": None},
               "summary": "Backend engineer",
               "education": [{"degree": "B.Tech, Computer Science", "institution": "Andhra University", "year": "2021"}]}
    assert ("heading-out-of-order", "education") in {(f.id, f.field) for f in check_text(content, text)}


def test_a_contact_line_at_the_end_is_caught():
    text = "Asha Rao\nSUMMARY\nBackend engineer\nEXPERIENCE\nEng, Acme | 2021 - 2022\n- Did stuff.\nasha.rao@example.com | +91 98765 43210"
    content = {"contact": {"name": "Asha Rao", "email": "asha.rao@example.com", "phone": "+91 98765 43210"},
               "summary": "Backend engineer",
               "experience": [{"title": "Eng", "company": "Acme", "start": "2021", "end": "2022", "bullets": ["Did stuff."]}]}
    ids = {f.id for f in check_text(content, text)}
    assert "contact-not-at-top" in ids


def test_a_link_hidden_behind_a_label_is_caught():
    text = "Asha Rao\nasha.rao@example.com | +91 98765 43210 | LinkedIn"
    content = {"contact": {"name": "Asha Rao", "email": "asha.rao@example.com", "phone": "+91 98765 43210",
                           "linkedin": "linkedin.com/in/asharao"}}
    assert ("link-unreadable", "contact.linkedin") in {(f.id, f.field) for f in check_text(content, text)}


def test_broken_characters_and_lost_words_are_caught():
    text = "Asha Rao\nasha.rao@example.com | +91 98765 43210\nSUMMARY\nﬁnancial �"
    content = {"contact": {"name": "Asha Rao", "email": "asha.rao@example.com", "phone": "+91 98765 43210"},
               "summary": "financial workflow systems built for fintech teams across India"}
    ids = {f.id for f in check_text(content, text)}
    assert {"broken-characters", "words-missing"} <= ids


def test_unreadable_dates_and_writing_points_are_reported():
    content = {
        "contact": {"name": "Asha Rao", "email": "a@x.com", "phone": "+91 98765 43210"},
        "experience": [{"title": "Intern", "company": "Beta", "start": "Summer 2024", "end": "Q3 2024",
                        "bullets": ["Responsible for testing the app."]}],
        "education": [{"degree": "B.Tech", "institution": "AU", "year": "2025", "gpa": "8.5"}],
    }
    findings = {(f.id, f.field) for f in check_text(content, "Asha Rao\na@x.com | +91 98765 43210")}
    assert ("date-unreadable", "experience.0.start") in findings
    assert ("date-unreadable", "experience.0.end") in findings
    assert ("filler", "experience.0.bullets.0") in findings
    assert ("gpa-scale", "education.0.gpa") in findings


def test_a_photo_template_is_flagged_for_portals():
    content = {"contact": {"name": "Asha Rao", "email": "a@x.com", "phone": "+91 98765 43210"}}
    for template_id in P.TEMPLATES_REQUIRING_PHOTO:
        assert "photo-template" in {f.id for f in check_text(content, "Asha Rao\na@x.com +91 98765 43210", template_id)}
    assert "photo-template" not in {f.id for f in check_text(content, "Asha Rao\na@x.com +91 98765 43210", "ats_clean")}


# ── Dates ───────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw, tidy", [
    ("Jun 2025", "Jun 2025"), ("June 2025", "Jun 2025"), ("Sept. 2021", "Sep 2021"),
    ("Jan '22", "Jan 2022"), ("06/2025", "Jun 2025"), ("6-2025", "Jun 2025"),
    ("2025-06", "Jun 2025"), ("2025/6", "Jun 2025"), ("2022", "2022"),
    ("Current", "Present"), ("currently", "Present"), ("Till date", "Present"), ("Ongoing", "Present"),
    ("Summer 2025", "Summer 2025"), ("Q2 2025", "Q2 2025"), ("13/2025", "13/2025"), ("", ""),
])
def test_tidy_date_matches_the_studio_picker(raw, tidy):
    """Same readings as apps/web/lib/month-year.ts tidyDate."""
    assert tidy_date(raw) == tidy


def test_is_standard_date():
    assert is_standard_date("Jun 2025") and is_standard_date("2022") and is_standard_date("Present")
    assert not is_standard_date("06/2025") and not is_standard_date("Summer 2025")


def test_tidy_resume_dates_reaches_role_projects_and_leaves_the_original_alone():
    content = {"experience": [{"start": "06/2025", "end": "current",
                               "projects": [{"start": "2025-01", "end": "Ongoing"}]}],
               "projects": [{"start": "March 2024"}]}
    out = tidy_resume_dates(content)
    assert out["experience"][0]["start"] == "Jun 2025" and out["experience"][0]["end"] == "Present"
    assert out["experience"][0]["projects"][0] == {"start": "Jan 2025", "end": "Present"}
    assert out["projects"][0]["start"] == "Mar 2024"
    assert content["experience"][0]["start"] == "06/2025"


# ── Against a job post (the reference's tailoring rules 3, 4 and 6) ─────────

def _jd(**overrides):
    from app.services.tailoring import JDAnalysis
    base = dict(
        exact_technical_tools=["Python", "Kubernetes"], methodologies_and_frameworks=["CI/CD"],
        domain_expertise_themes=[], seniority_indicators=[], ats_filter_phrases=[],
        target_job_titles=["Data Engineer"], importance={"python": "high", "kubernetes": "high"},
    )
    return JDAnalysis(**{**base, **overrides})


def _ids(findings):
    return [(f.id, f.message.split(" ")[0]) for f in findings]


def test_an_important_skill_only_listed_in_skills_is_flagged():
    from app.services.ats_check import check_against_jd
    content = {"skills": ["Python", "Kubernetes"], "summary": "Data engineer.",
               "experience": [{"title": "Data Engineer", "company": "A", "bullets": ["Built Python ETL jobs."]}]}
    found = _ids(check_against_jd(content, _jd()))
    assert ("skill-not-shown", "Kubernetes") in found
    assert ("skill-not-shown", "Python") not in found


def test_a_title_never_held_and_not_in_the_summary_is_flagged():
    from app.services.ats_check import check_against_jd
    content = {"summary": "Backend engineer.", "skills": [],
               "experience": [{"title": "Backend Engineer", "company": "A", "bullets": []}]}
    assert "title-not-mentioned" in {f.id for f in check_against_jd(content, _jd())}
    content["summary"] = "Backend engineer moving into Data Engineer work."
    assert "title-not-mentioned" not in {f.id for f in check_against_jd(content, _jd())}


def test_a_held_title_needs_no_summary_mention():
    from app.services.ats_check import check_against_jd
    content = {"summary": "", "skills": [], "experience": [{"title": "Senior Data Engineer", "company": "A", "bullets": []}]}
    assert "title-not-mentioned" not in {f.id for f in check_against_jd(content, _jd(target_job_titles=["Data Engineer"]))}


def test_a_keyword_repeated_past_five_uses_is_flagged():
    from app.services.ats_check import MAX_TERM_USES, check_against_jd
    bullets = [f"Used Python for job {i}." for i in range(MAX_TERM_USES)]
    content = {"skills": ["Python"], "experience": [{"title": "Data Engineer", "company": "A", "bullets": bullets}]}
    found = check_against_jd(content, _jd())
    assert any(f.id == "keyword-repeated" and f.message.startswith("Python appears 6 times") for f in found)
    content["experience"][0]["bullets"] = bullets[:-1]
    assert "keyword-repeated" not in {f.id for f in check_against_jd(content, _jd())}


def test_without_importance_ratings_the_exact_tools_count_as_important():
    from app.services.ats_check import check_against_jd
    content = {"skills": ["Kubernetes"], "experience": [{"title": "Data Engineer", "company": "A", "bullets": ["Ran batch jobs."]}]}
    assert ("skill-not-shown", "Kubernetes") in _ids(check_against_jd(content, _jd(importance={})))


def test_a_job_without_a_title_is_an_error_and_one_without_points_a_warning():
    """Seen on a real uploaded résumé (2026-11-01): roles printed as
    ", WIPRO | Jul 2019 - Jul 2022" with no title and no points, and the
    check said it read cleanly."""
    content = {
        "contact": {"name": "Asha Rao", "email": "a@x.com", "phone": "+91 98765 43210"},
        "experience": [
            {"title": "", "company": "WIPRO", "start": "Jul 2019", "end": "Jul 2022", "bullets": []},
            {"title": "Engineer", "company": "Acme", "start": "2018", "end": "2019", "bullets": ["Built it."]},
        ],
    }
    findings = {(f.id, f.level, f.field) for f in check_text(content, "Asha Rao\na@x.com | +91 98765 43210")}
    assert ("title-missing", "error", "experience.0.title") in findings
    assert ("no-points", "warning", "experience.0.bullets") in findings
    assert not {f for f in findings if f[2] and f[2].startswith("experience.1")}


# ── Coursework (student set) ────────────────────────────────────────────────

def test_a_coursework_heading_is_filed_as_coursework_not_certifications():
    from app.services.resume_parser import _home_of
    for heading in ("Relevant Coursework", "COURSEWORK", "Courses Taken", "Course work"):
        assert _home_of(heading) == "coursework", heading
    assert _home_of("Certifications & Training") == "certifications"
    assert _home_of("Online Courses") == "certifications"


@pytest.mark.parametrize("template_id", sorted(P.ALLOWED_TEMPLATES))
def test_coursework_reads_clean_in_every_template(template_id):
    content = {**RICH, "coursework": ["Data Structures", "Operating Systems", "DBMS"]}
    pdf = _render(content, template_id)
    text, findings = check_pdf(content, pdf, template_id)
    assert _errors(findings) == [], text
    assert "COURSEWORK" in text.upper() and "Operating Systems" in text


def test_coursework_counts_as_evidence_for_scoring():
    from app.services.ats import build_resume_text
    full, _ = build_resume_text({"coursework": ["Machine Learning"]})
    assert "Machine Learning" in full


# ── Every template prints every section of its set (fix 8) ──────────────────
# Student / fresher: Objective, Education with CGPA, Internships, Projects,
# Skills, Coursework, Leadership, Awards. Working professional: Summary,
# Experience with a role's client projects, Skills, Certifications,
# Education. Read back by both extractors, with no ATS error.

STUDENT_FULL = {
    "contact": {"name": "Asha Rao", "email": "asha.rao@example.com", "phone": "+91 98765 43210",
                "location": "Hyderabad, India", "linkedin": "linkedin.com/in/asharao", "github": "github.com/asharao"},
    "objective": "Final-year Computer Science student seeking a backend engineering internship.",
    "education": [{"degree": "Bachelor of Technology (B.Tech), Computer Science", "institution": "JNTU Hyderabad",
                   "year": "Expected May 2027", "gpa": "8.7/10"}],
    "experience": [{"title": "Software Engineering Intern", "company": "Acme Labs", "start": "May 2026", "end": "Jul 2026",
                    "bullets": ["Built a caching layer that cut API response time by 35%."]}],
    "projects": [{"name": "Campus Marketplace", "link": "github.com/asharao/market", "tech_stack": "React, FastAPI",
                  "bullets": ["Listings app used by 400+ students."]}],
    "skills": ["Python", "Java", "SQL"],
    "coursework": ["Data Structures", "Operating Systems", "DBMS"],
    "leadership": ["President, Coding Club"],
    "awards": ["Smart India Hackathon 2025, finalist"],
}
STUDENT_HEADINGS = ["OBJECTIVE", "EDUCATION", "INTERNSHIPS", "PROJECTS", "SKILLS", "COURSEWORK", "LEADERSHIP", "AWARDS"]

PRO_FULL = {
    "contact": {"name": "Ravi Kumar", "email": "ravi.kumar@example.com", "phone": "+91 99887 76655",
                "location": "Bengaluru, India", "linkedin": "linkedin.com/in/ravikumar"},
    "summary": "Technology lead with twelve years delivering payment platforms for banks.",
    "experience": [{"title": "Technology Lead", "company": "Infosys", "start": "Jan 2020", "end": None,
                    "bullets": ["Led a team of 14 across two time zones."],
                    "projects": [{"client": "Barclays", "domain": "Banking", "role": "Lead", "start": "Jan 2020",
                                  "end": "Present", "bullets": ["Moved the ledger to a new core in 9 months."]}]}],
    "skills": ["Java", "Kafka", "AWS"],
    "certifications": ["AWS Certified Solutions Architect - Associate"],
    "education": [{"degree": "Bachelor of Engineering (B.E.)", "institution": "VTU", "year": "2012"}],
    "achievements": ["Cut payment failures by 40% across 3 markets"],
}
PRO_HEADINGS = ["SUMMARY", "EXPERIENCE", "SKILLS", "CERTIFICATIONS", "EDUCATION"]


def _sets():
    from app.services.pdf import TEMPLATE_SETS
    return TEMPLATE_SETS


@pytest.mark.parametrize("template_id", sorted(t for t, s in _sets().items() if s == "student"))
def test_every_student_template_prints_every_student_section(template_id):
    pdf = _render(STUDENT_FULL, template_id)
    text, findings = check_pdf(STUDENT_FULL, pdf, template_id)
    assert _errors(findings) == [], text
    upper = text.upper()
    for heading in STUDENT_HEADINGS:
        assert heading in upper, (heading, text)
    flat = " ".join(text.split())  # the CGPA label is joined by a no-break space
    assert "CGPA 8.7/10" in flat and "Expected May 2027" in flat
    layout = pdfminer_high_level.extract_text(io.BytesIO(pdf))
    assert _errors(check_text(STUDENT_FULL, layout, template_id)) == [], layout


@pytest.mark.parametrize("template_id", sorted(t for t, s in _sets().items() if s == "professional"))
def test_every_professional_template_prints_every_professional_section(template_id):
    pdf = _render(PRO_FULL, template_id)
    text, findings = check_pdf(PRO_FULL, pdf, template_id)
    assert _errors(findings) == [], text
    upper = text.upper()
    for heading in PRO_HEADINGS:
        assert heading in upper, (heading, text)
    # A role's client project prints under it.
    assert "Barclays" in text and "Moved the ledger" in text
    layout = pdfminer_high_level.extract_text(io.BytesIO(pdf))
    assert _errors(check_text(PRO_FULL, layout, template_id)) == [], layout


def test_impact_puts_the_strongest_evidence_before_the_work_history():
    text = PdfReader(io.BytesIO(_render(PRO_FULL, "ats_impact"))).pages[0].extract_text().upper()
    assert text.index("SUMMARY") < text.index("SKILLS") < text.index("ACHIEVEMENTS") < text.index("EXPERIENCE")

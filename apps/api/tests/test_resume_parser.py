"""Parser behaviour around multiple roles at one employer (promotion /
internal transfer). The prose rule has been in PARSE_SYSTEM for a while but
resumes still came back with the earlier role dropped — a concrete worked
example in the prompt makes the fast model follow it far more reliably.
"""
import json
import re

import pytest
from unittest.mock import AsyncMock, MagicMock

from app.services.resume_parser import (
    PARSE_SYSTEM,
    ResumeUnreadable,
    extract_text_from_pdf,
    parse_resume_text,
)


def _provider_returning(payload: dict) -> MagicMock:
    provider = MagicMock()
    provider.complete = AsyncMock(return_value=json.dumps(payload))
    return provider


def test_parse_system_prompt_carries_a_worked_multi_role_example():
    # A named company that appears at least twice inside a single worked
    # example block — proof the prompt shows (not just tells) how a promotion
    # becomes two separate entries.
    assert "Example" in PARSE_SYSTEM
    assert PARSE_SYSTEM.count("Northwind") >= 2


def test_parse_system_prompt_tells_the_model_to_use_hyperlink_urls():
    assert "Hyperlinks found in this document" in PARSE_SYSTEM


@pytest.mark.parametrize("field", ['"headline"', '"objective"', '"website"', '"awards"',
                                   '"achievements"', '"leadership"', '"volunteer"', '"interests"'])
def test_parse_system_prompt_asks_for_every_field_the_resume_can_hold(field):
    # The headline under the name was never asked for, so it always came
    # back empty — same for these other sections the templates print.
    assert field in PARSE_SYSTEM


def test_the_headline_is_never_made_up_from_a_job_title():
    assert re.search(r"headline.{0,600}Never build one from the\s+latest job title", PARSE_SYSTEM, re.S)


@pytest.mark.asyncio
async def test_headline_and_the_other_sections_come_through_cleaned():
    payload = {
        "contact": {"name": "Jane Doe", "email": "jane@example.com"},
        "headline": "  Supply Chain Analyst | SAP · Power BI ",
        "summary": "Analyst with five years in procurement.",
        "objective": "Analyst with five years in procurement.",
        "experience": [], "education": [], "skills": [],
        "awards": ["Spot Award 2023", "", 7],
        "volunteer": "not a list",
    }
    result = await parse_resume_text("<resume text>", _provider_returning(payload))
    assert result["headline"] == "Supply Chain Analyst | SAP · Power BI"
    assert result["summary"] == "Analyst with five years in procurement."
    assert result["objective"] is None  # never printed twice
    assert result["awards"] == ["Spot Award 2023"]
    assert result["volunteer"] == [] and result["leadership"] == []
    assert result["interests"] == []


def test_hobbies_are_read_as_interests():
    assert re.search(r'"interests".{0,400}"Hobbies"', PARSE_SYSTEM, re.S)


@pytest.mark.asyncio
async def test_interests_come_through_cleaned():
    payload = {
        "contact": {"name": "Jane Doe", "email": "jane@example.com"},
        "experience": [], "education": [], "skills": [],
        "interests": [" Chess ", "", None, "Trekking"],
    }
    result = await parse_resume_text("<resume text>", _provider_returning(payload))
    assert result["interests"] == ["Chess", "Trekking"]


@pytest.mark.asyncio
async def test_a_missing_headline_stays_empty():
    payload = {"contact": {"name": "Jane"}, "headline": "", "experience": [], "education": [], "skills": []}
    result = await parse_resume_text("<resume text>", _provider_returning(payload))
    assert result["headline"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("raw", ['{"contact": {"name": "Jane", "experience": [', "Sorry, I can't help", "[]"])
async def test_unreadable_model_output_fails_instead_of_a_blank_resume(raw):
    provider = MagicMock()
    provider.complete = AsyncMock(return_value=raw)
    with pytest.raises(ResumeUnreadable):
        await parse_resume_text("<resume text>", provider)


# ---------------------------------------------------------------------------
# extract_text_from_pdf: a PDF hyperlink's visible anchor text (e.g. the bare
# word "GitHub") never contains the actual destination URL — pypdf's
# extract_text() only returns what's visibly printed. Without pulling the
# URI from the link annotation too, the parser prompt above never sees the
# real github.com/linkedin.com URL, only the word "GitHub"/"LinkedIn", so it
# has nothing to put in contact.github/contact.linkedin. See _extract_link_uris.
# ---------------------------------------------------------------------------

weasyprint = pytest.importorskip("weasyprint")


def _pdf_with_link(anchor_text: str, href: str) -> bytes:
    import weasyprint as wp
    html = f'<html><body><p>Contact: <a href="{href}">{anchor_text}</a></p></body></html>'
    return wp.HTML(string=html).write_pdf()


def test_extract_text_from_pdf_surfaces_hyperlink_url_behind_bare_anchor_text():
    pdf_bytes = _pdf_with_link("GitHub", "https://github.com/janedoe/my-repo")
    text = extract_text_from_pdf(pdf_bytes)
    assert "GitHub" in text
    assert "https://github.com/janedoe/my-repo" in text


def test_extract_text_from_pdf_dedupes_repeated_hyperlinks():
    import weasyprint as wp
    html = (
        '<html><body>'
        '<p><a href="https://github.com/janedoe/repo-one">GitHub</a></p>'
        '<p><a href="https://github.com/janedoe/repo-one">GitHub</a></p>'
        '</body></html>'
    )
    pdf_bytes = wp.HTML(string=html).write_pdf()
    text = extract_text_from_pdf(pdf_bytes)
    assert text.count("https://github.com/janedoe/repo-one") == 1


def test_extract_text_from_pdf_omits_hyperlink_section_when_no_links():
    import weasyprint as wp
    pdf_bytes = wp.HTML(string="<html><body><p>Jane Doe, no links here.</p></body></html>").write_pdf()
    text = extract_text_from_pdf(pdf_bytes)
    assert "Hyperlinks found" not in text




@pytest.mark.asyncio
async def test_two_roles_at_one_company_survive_as_separate_entries():
    payload = {
        "contact": {"name": "Jane Doe", "email": "jane@example.com"},
        "experience": [
            {
                "company": "Acme Corp", "title": "Senior Software Engineer",
                "start": "Jan 2023", "end": "Present",
                "bullets": ["Led the payments platform rewrite."],
            },
            {
                "company": "Acme Corp", "title": "Software Engineer",
                "start": "Jun 2020", "end": "Dec 2022",
                "bullets": ["Built the original checkout service."],
            },
        ],
        "education": [],
        "skills": ["Python"],
    }
    result = await parse_resume_text("<resume text>", _provider_returning(payload))

    exp = result["experience"]
    assert len(exp) == 2
    assert [e["title"] for e in exp] == ["Senior Software Engineer", "Software Engineer"]
    assert [e["company"] for e in exp] == ["Acme Corp", "Acme Corp"]
    # Each role keeps only its own bullets — no cross-contamination or merge.
    assert exp[0]["bullets"] == ["Led the payments platform rewrite."]
    assert exp[1]["bullets"] == ["Built the original checkout service."]


def test_the_prompt_reads_projects_inside_a_job():
    assert re.search(r"PROJECTS INSIDE A JOB.{0,900}never guess a domain", PARSE_SYSTEM, re.S)
    assert '"client": "client as printed, else null"' in PARSE_SYSTEM


@pytest.mark.asyncio
async def test_projects_inside_a_job_come_through_cleaned():
    payload = {
        "contact": {"name": "Asha", "email": "a@x.com"},
        "experience": [
            {"company": "Infosys", "title": "Senior Systems Engineer", "start": "Jun 2019", "end": "Present",
             "bullets": ["Mentored joiners."],
             "projects": [
                 {"client": " Barclays ", "name": "Payments Hub", "role": "Module Lead", "domain": None,
                  "start": "Jan 2022", "end": "", "tech_stack": "Java", "bullets": [" Led the module. ", "", 4]},
                 {"client": None, "bullets": []},          # empty: dropped
                 "Project: Order Tracker",                  # not an object: dropped
             ]},
            {"company": "Acme", "title": "Intern", "start": "2019", "end": "2019", "bullets": [], "projects": "n/a"},
            {"company": "Beta", "title": "Engineer", "start": "2018", "bullets": []},
        ],
        "education": [], "skills": [],
    }
    result = await parse_resume_text("<resume text>", _provider_returning(payload))
    jobs = result["experience"]
    assert jobs[0]["projects"] == [{
        "client": "Barclays", "name": "Payments Hub", "role": "Module Lead",
        "start": "Jan 2022", "tech_stack": "Java", "bullets": ["Led the module."],
    }]
    assert jobs[0]["bullets"] == ["Mentored joiners."]
    assert jobs[1]["projects"] == [] and jobs[2]["projects"] == []


def test_the_prompt_reads_an_educations_honors():
    assert '"honors": "honors or distinction printed on this entry, or null"' in PARSE_SYSTEM
    # Never pulled out of a separate awards section, so nothing prints twice.
    assert re.search(r'education "honors".{0,700}stays in "awards"\s+and is never copied', PARSE_SYSTEM, re.S)


@pytest.mark.asyncio
async def test_education_honors_come_through_cleaned():
    payload = {
        "contact": {"name": "Asha", "email": "a@x.com"},
        "experience": [], "skills": [],
        "education": [
            {"institution": "GITAM", "degree": "B.Tech", "year": "2019", "gpa": "78%",
             "honors": " First Class with Distinction "},
            {"institution": "MIT", "degree": "BSc", "year": "2015", "gpa": "3.9/4.0", "honors": ""},
            {"institution": "IIT", "degree": "MTech", "year": "2021", "gpa": "8.6", "honors": None},
            {"institution": "NIT", "degree": "BE", "year": "2012", "gpa": "8.1", "honors": " 8.1"},
            {"institution": "VIT", "degree": "BCA", "year": "2010", "honors": ["Dean's List"]},
        ],
    }
    result = await parse_resume_text("<resume text>", _provider_returning(payload))
    edu = result["education"]
    assert edu[0]["honors"] == "First Class with Distinction"
    # Blank, missing, a repeat of the GPA, or not text: no key at all.
    assert all("honors" not in e for e in edu[1:])
    assert edu[0]["gpa"] == "78%" and edu[3]["gpa"] == "8.1"

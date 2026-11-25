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
from app.services.plain_text import plain_text


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
    # Keyboard text: the middle dot is one of the bullets plain_text replaces.
    assert result["headline"] == "Supply Chain Analyst | SAP - Power BI"
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


_POINTS = ["Overall, around 8+ years of experience as Security Analyst.",
           "Security incident handling with SIEM",
           "Strong knowledge in Security Monitoring and Operation."]
_PARAGRAPH = ("Overall, around 8+ years of experience as Security Analyst. Security incident handling "
              "with SIEM. Strong knowledge in Security Monitoring and Operation.")


@pytest.mark.asyncio
@pytest.mark.parametrize("summary", [
    # The three shapes the model gave back for one bulleted summary.
    "\n".join("➢ " + p for p in _POINTS),
    "  ".join("➢ " + p for p in _POINTS),
    "\n".join("- " + p for p in _POINTS),
    "\n".join(f"{i}. {p}" for i, p in enumerate(_POINTS, 1)),
    # A point wrapped across lines stays one point.
    "• Overall, around 8+ years of experience\nas Security Analyst.\n• Security incident handling with SIEM"
    "\n• Strong knowledge in Security Monitoring and Operation.",
])
async def test_a_summary_written_as_points_reads_back_as_a_paragraph(summary):
    payload = {"contact": {"name": "S", "email": "s@x.com"}, "experience": [], "education": [], "skills": [],
               "summary": summary, "objective": "➢ To grow\n➢ To learn"}
    result = await parse_resume_text("<resume text>", _provider_returning(payload))
    assert result["summary"] == _PARAGRAPH
    assert result["objective"] == "To grow. To learn."


@pytest.mark.asyncio
@pytest.mark.parametrize("summary", [
    "Backend engineer - 6 years in payments.\nLed the move to Kubernetes.",
    "Engineer · Python · AWS. Built data platforms used by 2M people.",
    "Shipped 3 products.\n- Kept as written when only one line is a point.",
])
async def test_a_summary_that_is_not_a_list_is_left_as_written(summary):
    payload = {"contact": {"name": "S", "email": "s@x.com"}, "experience": [], "education": [], "skills": [],
               "summary": summary}
    result = await parse_resume_text("<resume text>", _provider_returning(payload))
    assert result["summary"] == plain_text(summary)


@pytest.mark.parametrize("line, skills", [
    # The tools a recruiter searches for sit in the brackets, after a colon
    # or after a spaced dash; a group name ("Languages", "Cloud / DevOps")
    # isn't a skill itself.
    ("SIEM Monitoring & Log Analysis (Microsoft Sentinel, ArcSight)",
     ["SIEM Monitoring & Log Analysis", "Microsoft Sentinel", "ArcSight"]),
    ("Threat Intelligence & IOC Validation - Cisco Talos, Anomaly threat stream",
     ["Threat Intelligence & IOC Validation", "Cisco Talos", "Anomaly threat stream"]),
    ("Cloud / DevOps   : AWS (EC2, S3, Lambda), Docker", ["AWS", "EC2", "S3", "Lambda", "Docker"]),
    ("Languages: Go, SQL; Practices: TDD, Observability (Datadog, OpenTelemetry)",
     ["Go", "SQL", "TDD", "Observability", "Datadog", "OpenTelemetry"]),
    ("Engineering Leadership | P&L Ownership", ["Engineering Leadership", "P&L Ownership"]),
    # Left whole: one thing in brackets, and names that carry punctuation.
    ("Python (3 years)", ["Python (3 years)"]),
    ("Lean Six Sigma (Green Belt)", ["Lean Six Sigma"]),
    ("C++", ["C++"]), ("CI/CD", ["CI/CD"]), ("Objective-C", ["Objective-C"]), ("Node.js", ["Node.js"]),
])
@pytest.mark.asyncio
async def test_a_skills_line_comes_through_as_its_separate_skills(line, skills):
    payload = {"contact": {"name": "S", "email": "s@x.com"}, "experience": [], "education": [], "skills": [line]}
    result = await parse_resume_text("<resume text>", _provider_returning(payload))
    assert result["skills"] == skills


@pytest.mark.asyncio
async def test_a_skill_listed_twice_is_kept_once():
    payload = {"contact": {"name": "S", "email": "s@x.com"}, "experience": [], "education": [],
               "skills": ["Figma", "Prototyping", "Tools: figma, Sketch"]}
    result = await parse_resume_text("<resume text>", _provider_returning(payload))
    assert result["skills"] == ["Figma", "Prototyping", "Sketch"]


@pytest.mark.asyncio
async def test_entries_carry_text_points_and_standard_dates():
    payload = {
        "contact": {"name": "S", "email": "s@x.com"},
        "experience": [
            # No title printed (the résumé only named the company).
            {"company": "WIPRO", "title": None, "start": "July 2019", "end": "till date",
             "bullets": ["➢ Monitored SOC events.", "- Wrote reports", " ", None],
             "projects": [{"name": "SOC", "start": "07/2020", "end": "2021-03", "bullets": ["1. Tuned rules."]}]},
            "not an entry",
        ],
        "projects": [{"name": None, "start": "Sept. 2021", "end": "Summer 2022", "bullets": ["• Built it"]}],
        "education": [{"institution": "JNTU", "degree": None, "year": 2016}],
        "skills": [],
        "achievements": ["• Won a hackathon", "2.5x faster builds"],
    }
    result = await parse_resume_text("<resume text>", _provider_returning(payload))
    [job] = result["experience"]
    assert (job["title"], job["start"], job["end"]) == ("", "Jul 2019", "Present")
    assert job["bullets"] == ["Monitored SOC events.", "Wrote reports"]
    assert job["projects"][0]["bullets"] == ["Tuned rules."]
    assert (job["projects"][0]["start"], job["projects"][0]["end"]) == ("Jul 2020", "Mar 2021")
    [project] = result["projects"]
    # A date this can't read stays as written, for the picker to ask about.
    assert (project["name"], project["start"], project["end"]) == ("", "Sep 2021", "Summer 2022")
    assert project["bullets"] == ["Built it"]
    assert result["education"][0]["degree"] == "" and result["education"][0]["year"] == ""
    assert result["achievements"] == ["Won a hackathon", "2.5x faster builds"]


@pytest.mark.asyncio
async def test_points_printed_under_no_job_come_through_with_a_heading():
    payload = {
        "contact": {"name": "S", "email": "s@x.com"}, "experience": [], "education": [], "skills": [],
        "unplaced": [
            {"heading": "KEY RESPONSIBILITIES.", "points": ["➢ Real time monitoring of alerts.", " "]},
            {"heading": "Duties", "points": ["Escalated incidents."]},
            {"heading": "WORK PROFILE", "points": ["Ran the night shift."]},
            {"heading": None, "points": ["A point with no heading."]},
            {"heading": "Empty", "points": []},
            "not a section",
        ],
    }
    result = await parse_resume_text("<resume text>", _provider_returning(payload))
    # One heading, one group: every kind of duties section reads as
    # "Roles and Responsibilities"; a heading with no home keeps its own.
    assert result["unplaced"] == [
        {"heading": "Roles and Responsibilities",
         "points": ["Real time monitoring of alerts.", "Escalated incidents.", "A point with no heading."]},
        {"heading": "Work Profile", "points": ["Ran the night shift."]},
    ]


@pytest.mark.asyncio
async def test_a_loose_section_the_model_sends_to_unplaced_goes_to_its_own_field():
    payload = {
        "contact": {"name": "S", "email": "s@x.com"}, "experience": [], "education": [], "skills": ["Go"],
        "unplaced": [
            {"heading": "PUBLICATIONS & PATENTS", "points": ["US Patent 11,223,445 - Adaptive load shedding"]},
            {"heading": "Core Competencies", "points": ["Cloud Strategy", "P&L Ownership"]},
            {"heading": "Personal Details", "points": ["Religion: Hindu"]},
        ],
    }
    result = await parse_resume_text("<resume text>", _provider_returning(payload))
    assert result["achievements"] == ["US Patent 11,223,445 - Adaptive load shedding"]
    assert result["skills"] == ["Go", "Cloud Strategy", "P&L Ownership"]
    # Personal details stay off, as they always have.
    assert result["unplaced"] == [] and "Hindu" not in json.dumps(result)


_PRINTED = """Sailesh Kumar
SUMMARY
➢ Security analyst with 8 years in SOC operations.
TECHNICAL SKILLS
➢ SIEM Monitoring & Log Analysis (Microsoft Sentinel, ArcSight)
➢ Network Security Monitoring (Firewall, IDS/IPS)
IT EXPERIENCE
Company Name: Accenture
➢ Working as a Security Engineer in a 24x7 SOC.
KEY RESPONSIBILITIES.
➢ Real time Monitoring of Alerts using SIEM Tool like Azure
sentinel and ArcSight ESM.
➢ Reviewing URL’s, Domain’s, IP’s and blocking them.
ACHIEVEMENTS
• Won the SOC analyst of the year award – 2023.
PERSONAL DETAILS
• Religion : Hindu

Hyperlinks found in this document (the real destination behind clickable text):
- https://linkedin.com/in/x
"""


@pytest.mark.asyncio
async def test_points_the_model_dropped_are_found_in_the_text_and_filed():
    # What the model gave back for a résumé like testResume on a bad run: the
    # skills without their bracketed tools, and the duties section gone.
    payload = {
        "contact": {"name": "Sailesh Kumar", "email": "s@x.com"},
        "summary": "Security analyst with 8 years in SOC operations.",
        "experience": [{"company": "Accenture", "title": "Security Engineer", "start": "2024",
                        "bullets": ["Working as a Security Engineer in a 24x7 SOC."]}],
        "education": [],
        "skills": ["SIEM Monitoring & Log Analysis", "Network Security Monitoring"],
        "achievements": [],
    }
    result = await parse_resume_text(_PRINTED, _provider_returning(payload))
    assert result["skills"] == ["SIEM Monitoring & Log Analysis", "Network Security Monitoring",
                                "Microsoft Sentinel", "ArcSight", "Firewall", "IDS/IPS"]
    assert result["unplaced"] == [{"heading": "Roles and Responsibilities", "points": [
        "Real time Monitoring of Alerts using SIEM Tool like Azure sentinel and ArcSight ESM.",
        "Reviewing URL's, Domain's, IP's and blocking them.",
    ]}]
    assert result["achievements"] == ["Won the SOC analyst of the year award - 2023."]
    # Read already, or left off on purpose: never filed twice, never added.
    assert result["experience"][0]["bullets"] == ["Working as a Security Engineer in a 24x7 SOC."]
    assert "Hindu" not in json.dumps(result) and "linkedin" not in json.dumps(result["unplaced"])


@pytest.mark.asyncio
async def test_points_the_model_read_are_not_filed_again():
    payload = {
        "contact": {"name": "Sailesh Kumar", "email": "s@x.com"},
        "summary": "Security analyst with 8 years in SOC operations.",
        "experience": [{"company": "Accenture", "title": "Security Engineer", "start": "2024",
                        "bullets": ["Working as a Security Engineer in a 24x7 SOC."]}],
        "education": [],
        "skills": ["SIEM Monitoring & Log Analysis (Microsoft Sentinel, ArcSight)",
                   "Network Security Monitoring (Firewall, IDS/IPS)"],
        "achievements": ["Won the SOC analyst of the year award - 2023."],
        "unplaced": [{"heading": "KEY RESPONSIBILITIES.", "points": [
            "Real time Monitoring of Alerts using SIEM Tool like Azure sentinel and ArcSight ESM.",
            "Reviewing URL's, Domain's, IP's and blocking them."]}],
    }
    result = await parse_resume_text(_PRINTED, _provider_returning(payload))
    assert len(result["unplaced"]) == 1 and len(result["unplaced"][0]["points"]) == 2
    assert result["achievements"] == ["Won the SOC analyst of the year award - 2023."]
    assert len(result["skills"]) == 6


@pytest.mark.asyncio
async def test_no_unplaced_section_reads_as_none():
    payload = {"contact": {"name": "S", "email": "s@x.com"}, "experience": [], "education": [], "skills": []}
    assert (await parse_resume_text("<resume text>", _provider_returning(payload)))["unplaced"] == []


def test_the_prompt_keeps_loose_points_out_of_every_job():
    assert re.search(r'"unplaced".{0,700}Never copy them into a job,\s+and never guess which job', PARSE_SYSTEM, re.S)
    assert "the app splits" in PARSE_SYSTEM and "AWS (EC2, S3, Lambda)" in PARSE_SYSTEM
    assert re.search(r'"Publications".{0,120}goes in\s+"achievements"', PARSE_SYSTEM, re.S)
    assert re.search(r"EARLIER CAREER LINES.{0,500}Never\s+invent a title", PARSE_SYSTEM, re.S)


# ── Text printed under a job is that job's, even when it reads like a summary ──
# A job's description opening in the first person ("I am an experienced
# Accountant…") was read as the résumé's Professional Summary, leaving the
# job (the current one) with no points at all. Seen on a real Accountant
# résumé, three reads out of three.

_JOB_PARAGRAPH_RESUME = """ACCOUNTANT
Skills
QuickBooks, Excel
Experience
07/2014
to
Current
ACCOUNTANT
Company Name
City , State
I am an experienced and goal-oriented Accountant with a demonstrated track record in preparation and analysis of financial reports to
summarize and forecast financial position.
Independent contributor committed to superior quality, teamwork and proficient internal and external customer service.
04/2010
to
07/2014
Accounting Manager
Company Name
City , State
Responsible for coordination of annual audit and government auditing.
Implemented an inventory system.
Education
Bachelor of Science : Accounting
"""

_SUMMARY_FROM_THE_JOB = (
    "I am an experienced and goal-oriented Accountant with a demonstrated track record in preparation "
    "and analysis of financial reports to summarize and forecast financial position. Independent "
    "contributor committed to superior quality, teamwork and proficient internal and external customer service."
)


def _job_paragraph_read(summary=_SUMMARY_FROM_THE_JOB, first_bullets=None):
    return {
        "contact": {"name": "", "email": ""},
        "headline": "ACCOUNTANT",
        "summary": summary,
        "experience": [
            {"company": "Company Name", "title": "ACCOUNTANT", "start": "07/2014", "end": "Current",
             "bullets": first_bullets or []},
            {"company": "Company Name", "title": "Accounting Manager", "start": "04/2010", "end": "07/2014",
             "bullets": ["Responsible for coordination of annual audit and government auditing.",
                         "Implemented an inventory system."]},
        ],
        "education": [{"institution": "", "degree": "Bachelor of Science : Accounting"}],
        "skills": ["QuickBooks", "Excel"],
    }


@pytest.mark.asyncio
async def test_a_summary_read_from_inside_a_job_goes_back_to_that_job():
    out = await parse_resume_text(_JOB_PARAGRAPH_RESUME, _provider_returning(_job_paragraph_read()))
    assert out["summary"] is None
    assert out["experience"][0]["bullets"] == [
        "I am an experienced and goal-oriented Accountant with a demonstrated track record in preparation "
        "and analysis of financial reports to summarize and forecast financial position.",
        "Independent contributor committed to superior quality, teamwork and proficient internal and "
        "external customer service.",
    ]
    # The other job is left exactly as read.
    assert out["experience"][1]["bullets"] == [
        "Responsible for coordination of annual audit and government auditing.",
        "Implemented an inventory system.",
    ]


@pytest.mark.asyncio
async def test_it_joins_the_points_the_job_already_has_without_repeating_them():
    read = _job_paragraph_read(first_bullets=["Independent contributor committed to superior quality, "
                                               "teamwork and proficient internal and external customer service."])
    out = await parse_resume_text(_JOB_PARAGRAPH_RESUME, _provider_returning(read))
    assert out["summary"] is None
    bullets = out["experience"][0]["bullets"]
    assert len(bullets) == 2 and bullets[0].startswith("I am an experienced")


@pytest.mark.asyncio
async def test_a_summary_at_the_top_stays_the_summary():
    text = ("Jane Doe\nExperienced accountant with ten years in property and development accounting.\n"
            + _JOB_PARAGRAPH_RESUME.split("Experience\n", 1)[1].join(["Experience\n", ""]))
    summary = "Experienced accountant with ten years in property and development accounting."
    read = _job_paragraph_read(summary=summary,
                               first_bullets=["I am an experienced and goal-oriented Accountant."])
    out = await parse_resume_text(text, _provider_returning(read))
    assert out["summary"] == summary
    assert out["experience"][0]["bullets"] == ["I am an experienced and goal-oriented Accountant."]


@pytest.mark.asyncio
async def test_a_summary_section_printed_after_the_jobs_stays_the_summary():
    summary = "Accountant with a record of clean audits and on-time monthly closes for property firms."
    text = _JOB_PARAGRAPH_RESUME.replace("Education\n", f"Professional Summary\n{summary}\nEducation\n")
    out = await parse_resume_text(text, _provider_returning(_job_paragraph_read(summary=summary)))
    assert out["summary"] == summary


@pytest.mark.asyncio
async def test_a_summary_printed_at_the_top_and_again_under_a_job_stays_the_summary():
    text = _JOB_PARAGRAPH_RESUME.replace("Skills\n", _SUMMARY_FROM_THE_JOB + "\nSkills\n", 1)
    out = await parse_resume_text(text, _provider_returning(_job_paragraph_read()))
    assert out["summary"] == _SUMMARY_FROM_THE_JOB


@pytest.mark.asyncio
async def test_an_objective_read_from_inside_a_job_goes_back_to_that_job_too():
    read = _job_paragraph_read(summary=None)
    read["objective"] = _SUMMARY_FROM_THE_JOB
    out = await parse_resume_text(_JOB_PARAGRAPH_RESUME, _provider_returning(read))
    assert out["objective"] is None
    assert out["experience"][0]["bullets"][0].startswith("I am an experienced")


def test_finding_the_job_does_work_in_step_with_the_text_not_lines_times_jobs(monkeypatch):
    """It runs on the event loop. Matching every line against every job's
    title, tidied afresh each time, took 30 s on a crafted upload (11,000
    short lines, 400 jobs), stalling the API for everyone. Counted, not
    timed: each line and each title is tidied once."""
    from app.services import resume_parser as rp

    calls = 0
    real = rp._norm_line

    def counting(line):
        nonlocal calls
        calls += 1
        return real(line)

    monkeypatch.setattr(rp, "_norm_line", counting)
    lines = ["Experience", *["x y"] * 2000, "Job Title", _SUMMARY_FROM_THE_JOB]
    jobs = [{"title": f"Title number {i}", "bullets": []} for i in range(200)] + [{"title": "Job Title", "bullets": []}]
    data = {"summary": _SUMMARY_FROM_THE_JOB, "experience": jobs}
    rp._return_job_text("\n".join(lines), data, "summary")
    assert data["summary"] is None and jobs[-1]["bullets"]
    assert calls <= len(lines) + len(jobs)


# ── A long résumé's sections the model dropped, with title-case headings and
# no bullets (the Kaggle set; an Accountant's 5-page résumé lost its
# Highlights, Accomplishments and Education notes on every read) ──

_TITLE_CASE = """ACCOUNTANT
Summary
Financial Accountant specializing in financial planning within the Department of Defense.
Highlights
Account reconciliations
Critical thinking
ERP (Enterprise Resource Planning) software.
Accomplishments
Served on a tiger team which identified and resolved General Ledger postings in DEAMS totaling $360B in accounting adjustments. This allowed
for the first successful fiscal year-end close for 2012.
Experience
Company Name July 2011 to November 2012 Accountant
City , State
I served on a tiger team designed to resolve General Ledger posting differences, supporting $360B in accounting adjustments.
I identified duplicate obligations with an automated tool built with DFAS Europe.
Education
Northern Maine Community College 1994 Associate : Accounting
Attended Husson College, major Accounting 78 semester hours toward Bachelors degree.
Skills
Accounting; General Accounting; Program Management.
"""


def _accountant(**overrides) -> dict:
    payload = {
        "contact": {"name": "", "email": ""},
        "summary": "Financial Accountant specializing in financial planning within the Department of Defense.",
        "experience": [{"company": "Company Name", "title": "Accountant", "start": "Jul 2011", "end": "Nov 2012",
                        "bullets": ["I served on a tiger team designed to resolve General Ledger posting differences, "
                                    "supporting $360B in accounting adjustments.",
                                    "I identified duplicate obligations with an automated tool built with DFAS Europe."]}],
        "education": [{"institution": "Northern Maine Community College", "degree": "Associate: Accounting", "year": "1994"}],
        "skills": ["Accounting", "General Accounting", "Program Management"],
        "achievements": [],
    }
    payload.update(overrides)
    return payload


@pytest.mark.asyncio
async def test_unbulleted_lines_under_title_case_headings_the_model_dropped_come_back():
    result = await parse_resume_text(_TITLE_CASE, _provider_returning(_accountant()))
    # Short highlights are skills; the bracketed one by its name.
    assert result["skills"] == ["Accounting", "General Accounting", "Program Management",
                                "Account reconciliations", "Critical thinking", "ERP"]
    # A wrapped line joined back up — though a job's bullet says much the same.
    assert result["achievements"] == [
        "Served on a tiger team which identified and resolved General Ledger postings in DEAMS totaling $360B "
        "in accounting adjustments. This allowed for the first successful fiscal year-end close for 2012."
    ]
    # An Education note the model made no degree of: Miscellaneous, to place.
    assert result["unplaced"] == [{"heading": "Education", "points": [
        "Attended Husson College, major Accounting 78 semester hours toward Bachelors degree."]}]
    # The jobs are the model's to read: nothing filed from them.
    assert len(result["experience"]) == 1 and len(result["experience"][0]["bullets"]) == 2


@pytest.mark.asyncio
async def test_unbulleted_lines_the_model_read_are_not_filed_again():
    read = _accountant(
        skills=["Accounting", "General Accounting", "Program Management", "Account reconciliations",
                "Critical thinking", "ERP"],
        achievements=["Served on a tiger team which identified and resolved General Ledger postings in DEAMS "
                      "totaling $360B in accounting adjustments. This allowed for the first successful fiscal "
                      "year-end close for 2012."],
        education=[{"institution": "Northern Maine Community College", "degree": "Associate: Accounting", "year": "1994"},
                   {"institution": "Husson College", "degree": "Accounting, 78 semester hours toward a Bachelors degree", "year": ""}],
    )
    result = await parse_resume_text(_TITLE_CASE, _provider_returning(read))
    assert result["skills"] == read["skills"]
    assert len(result["achievements"]) == 1
    assert result["unplaced"] == []


def test_a_skill_list_s_closing_full_stop_is_not_a_second_skill():
    from app.services.resume_parser import _clean_skills
    assert _clean_skills(["Program Management", "Accounting; Program Management."]) == ["Program Management", "Accounting"]
    assert _clean_skills([".NET", "Node.js."]) == [".NET", "Node.js"]


# ── A long résumé is read in parts: the rest, then its jobs a few at a time ──

def _long_resume(jobs: int = 6, lines_per_job: int = 18) -> str:
    out = ["Jane Doe", "jane@example.com", "Summary", "Accountant with twenty years in public finance.", "Experience"]
    for j in range(jobs):
        out += [f"Company {j} January {2000 + j} to December {2000 + j} Title {j}", "City , State"]
        out += [f"Job {j} point {k}: reconciled ledgers and reported variances for the finance office." for k in range(lines_per_job)]
    out += ["Education", "State College 1999 Associate : Accounting", "Skills", "Accounting; Payroll."]
    return "\n".join(out)


def test_a_short_resume_is_read_whole():
    from app.services.resume_parser import _parts_to_read
    text = _long_resume(jobs=2, lines_per_job=3)
    assert _parts_to_read(text) == [text]


def test_a_long_resume_is_read_as_its_rest_then_its_jobs_cut_at_their_headers():
    from app.services.resume_parser import JOBS_PART_CHARS, READ_WHOLE_UP_TO, _parts_to_read
    text = _long_resume()
    assert len(text) > READ_WHOLE_UP_TO
    parts = _parts_to_read(text)
    rest, jobs = parts[0], parts[1:]
    assert "Jane Doe" in rest and "Education" in rest and "Accounting; Payroll." in rest and "Company 0" not in rest
    assert len(jobs) >= 2
    seen = []
    for part in jobs:
        assert part.startswith("Experience\nCompany ")
        assert len(part) <= JOBS_PART_CHARS + len("Experience\n")
        seen += re.findall(r"^Company (\d)", part, re.M)
    # Every job once, in order, never cut in two.
    assert seen == [str(j) for j in range(6)]
    for j in range(6):
        assert sum(f"Job {j} point" in p for p in jobs) == 1


def test_a_long_resume_without_an_experience_heading_is_read_whole():
    from app.services.resume_parser import _parts_to_read
    text = _long_resume().replace("\nExperience\n", "\nWhere I worked\n")
    assert _parts_to_read(text) == [text]


def test_a_job_header_takes_the_title_line_printed_above_its_dates():
    from app.services.resume_parser import _job_starts
    lines = ["Senior Engineer", "Acme Corp | Jan 2020 - Present", "Built the payments API.",
             "Engineer", "Beta Ltd | Jun 2017 – Dec 2019", "Shipped the billing service in 2018 - 2019 with a team of four."]
    assert _job_starts(lines) == [0, 3]


@pytest.mark.asyncio
async def test_the_parts_reads_are_put_back_together_in_page_order():
    text = _long_resume()

    def read(_system, part, **_kw):
        if not part.startswith("Experience\n"):
            return json.dumps({"contact": {"name": "Jane Doe", "email": "jane@example.com"},
                               "summary": "Accountant with twenty years in public finance.",
                               "experience": [], "education": [{"institution": "State College", "degree": "Associate", "year": "null"}],
                               "skills": ["Accounting", "Payroll"]})
        jobs = [{"company": f"Company {j}", "title": f"Title {j}", "start": f"Jan {2000 + j}", "end": f"Dec {2000 + j}",
                 "bullets": re.findall(rf"^(Job {j} point .*)$", part, re.M)}
                for j in map(int, re.findall(r"^Company (\d)", part, re.M))]
        # A jobs' part has no contact: a name there is made up.
        return json.dumps({"contact": {"name": "Full Name"}, "experience": jobs, "education": [], "skills": ["Ledgers"]})

    provider = MagicMock()
    provider.complete = AsyncMock(side_effect=read)
    result = await parse_resume_text(text, provider)
    assert provider.complete.await_count == len(__import__("app.services.resume_parser", fromlist=["_parts_to_read"])._parts_to_read(text))
    assert result["contact"]["name"] == "Jane Doe"
    assert result["summary"] == "Accountant with twenty years in public finance."
    assert [j["company"] for j in result["experience"]] == [f"Company {j}" for j in range(6)]
    assert all(len(j["bullets"]) == 18 for j in result["experience"])
    assert result["skills"] == ["Accounting", "Payroll", "Ledgers"]
    # The model's "null" isn't printed as a year.
    assert result["education"][0]["year"] == ""


@pytest.mark.asyncio
async def test_a_part_that_comes_back_unreadable_is_read_once_more():
    good = json.dumps({"contact": {"name": "S", "email": "s@x.com"}, "experience": [], "education": [], "skills": []})
    provider = MagicMock()
    provider.complete = AsyncMock(side_effect=['{"contact": {"name": "S"', good])
    result = await parse_resume_text("<resume text>", provider)
    assert result["contact"]["name"] == "S" and provider.complete.await_count == 2


@pytest.mark.asyncio
async def test_a_jobs_part_read_with_a_job_missing_is_read_once_more():
    text = _long_resume()
    calls: dict[str, int] = {}

    def read(_system, part, **_kw):
        if not part.startswith("Experience\n"):
            return json.dumps({"contact": {"name": "Jane Doe", "email": "j@x.com"}, "experience": [], "education": [], "skills": []})
        calls[part] = calls.get(part, 0) + 1
        found = list(map(int, re.findall(r"^Company (\d)", part, re.M)))
        # The first read of each part leaves its last job out.
        if calls[part] == 1:
            found = found[:-1]
        return json.dumps({"contact": {}, "experience": [{"company": f"Company {j}", "title": f"Title {j}", "start": "2000",
                                                          "bullets": ["Did the work."]} for j in found],
                           "education": [], "skills": []})

    provider = MagicMock()
    provider.complete = AsyncMock(side_effect=read)
    result = await parse_resume_text(text, provider)
    assert [j["company"] for j in result["experience"]] == [f"Company {j}" for j in range(6)]
    assert set(calls.values()) == {2}


def test_a_stray_glyph_line_is_not_a_heading():
    from app.services.resume_parser import _is_heading
    assert not _is_heading("� ") and not _is_heading("Ä")
    assert _is_heading("EXPERIENCE") and _is_heading("Roles & Responsibilities:")


def test_a_job_is_never_cut_from_the_tail_of_the_bullet_above_it():
    from app.services.resume_parser import _job_starts
    lines = ["Director of Marketing 01/2014 to Current", "Company Name City , State",
             "Grew sponsorship revenue and built brand",
             "awareness of Virbac initiatives",
             "Manage outside advertising and marketing agencies 01/2010 to 01/2014",
             "Senior Account Executive 01/2001 to 01/2003", "Company Name City , State", "Ran the press office."]
    # Line 4 follows a wrapped bullet, not the end of a job: no cut there.
    assert _job_starts(lines) == [0, 5]


@pytest.mark.asyncio
@pytest.mark.parametrize("name", ["Full Name", "ACCOUNTANT"])
async def test_a_name_the_resume_does_not_print_or_its_job_title_is_left_blank(name):
    text = "ACCOUNTANT\nSummary\nAccountant in public finance.\nExperience\nCompany Name 2011 to 2012 Accountant\nReconciled ledgers."
    payload = {"contact": {"name": name}, "headline": "Accountant",
               "experience": [{"company": "Company Name", "title": "Accountant", "start": "2011", "bullets": ["Reconciled ledgers."]}],
               "education": [], "skills": []}
    assert (await parse_resume_text(text, _provider_returning(payload)))["contact"]["name"] == ""


@pytest.mark.asyncio
@pytest.mark.parametrize("printed", ["JANE DOE\njane@x.com", "J A N E   D O E\njane@x.com", "Jane\nDoe\njane@x.com"])
async def test_a_printed_name_is_kept_however_it_is_spaced(printed):
    payload = {"contact": {"name": "Jane Doe", "email": "jane@x.com"}, "experience": [], "education": [], "skills": []}
    assert (await parse_resume_text(printed, _provider_returning(payload)))["contact"]["name"] == "Jane Doe"

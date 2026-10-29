"""Parse uploaded PDF resumes into structured ResumeContent dicts."""
import re
import json
from pydantic import BaseModel
from app.services.ai_engine.base import AIProvider
from app.services.tailoring import _looks_like_a_skill
# PDF text extraction lives apart so the sandbox can load it without the app
# (see app/services/pdf_text.py); re-exported here for callers and tests.
from app.services.pdf_text import (  # noqa: F401
    MAX_PDF_PAGES as _MAX_PDF_PAGES,
    MAX_TEXT_CHARS as _MAX_TEXT_CHARS,
    PdfRejected,
    _Link,
    _append_link_hints,
    _extract_links,
    extract_text_from_pdf,
)

# A host with a dot (github.com/x, odtect.app), or an explicit scheme.
_URL_SHAPE = re.compile(r"^[a-z][a-z0-9+.-]*://|[a-z0-9-]\.[a-z]{2,}", re.IGNORECASE)


class ParsedResume(BaseModel):
    contact: dict
    summary: str | None = None
    experience: list[dict]
    projects: list[dict] | None = None
    education: list[dict]
    skills: list[str]
    languages: list[dict] | None = None
    certifications: list[str] | None = None


def _strip_json_fence(raw: str) -> str:
    """Remove optional ```json ... ``` markdown fences from LLM output."""
    s = raw.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```$", "", s)
    return s.strip()


PARSE_SYSTEM = """You are an expert resume parser. Extract structured data from the resume text below.

Return a JSON object with EXACTLY this shape:
{
  "contact": {
    "name": "Full Name",
    "email": "email@example.com",
    "phone": "optional phone string",
    "location": "City, State/Country if present",
    "linkedin": "linkedin URL if present",
    "github": "github URL if present",
    "website": "personal site or portfolio URL if present"
  },
  "headline": "the one-line professional title printed at the top near the name, verbatim, else null",
  "summary": "professional summary paragraph if present, else null",
  "objective": "career objective paragraph if present, else null",
  "experience": [
    {
      "company": "Company Name",
      "title": "Job Title",
      "location": "City, State/Country or 'Remote' if present, else null",
      "start": "Mon YYYY or YYYY",
      "end": "Mon YYYY or 'Present'",
      "bullets": ["bullet 1", "bullet 2"],
      "projects": [
        {
          "client": "client as printed, else null",
          "name": "project name as printed, else null",
          "role": "the candidate's role on this project as printed, else null",
          "domain": "industry or domain as printed, else null",
          "start": "Mon YYYY or YYYY, if printed",
          "end": "Mon YYYY, YYYY or 'Present', if printed",
          "tech_stack": "technologies printed for this project, else null",
          "bullets": ["this project's own bullet"]
        }
      ]
    }
  ],
  "projects": [
    {
      "name": "Project Name",
      "tech_stack": "e.g. React, Node.js, PostgreSQL — if present",
      "link": "source/repo URL (e.g. GitHub) if present",
      "link_label": "the clickable text the link was shown as (e.g. 'GitHub'), else null",
      "live_link": "deployed/demo URL (e.g. a link shown as 'Live' or 'Demo') if present",
      "live_link_label": "the clickable text the live link was shown as (e.g. 'Live'), else null",
      "start": "Mon YYYY or YYYY, if present",
      "end": "Mon YYYY, YYYY, or 'Present', if present",
      "bullets": ["bullet 1", "bullet 2"]
    }
  ],
  "education": [
    {
      "institution": "University Name",
      "degree": "Degree and major",
      "year": "YYYY or YYYY-YYYY",
      "gpa": "grade exactly as printed, or null",
      "honors": "honors or distinction printed on this entry, or null"
    }
  ],
  "skills": ["Skill1", "Skill2"],
  "languages": [{"name": "language exactly as printed", "level": "level as printed, or null"}],
  "certifications": ["Cert name if any"],
  "awards": ["award as printed"],
  "achievements": ["achievement as printed"],
  "leadership": ["leadership role or activity as printed"],
  "volunteer": ["volunteer role or activity as printed"],
  "interests": ["interest or hobby as printed"]
}

Rules:
- Return only the JSON object, no markdown fences.
- Keep all original bullet text verbatim — do not rewrite.
- "headline" is the short title line at the top of the resume, beside or
  just under the name — a role and/or specialty, often with separators
  ("|", "·", "•", "–"). Copy it exactly as printed. It is not a contact
  detail and not a sentence from the summary. Never build one from the
  latest job title in Experience: a resume with no title line at the top
  gives "headline": null.
- "summary" vs "objective": a paragraph under an "Objective" / "Career
  Objective" heading goes in "objective"; one under "Summary", "Profile",
  "About Me" or "Professional Summary" goes in "summary". A paragraph with
  no heading at the top of the resume is the summary. Never put the same
  text in both.
- "awards", "achievements", "leadership", "volunteer", "interests": take
  these only from a section with that heading or a close equivalent
  ("Honors & Awards", "Key Achievements", "Positions of Responsibility",
  "Extracurriculars", "Volunteering", "Hobbies", "Hobbies & Interests").
  One entry per item, copied verbatim. Never move an Experience bullet into
  them, and never leave a section like this out —
  if it is on the resume, it belongs in one of these lists.
- LINKS: the resume text may end with a "Hyperlinks found in this document"
  block — these are the real destination URLs behind clickable text that
  otherwise only shows as a bare word like "GitHub", "LinkedIn", or
  "Portfolio" (PDF hyperlink text never contains the actual URL). Match each
  one to the right field by its domain — a github.com URL is contact.github
  or a project's "link", a linkedin.com/in/... URL is contact.linkedin, a
  personal domain is contact.website — instead of guessing a URL from the
  anchor text or leaving the field null when a real link exists. If a field
  already has a plain-text URL printed directly in the resume body, prefer
  that exact text over the hyperlink block.
- PROJECT LINKS: a project can have two links. The source/repo (usually
  github.com, gitlab.com, bitbucket.org) goes in "link"; the running app
  (a deployed site, anything shown as "Live", "Demo", "Website", "App")
  goes in "live_link". A project with a single link that isn't a repo puts
  it in "link". Never drop a project's second link. Only a real URL goes in
  a link field; the word it was shown as (e.g. "GitHub", "Live") goes in
  its "_label" field, never in the URL field.
- If a field is not found, use null for strings and [] for arrays.
- languages: take these ONLY from an explicit Languages section. Never infer a
  language from the language the resume is written in, from a nationality, a
  location, or a name, and never assume English. A resume with no Languages
  section gives "languages": []. If a language is listed with no proficiency
  beside it, set "level": null rather than choosing one — claiming "Native"
  or "Fluent" on someone's behalf is a fabricated credential, and it is their
  claim to make, not ours.
- education "gpa": CGPA, GPA, "Grade", "Aggregate", and a percentage are the
  SAME field — capture whichever the resume shows, copied verbatim with its
  scale or "%" sign (e.g. "8.6", "8.6/10", "3.9/4.0", "85%"). Never convert
  between scales, and never invent a value.
- education "honors": a distinction printed on that education entry itself
  — "First Class with Distinction", "Summa Cum Laude", "Dean's List",
  "Gold Medalist". Copy it as printed; several on one entry are joined with
  ", ". The number goes in "gpa" and the words in "honors" ("First Class
  with Distinction (78%)" gives gpa "78%"). It is not coursework, a thesis,
  or part of the degree's name ("B.Sc. (Hons)" stays in "degree"). An item
  under a separate "Honors & Awards" or "Awards" section stays in "awards"
  and is never copied into an education entry. An entry with none gives
  "honors": null.
- skills must be a flat list of individual skill strings, each a short tool/
  technology/methodology name — 1 to 4 words, no verbs, no punctuation, never
  a sentence. "Python", "Stakeholder Management", "CI/CD" are valid entries.
  Only pull these from an actual "Skills" section (or equivalent list of
  tools/technologies) — never from prose like a summary, an experience
  bullet, or a "Key Achievements" paragraph, even if it names a tool in
  passing. If a bullet or paragraph is not itself a skills list, do not
  extract anything from it into "skills".
- "projects" is for personal/academic/hackathon projects listed under a
  "Projects" (or similar) heading — do NOT duplicate work performed under
  an employer, which belongs in that job's "experience" entry instead (its
  "bullets", or its own "projects" below).
- PROJECTS INSIDE A JOB: when a job lists projects or client engagements
  under it — often a line like "Project: Payments Hub | Client: Barclays |
  Role: Module Lead | Domain: Banking", or a project or client sub-heading
  with its own dates and bullets, as services companies' résumés do — put
  each one in that job's "projects", with only its own bullets. Bullets
  printed under the job itself, outside any project, stay in the job's
  "bullets". Copy every value as printed and leave a field null when the
  resume does not state it: never guess a domain from a client's name, a
  role from the job title, or dates from the job's dates. A job with no
  such sub-blocks gives "projects": [].
- MULTIPLE ROLES AT ONE COMPANY: if the resume lists more than one job
  title under the same employer (a promotion, an internal transfer — often
  shown as one company heading with two or more role/date sub-blocks
  underneath it), extract EACH role as its own separate entry in
  "experience" — same "company" value repeated, but each with its own
  "title", "start", "end", and only that role's own bullets. Never merge
  multiple roles into a single entry (that silently drops the earlier
  role's title, dates, and bullets), and never let one role's bullets leak
  into another role's entry.

  Example — this resume text:
      Northwind Traders — Chicago, IL
      Senior Data Analyst | Mar 2022 – Present
        - Owns the revenue forecasting models used by finance.
      Data Analyst | Jul 2019 – Feb 2022
        - Built the first self-serve reporting dashboards.
  MUST parse to TWO experience entries:
      {"company": "Northwind Traders", "title": "Senior Data Analyst",
       "location": "Chicago, IL", "start": "Mar 2022", "end": "Present",
       "bullets": ["Owns the revenue forecasting models used by finance."]},
      {"company": "Northwind Traders", "title": "Data Analyst",
       "location": "Chicago, IL", "start": "Jul 2019", "end": "Feb 2022",
       "bullets": ["Built the first self-serve reporting dashboards."]}

- "location" is where the role was based, copied as written ("Chicago, IL",
  "London, UK", "Remote"). A location stated once against the employer
  applies to every role under it, as above. Omit the key entirely when the
  resume does not say — never guess one from the candidate's own address,
  and never invent "Remote".
"""


_JOB_PROJECT_FIELDS = ("client", "name", "role", "domain", "start", "end", "tech_stack")


def _clean_job_projects(value) -> list[dict]:
    """A job's projects as the résumé model holds them: text fields trimmed
    and left out when empty, bullets a list of non-empty strings, and a
    project with nothing in it dropped. Anything that isn't a list of
    objects reads as no projects."""
    out = []
    for p in value if isinstance(value, list) else []:
        if not isinstance(p, dict):
            continue
        project = {k: p[k].strip() for k in _JOB_PROJECT_FIELDS if isinstance(p.get(k), str) and p[k].strip()}
        bullets = p.get("bullets")
        project["bullets"] = [b.strip() for b in bullets if isinstance(b, str) and b.strip()] if isinstance(bullets, list) else []
        if len(project) > 1 or project["bullets"]:
            out.append(project)
    return out


class ResumeUnreadable(ValueError):
    """The model's answer wasn't a résumé we could read (cut off, or not JSON)."""


# Optional one-line text fields and plain lists of lines the prompt asks for.
_TEXT_FIELDS = ("headline", "summary", "objective")
_LINE_LISTS = ("certifications", "awards", "achievements", "leadership", "volunteer", "interests")


async def parse_resume_text(raw_text: str, provider: AIProvider) -> dict:
    raw = await provider.complete(PARSE_SYSTEM, raw_text, model_tier="fast", call_name="parse_resume")
    cleaned = _strip_json_fence(raw)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        data = None
    # An empty résumé used to stand in here, created and charged for as if
    # the read had worked — the person just saw every field blank. Failing
    # lets the caller refund and say so.
    if not isinstance(data, dict):
        raise ResumeUnreadable("model output was not a JSON object")
    # Ensure required keys exist
    if not isinstance(data.get("contact"), dict):
        data["contact"] = {"name": "", "email": ""}
    data.setdefault("experience", [])
    for job in data["experience"] if isinstance(data["experience"], list) else []:
        if isinstance(job, dict):
            job["projects"] = _clean_job_projects(job.get("projects"))
    data.setdefault("projects", [])
    data.setdefault("education", [])
    for edu in data["education"] if isinstance(data["education"], list) else []:
        if isinstance(edu, dict):
            _clean_honors(edu)
    data.setdefault("skills", [])
    for key in _TEXT_FIELDS:
        value = data.get(key)
        data[key] = value.strip() if isinstance(value, str) and value.strip() else None
    for key in _LINE_LISTS:
        value = data.get(key)
        data[key] = [s.strip() for s in value if isinstance(s, str) and s.strip()] if isinstance(value, list) else []
    # The prompt says never both; a model that copies the paragraph into
    # each would print it twice.
    if data["objective"] and data["objective"] == data["summary"]:
        data["objective"] = None
    # Defense-in-depth against the model pulling a responsibility/summary
    # sentence into "skills" despite the prompt rule against it — same
    # prose-vs-skill-name filter tailoring.py applies to AI-suggested skills.
    data["skills"] = [s for s in data["skills"] if isinstance(s, str) and _looks_like_a_skill(s)]
    for project in data["projects"] or []:
        if isinstance(project, dict):
            _keep_only_real_urls(project)
    return data


def _clean_honors(edu: dict) -> None:
    """Honors print after the GPA, so a blank or non-text value is dropped
    (no separator with nothing after it), and one that just repeats the GPA
    is dropped so the line doesn't say it twice."""
    honors = edu.get("honors")
    if isinstance(honors, str) and honors.strip() and honors.strip() != str(edu.get("gpa") or "").strip():
        edu["honors"] = honors.strip()
    else:
        edu.pop("honors", None)


def _keep_only_real_urls(project: dict) -> None:
    """The model sometimes files a link's anchor word ("GitHub", "Live") as
    its URL. That renders as a dead word on the résumé; the word belongs in
    the label, and the URL stays empty for the user to fill in."""
    for key in ("link", "live_link"):
        value = project.get(key)
        if isinstance(value, str) and value.strip() and not _URL_SHAPE.search(value):
            if not project.get(f"{key}_label"):
                project[f"{key}_label"] = value.strip()
            project[key] = None

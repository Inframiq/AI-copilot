"""Parse uploaded PDF resumes into structured ResumeContent dicts."""
import re
import json
from pydantic import BaseModel
from app.services.ai_engine.base import AIProvider
from app.services.phone import tidy_phone
from app.services.plain_text import _BULLETS, plain_deep, plain_text
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
  "interests": ["interest or hobby as printed"],
  "unplaced": [{"heading": "section heading as printed", "points": ["point as printed"]}]
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
  if it is on the resume, it belongs in one of these lists. A
  "Publications", "Patents" or "Publications & Patents" section goes in
  "achievements", one entry per item. Each item stays in the list of the
  section it was printed under: an item under "Achievements" is an
  achievement even when it reads like an award.
- "unplaced" is the last resort, ONLY for duties: a section of work points
  printed on its own, under no job — "Key Responsibilities", "Roles &
  Responsibilities", "Responsibilities", "Duties" or the like, printed
  before or after all the jobs, so the resume never says which job they
  belong to. Put the whole section here: its heading as printed, and its
  points verbatim. Never copy them into a job, and never guess which job
  they belong to. A "Roles & Responsibilities" block printed under a job or
  a project is that job's or project's own points, and goes there as usual.
  Every section that has a field above goes in that field, never here:
  "Core Competencies", "Areas of Expertise" and "Key Skills" lists are
  "skills"; "Career Highlights", "Key Achievements" and "Publications" are
  "achievements". A resume with no section of loose duties gives
  "unplaced": [].
- EARLIER CAREER LINES: a line that sums up older jobs instead of listing
  them gives one experience entry PER COMPANY it names, each with the title
  and dates the line prints and "bullets": []. Never invent a title, a date
  or a bullet the line does not print.
  Example — "Earlier Career: Software Engineer to Engineering Manager at
  Infosys and Yahoo (2006 - 2012)" MUST parse to TWO entries:
      {"company": "Infosys", "title": "Software Engineer to Engineering
       Manager", "start": "2006", "end": "2012", "bullets": []},
      {"company": "Yahoo", "title": "Software Engineer to Engineering
       Manager", "start": "2006", "end": "2012", "bullets": []}
- Dates belong to the role they are printed on: a role line "Vice President
  (2022 - Present)" under a company line "2019 - Present" starts in 2022.
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
- education "degree": the qualification as printed. A school level is a
  degree too: "10th", "10 Th", "12th", "SSC", "HSC", "Intermediate",
  "Class XII", "Higher Secondary" — with its stream if printed ("12th -
  M.P.C"). Never leave "degree" empty when the line names a level.
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
- A skills line that names tools in brackets, after a colon or after a
  dash is copied whole, with those tools: "AWS (EC2, S3, Lambda)", "SIEM
  Monitoring (Microsoft Sentinel, ArcSight)", "Threat Intelligence - Cisco
  Talos, Anomali". Never drop the tools to shorten it; the app splits the
  line into separate skills.
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
        project["bullets"] = _clean_points(p.get("bullets"))
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
    for key in ("summary", "objective"):
        if isinstance(data.get(key), str):
            data[key] = _as_paragraph(data[key].strip())
    # Keyboard text only — what the upload and the model put there alike.
    data = plain_deep(data)
    # Ensure required keys exist
    if not isinstance(data.get("contact"), dict):
        data["contact"] = {"name": "", "email": ""}
    if isinstance(data["contact"].get("phone"), str):
        data["contact"]["phone"] = tidy_phone(data["contact"]["phone"])
    for key, required in _REQUIRED_TEXT.items():
        data[key] = [_with_text(e, required) for e in data.get(key) or [] if isinstance(e, dict)] \
            if isinstance(data.get(key), list) else []
    for job in data["experience"]:
        job["projects"] = _clean_job_projects(job.get("projects"))
        job["bullets"] = _clean_points(job.get("bullets"))
        for item in [job, *job["projects"]]:
            _tidy_dates(item)
    for project in data["projects"]:
        project["bullets"] = _clean_points(project.get("bullets"))
        _tidy_dates(project)
        _keep_only_real_urls(project)
    for edu in data["education"]:
        _clean_honors(edu)
    for key in _TEXT_FIELDS:
        value = data.get(key)
        data[key] = value.strip() if isinstance(value, str) and value.strip() else None
    for key in _LINE_LISTS:
        data[key] = _clean_points(data.get(key))
    # The prompt says never both; a model that copies the paragraph into
    # each would print it twice.
    if data["objective"] and data["objective"] == data["summary"]:
        data["objective"] = None
    # Defense-in-depth against the model pulling a responsibility/summary
    # sentence into "skills" despite the prompt rule against it — same
    # prose-vs-skill-name filter tailoring.py applies to AI-suggested skills.
    data["skills"] = _clean_skills(data.get("skills"))
    # Never lose a printed point: what the model left out is found in the
    # text and filed by the heading it sat under, like its own loose ones.
    data["unplaced"] = _clean_unplaced(data.get("unplaced"))
    groups = data["unplaced"] + _points_left_out(raw_text, data)
    data["unplaced"] = []
    for group in groups:
        _file_by_heading(data, group["heading"], group["points"])
    return data


# Points printed under no job: "Key Responsibilities", "Roles &
# Responsibilities", "Duties"… all read as one heading in Miscellaneous.
_RESPONSIBILITY_HEADING = re.compile(r"responsibilit|dut(y|ies)|\broles?\b", re.I)
RESPONSIBILITIES_HEADING = "Roles and Responsibilities"


# Where a loose section belongs, by its heading. First match wins; a heading
# matching none is a section the résumé model has no place for, kept under
# its own heading in Miscellaneous. None: deliberately left off (personal
# details, a declaration, references, strengths, and sections the reader
# already reads as a whole — summary, languages).
_SKILL_HEADING = re.compile(r"skill|competenc|expertise|technolog|tools|proficienc", re.I)
_HEADING_HOMES: list[tuple[re.Pattern, str | None]] = [
    (_RESPONSIBILITY_HEADING, "unplaced"),
    (re.compile(r"personal|declaration|reference|strength|summary|objective|about me|languages?\b|"
                r"^((professional|executive|career) )?profile$", re.I), None),
    (_SKILL_HEADING, "skills"),
    (re.compile(r"achievement|highlight|accomplish|publication|patent", re.I), "achievements"),
    (re.compile(r"award|hono(u)?r", re.I), "awards"),
    (re.compile(r"certif|training|course|workshop", re.I), "certifications"),
    (re.compile(r"volunteer", re.I), "volunteer"),
    (re.compile(r"hobb|interest", re.I), "interests"),
    (re.compile(r"leadership|position|extra.?curricular|activit", re.I), "leadership"),
    # Read into entries, not lists: the model makes a job, a degree or a
    # project out of these lines, so their words are rearranged on purpose.
    (re.compile(r"experience|employment|work history|career|education|academic|qualification|"
                r"project|internship", re.I), None),
]


def _home_of(heading: str) -> str | None:
    return next((h for pattern, h in _HEADING_HOMES if pattern.search(heading)), "unplaced")


def _file_by_heading(data: dict, heading: str, points: list[str]) -> None:
    home = _home_of(heading)
    if home is None:
        return
    if home == "skills":
        data["skills"] = _clean_skills(data["skills"] + points)
    elif home == "unplaced":
        if _RESPONSIBILITY_HEADING.search(heading):
            heading = RESPONSIBILITIES_HEADING
        group = next((g for g in data["unplaced"] if g["heading"] == heading), None)
        if group is None:
            data["unplaced"].append(group := {"heading": heading, "points": []})
        have = {p.lower() for p in group["points"]}
        group["points"] += [p for p in points if p.lower() not in have]
    else:
        have = {p.lower() for p in data[home]}
        data[home] += [p for p in points if p.lower() not in have]


# A heading line: short, and in capitals or ending with a colon
# ("KEY RESPONSIBILITIES.", "Roles & Responsibilities:").
def _is_heading(line: str) -> bool:
    letters = [c for c in line if c.isalpha()]
    if not letters or len(line) > 60 or len(line.split()) > 6:
        return False
    upper = sum(c.isupper() for c in letters) / len(letters)
    return upper > 0.8 or line.endswith(":")


def _bigrams(text: str) -> set[tuple[str, str]]:
    words = re.findall(r"[a-z0-9]+", plain_text(text).lower())
    return set(zip(words, words[1:])) or {(w, "") for w in words}


def _points_left_out(raw_text: str, data: dict) -> list[dict]:
    """The résumé's printed points (lines opening with a bullet, a dash or a
    number) that appear nowhere in what was read, grouped under the heading
    each sat under. A point counts as read when most of its word pairs are
    in the output, so the model's small fixes to spacing or a split
    paragraph don't flag it; one it dropped is all but absent. Under a
    skills heading every point comes back: the model sometimes keeps a
    line's group name and drops the tools in its brackets, and the skills
    clean-up takes each skill once however often it arrives."""
    read = set().union(*(_bigrams(s) for s in _strings(data)))
    groups: dict[str, list[str]] = {}
    heading, point = "", None
    lines = raw_text.split("Hyperlinks found in this document")[0].splitlines()

    def close():
        if point:
            text = plain_text(" ".join(point.split()))
            pairs = _bigrams(text)
            if pairs and (_SKILL_HEADING.search(heading) or len(pairs & read) / len(pairs) < 0.5):
                groups.setdefault(heading, []).append(text)

    for raw in lines:
        line = raw.strip()
        if not line or _is_heading(line):
            close()
            point = None
            if line:
                heading = line.strip(" :.").title() if line.isupper() else line.strip(" :.")
            continue
        if _LIST_MARK.match(line):
            close()
            point = _LIST_MARK.sub("", line, count=1)
        elif point is not None:
            point += " " + line
    close()
    return [{"heading": h or RESPONSIBILITIES_HEADING, "points": _clean_points(p)} for h, p in groups.items()]


def _strings(value) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for v in value.values() for s in _strings(v)]
    if isinstance(value, list):
        return [s for v in value for s in _strings(v)]
    return []


def _clean_unplaced(value) -> list[dict]:
    """The sections of points the résumé ties to no job, for the profile's
    Miscellaneous — never the résumé itself, which keeps only what it
    printed where it printed it. Each heading reads as a heading, its points
    as points; a section with no points is dropped."""
    out = []
    for group in value if isinstance(value, list) else []:
        if not isinstance(group, dict):
            continue
        points = _clean_points(group.get("points"))
        if not points:
            continue
        heading = group.get("heading").strip(" \t:.-") if isinstance(group.get("heading"), str) else ""
        if not heading or _RESPONSIBILITY_HEADING.search(heading):
            heading = RESPONSIBILITIES_HEADING
        elif heading.isupper():
            heading = heading.title()
        out.append({"heading": heading, "points": points})
    return out


# Text every entry carries, as the résumé model types it — pages read these
# as strings (the Profile trims a job's company), so a field the résumé
# doesn't print comes back "" rather than null.
_REQUIRED_TEXT = {
    "experience": ("company", "title", "start"),
    "projects": ("name",),
    "education": ("institution", "degree", "year"),
}


def _with_text(entry: dict, required: tuple[str, ...]) -> dict:
    for key in required:
        value = entry.get(key)
        entry[key] = value.strip() if isinstance(value, str) else ""
    return entry


def _clean_points(value) -> list[str]:
    """A list of points: text only, trimmed, without the bullet or number the
    résumé printed before it (the template draws its own), blanks dropped."""
    out = []
    for item in value if isinstance(value, list) else []:
        if isinstance(item, str):
            text = _LIST_MARK.sub("", item.strip(), count=1).strip()
            if text:
                out.append(text)
    return out


# The standard date text apps/web/lib/month-year.ts writes and reads:
# "Jan 2022", "2022" or "Present". The same readings, so an upload lands in
# the form the month-year picker shows as already picked.
_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july",
                "august", "september", "october", "november", "december"]
_PRESENT_WORDS = re.compile(r"^(present|current(ly)?|now|ongoing|till date|to date|today|till now)$", re.I)


def _month_of(word: str) -> int | None:
    w = word.lower().rstrip(".")
    if len(w) < 3:
        return None
    for i, name in enumerate(_MONTH_NAMES):
        if name.startswith(w) or (w == "sept" and i == 8):
            return i
    return None


def _year_of(text: str) -> int | None:
    if re.fullmatch(r"\d{4}", text):
        return int(text)
    if re.fullmatch(r"\d{2}", text):
        from datetime import date
        n, cutoff = int(text), (date.today().year + 10) % 100
        return 2000 + n if n <= cutoff else 1900 + n
    return None


def _tidy_date(raw: str) -> str:
    """"Jan 2022", "2022", "Present" — or the text as it came when it isn't a
    date this reads, for the picker to ask about."""
    s = " ".join(raw.split())
    if _PRESENT_WORDS.match(s):
        return "Present"
    if m := re.fullmatch(r"([A-Za-z]{3,9}\.?),? '?(\d{2}|\d{4})", s):
        month, year = _month_of(m[1]), _year_of(m[2])
        return f"{_MONTHS[month]} {year}" if month is not None and year is not None else s
    if (m := re.fullmatch(r"(\d{1,2})\s*[/.-]\s*(\d{4})", s)) and 1 <= int(m[1]) <= 12:
        return f"{_MONTHS[int(m[1]) - 1]} {m[2]}"
    if (m := re.fullmatch(r"(\d{4})\s*[/.-]\s*(\d{1,2})", s)) and 1 <= int(m[2]) <= 12:
        return f"{_MONTHS[int(m[2]) - 1]} {m[1]}"
    return s


def _tidy_dates(entry: dict) -> None:
    for key in ("start", "end"):
        if isinstance(entry.get(key), str):
            entry[key] = _tidy_date(entry[key])


# A skills line's group name — "Languages: Go, Python", "Cloud / DevOps:
# AWS" — says where the skills sit, and isn't one itself.
_GROUP_WORDS = {
    "languages", "language", "programming", "frameworks", "framework", "libraries", "tools", "tool",
    "databases", "database", "cloud", "devops", "web", "frontend", "backend", "other", "others",
    "technologies", "technology", "platforms", "platform", "operating", "systems", "os", "practices",
    "infrastructure", "testing", "skills", "skill", "technical", "soft", "core", "key", "methodologies",
    "software", "packages", "ides", "ide", "scripting", "version", "control", "misc", "miscellaneous",
    "domain", "domains", "and", "&", "/",
}
_TOP_LEVEL_SPLIT = re.compile(r"[;|]|,(?![^()]*\))")


def _skill_items(line: str) -> list[str]:
    """One skills entry as the separate skills it names.

    Résumés group skills on a line, and the tools in brackets or after a
    colon or a spaced dash are the ones a recruiter searches for: "SIEM
    Monitoring (Microsoft Sentinel, ArcSight)" is three skills, "Languages:
    Go, Python" two. Brackets around a single thing ("Lean Six Sigma (Green
    Belt)", "Python (3 years)") are part of its name and stay."""
    out: list[str] = []
    for part in _TOP_LEVEL_SPLIT.split(line):
        part = part.strip()
        if not part:
            continue
        head, sep, rest = part.partition(":")
        if not sep:
            head, sep, rest = part.partition(" - ")
        if sep and rest.strip():
            out += [] if _is_group_name(head) else _skill_items(head)
            out += _skill_items(rest)
            continue
        m = re.fullmatch(r"(.+?)\s*\((.+,.+)\)", part)
        if m:
            out += [] if _is_group_name(m[1]) else [m[1].strip()]
            out += [s.strip() for s in m[2].split(",") if s.strip()]
            continue
        out.append(part)
    return out


def _is_group_name(text: str) -> bool:
    words = re.findall(r"[a-z]+|&|/", text.lower())
    return not words or all(w in _GROUP_WORDS for w in words)


def _clean_skills(value) -> list[str]:
    seen: set[str] = set()
    out = []
    for line in value if isinstance(value, list) else []:
        if not isinstance(line, str):
            continue
        for skill in _skill_items(line):
            # "Lean Six Sigma (Green Belt)" is too long for a chip; the name
            # before the bracket isn't.
            if not _looks_like_a_skill(skill) and "(" in skill:
                skill = skill.split("(", 1)[0].strip()
            key = skill.lower()
            if key not in seen and _looks_like_a_skill(skill):
                seen.add(key)
                out.append(skill)
    return out


# A list marker opening a line: a bullet symbol (➢, •), a dash or star, or
# "1." / "1)".
_LIST_MARK = re.compile(rf"^[ \t]*(?:[{_BULLETS}][ \t]*|(?:[-*]|\d{{1,2}}[.)])[ \t]+)", re.MULTILINE)


def _as_paragraph(text: str) -> str:
    """A summary printed as a list of points, read back as one paragraph.

    The model copies it verbatim, markers and all, and the summary prints as
    a paragraph — so it showed as "- Point. - Point." run together. A list is
    text that opens with a marker, or has two or more lines that do. Each
    point keeps its words and ends with a full stop; anything else is left
    exactly as it came. Runs before plain_deep, while a bullet symbol is
    still one: the model sometimes puts every point on one line ("➢ One.
    ➢ Two."), and a bullet symbol is never part of a sentence, so it splits
    wherever it stands. A dash only splits at the start of a line."""
    first = _LIST_MARK.match(text)
    if not first and len(_LIST_MARK.findall(text)) < 2:
        return text
    symbol = first.group().strip() if first and first.group().strip() in _BULLETS else ""
    splitter = re.compile(_LIST_MARK.pattern + (f"|{re.escape(symbol)}" if symbol else ""), re.MULTILINE)
    points = [" ".join(p.split()) for p in splitter.split(text)]
    return " ".join(p if p[-1] in ".!?" else p + "." for p in points if p)


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

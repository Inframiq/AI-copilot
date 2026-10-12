"""Parse uploaded PDF/DOCX resumes into structured ResumeContent dicts."""
import io
import re
import json
import zipfile
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

# DOCX files are zip archives — a maliciously crafted archive can advertise a
# tiny compressed size but expand to gigabytes ("zip bomb"), exhausting memory
# before python-docx ever gets to text extraction. Bound both the total
# decompressed size and the per-entry compression ratio before handing the
# archive to python-docx.
_MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024  # 50 MB of decompressed XML is already generous
_MAX_DOCX_COMPRESSION_RATIO = 100  # legitimate docx XML rarely exceeds ~20:1


def _check_docx_zip_safety(file_bytes: bytes) -> None:
    """Raise ValueError if the docx zip looks like a decompression bomb or is corrupt."""
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
            total_uncompressed = 0
            for info in zf.infolist():
                total_uncompressed += info.file_size
                if total_uncompressed > _MAX_DOCX_UNCOMPRESSED_BYTES:
                    raise ValueError("DOCX file exceeds the maximum allowed decompressed size.")
                if info.compress_size > 0 and (info.file_size / info.compress_size) > _MAX_DOCX_COMPRESSION_RATIO:
                    raise ValueError("DOCX file failed safety validation (suspicious compression ratio).")
    except zipfile.BadZipFile:
        raise ValueError("Invalid DOCX file — not a valid archive.")


class ParsedResume(BaseModel):
    contact: dict
    summary: str | None = None
    experience: list[dict]
    projects: list[dict] | None = None
    education: list[dict]
    skills: list[str]
    languages: list[dict] | None = None
    certifications: list[str] | None = None


def extract_text_from_docx(file_bytes: bytes) -> str:
    _check_docx_zip_safety(file_bytes)
    try:
        import docx  # type: ignore
        doc = docx.Document(io.BytesIO(file_bytes))
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        text = "\n".join(paragraphs).strip()
        # Same issue as PDF's _extract_links — a Word hyperlink's visible
        # run text (e.g. "GitHub") never includes the address it points at.
        links = [
            _Link(h.address, h.text.strip(), p.text.strip())
            for p in doc.paragraphs
            for h in p.hyperlinks
            if h.address
        ]
        return _append_link_hints(text, links)[:_MAX_TEXT_CHARS]
    except ImportError:
        raise RuntimeError("python-docx is not installed. Add 'python-docx' to requirements.txt.")


def extract_text(file_bytes: bytes, content_type: str) -> str:
    ct = content_type.lower()
    if "pdf" in ct:
        return extract_text_from_pdf(file_bytes)
    if "word" in ct or "docx" in ct or "openxml" in ct:
        return extract_text_from_docx(file_bytes)
    # Fallback: assume plain text
    return file_bytes.decode("utf-8", errors="replace")[:_MAX_TEXT_CHARS]


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
    "github": "github URL if present"
  },
  "summary": "professional summary paragraph if present, else null",
  "experience": [
    {
      "company": "Company Name",
      "title": "Job Title",
      "location": "City, State/Country or 'Remote' if present, else null",
      "start": "Mon YYYY or YYYY",
      "end": "Mon YYYY or 'Present'",
      "bullets": ["bullet 1", "bullet 2"]
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
      "gpa": "grade exactly as printed, or null"
    }
  ],
  "skills": ["Skill1", "Skill2"],
  "languages": [{"name": "language exactly as printed", "level": "level as printed, or null"}],
  "certifications": ["Cert name if any"]
}

Rules:
- Return only the JSON object, no markdown fences.
- Keep all original bullet text verbatim — do not rewrite.
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
  an employer, which belongs in "experience" instead.
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


async def parse_resume_text(raw_text: str, provider: AIProvider) -> dict:
    raw = await provider.complete(PARSE_SYSTEM, raw_text, model_tier="fast")
    cleaned = _strip_json_fence(raw)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        # Return a minimal skeleton so the caller can still create a resume
        data = {
            "contact": {"name": "", "email": ""},
            "experience": [],
            "projects": [],
            "education": [],
            "skills": [],
        }
    # Ensure required keys exist
    data.setdefault("contact", {"name": "", "email": ""})
    data.setdefault("experience", [])
    data.setdefault("projects", [])
    data.setdefault("education", [])
    data.setdefault("skills", [])
    # Defense-in-depth against the model pulling a responsibility/summary
    # sentence into "skills" despite the prompt rule against it — same
    # prose-vs-skill-name filter tailoring.py applies to AI-suggested skills.
    data["skills"] = [s for s in data["skills"] if isinstance(s, str) and _looks_like_a_skill(s)]
    for project in data["projects"] or []:
        if isinstance(project, dict):
            _keep_only_real_urls(project)
    return data


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

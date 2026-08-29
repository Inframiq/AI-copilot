"""Parse uploaded PDF/DOCX resumes into structured ResumeContent dicts."""
import io
import re
import json
import zipfile
from pydantic import BaseModel
from app.services.ai_engine.base import AIProvider
from app.services.tailoring import _looks_like_a_skill

_MAX_PDF_PAGES = 50
_MAX_TEXT_CHARS = 100_000

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


def extract_text_from_pdf(file_bytes: bytes) -> str:
    try:
        import pypdf  # type: ignore
        reader = pypdf.PdfReader(io.BytesIO(file_bytes))
        if len(reader.pages) > _MAX_PDF_PAGES:
            raise ValueError(f"PDF exceeds maximum page count ({_MAX_PDF_PAGES} pages).")
        pages = [page.extract_text() or "" for page in reader.pages]
        text = "\n".join(pages).strip()
        return text[:_MAX_TEXT_CHARS]
    except ImportError:
        raise RuntimeError("pypdf is not installed. Add 'pypdf' to requirements.txt.")


def extract_text_from_docx(file_bytes: bytes) -> str:
    _check_docx_zip_safety(file_bytes)
    try:
        import docx  # type: ignore
        doc = docx.Document(io.BytesIO(file_bytes))
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        text = "\n".join(paragraphs).strip()
        return text[:_MAX_TEXT_CHARS]
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
      "start": "Mon YYYY or YYYY",
      "end": "Mon YYYY or 'Present'",
      "bullets": ["bullet 1", "bullet 2"]
    }
  ],
  "projects": [
    {
      "name": "Project Name",
      "tech_stack": "e.g. React, Node.js, PostgreSQL — if present",
      "link": "GitHub/demo URL if present",
      "start": "Mon YYYY or YYYY, if present",
      "end": "Mon YYYY, YYYY, or 'Present', if present",
      "bullets": ["bullet 1", "bullet 2"]
    }
  ],
  "education": [
    {
      "institution": "University Name",
      "degree": "Degree and major",
      "year": "YYYY or YYYY-YYYY"
    }
  ],
  "skills": ["Skill1", "Skill2"],
  "languages": [{"name": "English", "level": "Native"}],
  "certifications": ["Cert name if any"]
}

Rules:
- Return only the JSON object, no markdown fences.
- Keep all original bullet text verbatim — do not rewrite.
- If a field is not found, use null for strings and [] for arrays.
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
      Northwind Traders
      Senior Data Analyst | Mar 2022 – Present
        - Owns the revenue forecasting models used by finance.
      Data Analyst | Jul 2019 – Feb 2022
        - Built the first self-serve reporting dashboards.
  MUST parse to TWO experience entries:
      {"company": "Northwind Traders", "title": "Senior Data Analyst",
       "start": "Mar 2022", "end": "Present",
       "bullets": ["Owns the revenue forecasting models used by finance."]},
      {"company": "Northwind Traders", "title": "Data Analyst",
       "start": "Jul 2019", "end": "Feb 2022",
       "bullets": ["Built the first self-serve reporting dashboards."]}
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
    return data

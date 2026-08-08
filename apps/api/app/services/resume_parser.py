"""Parse uploaded PDF/DOCX resumes into structured ResumeContent dicts."""
import io
import re
import json
from pydantic import BaseModel
from app.services.ai_engine.base import AIProvider

_MAX_PDF_PAGES = 50
_MAX_TEXT_CHARS = 100_000


class ParsedResume(BaseModel):
    contact: dict
    headline: str | None = None
    summary: str | None = None
    experience: list[dict]
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
  "headline": "one-line job title / headline if present, else null",
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
- skills must be a flat list of individual skill strings.
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
            "education": [],
            "skills": [],
        }
    # Ensure required keys exist
    data.setdefault("contact", {"name": "", "email": ""})
    data.setdefault("experience", [])
    data.setdefault("education", [])
    data.setdefault("skills", [])
    return data

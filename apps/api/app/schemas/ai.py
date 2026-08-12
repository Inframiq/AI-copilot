import json
import uuid
from datetime import datetime
from pydantic import BaseModel, Field, field_validator
from app.schemas.resume import _validate_content_size

_MAX_PRIORITY_SKILLS = 20
_MAX_PROFILE_JSON_BYTES = 200_000


class TailorRequest(BaseModel):
    resume_id: uuid.UUID
    jd_id: uuid.UUID
    humanize_level: int = Field(default=50, ge=0, le=100)
    company_name: str | None = Field(default=None, max_length=200)
    # Keywords the user explicitly picked from the JD's "Not Matched" list —
    # these take precedence over the AI's own plausible_skills_to_add logic.
    # Empty by default: the AI decides on its own, same as before this field existed.
    priority_skills: list[str] = Field(default_factory=list)

    @field_validator("priority_skills")
    @classmethod
    def _cap_priority_skills(cls, value: list[str]) -> list[str]:
        cleaned = [s.strip()[:200] for s in value if s and s.strip()]
        return cleaned[:_MAX_PRIORITY_SKILLS]


class AnalyzeRequest(BaseModel):
    resume_id: uuid.UUID
    jd_id: uuid.UUID
    company_name: str | None = Field(default=None, max_length=200)
    # Optional unsaved-content override — same pattern as PdfGenerateRequest.
    # Lets the bullet-review screen re-score the resume as currently edited
    # (accepted/rejected/humanized bullets) without persisting anything or
    # requiring resume_id's stored content to already reflect those edits.
    content: dict | None = None

    _check_content_size = field_validator("content")(_validate_content_size)


class AnalyzeOut(BaseModel):
    ats_score: int
    matched_skills: list[str]
    missing_skills: list[str]
    company_keywords: list[str] = []


class PrepQuestionOut(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    topic: str
    question: str
    answer_framework: str
    is_gap_based: bool
    order_index: int
    practiced_at: datetime | None = None
    model_config = {"from_attributes": True}


class SkillQuestionOut(BaseModel):
    id: uuid.UUID
    skill: str
    topic: str
    question: str
    answer_framework: str
    model_config = {"from_attributes": True}


class LearningItemIn(BaseModel):
    skill: str = Field(min_length=1, max_length=255)
    source_jd_title: str | None = Field(default=None, max_length=255)


class LearningItemOut(BaseModel):
    id: uuid.UUID
    skill: str
    source_jd_title: str | None
    status: str
    created_at: datetime
    model_config = {"from_attributes": True}


class RewriteBulletRequest(BaseModel):
    bullet_text: str = Field(max_length=3000)
    mode: str = Field(pattern="^(rewrite|humanize)$")
    jd_context: str = Field(default="", max_length=8000)
    humanize_level: int = Field(default=50, ge=0, le=100)


class RewriteBulletOut(BaseModel):
    rewritten_text: str


class TailorStartOut(BaseModel):
    session_id: uuid.UUID
    status: str


class TailorOut(BaseModel):
    session_id: uuid.UUID
    ats_score: int
    matched_skills: list[str]
    missing_skills: list[str]
    tailored_content: dict
    questions: list[PrepQuestionOut]
    company_keywords: list[str] = []
    suggested_skills: list[str] = []


class GenerateResumeRequest(BaseModel):
    candidate_type: str = Field(pattern="^(fresher|experienced)$")
    # Raw, unbounded candidate profile — same general shape as resume content
    # (contact/experience/projects/education/skills/...) but with no per-
    # section caps; the generator selects the strongest subset itself.
    profile: dict
    target_role: str = Field(default="", max_length=200)
    jd_text: str | None = Field(default=None, max_length=20000)
    template_id: str = Field(default="ats_clean")
    # When set, overwrites this existing resume row instead of creating a new one.
    resume_id: uuid.UUID | None = None
    title: str | None = Field(default=None, max_length=255)

    @field_validator("profile")
    @classmethod
    def _cap_profile_size(cls, value: dict) -> dict:
        if len(json.dumps(value)) > _MAX_PROFILE_JSON_BYTES:
            raise ValueError(f"profile exceeds the maximum allowed size of {_MAX_PROFILE_JSON_BYTES} bytes")
        return value


class GenerateResumeOut(BaseModel):
    resume_id: uuid.UUID
    content: dict
    template_id: str
    valid: bool
    violations: list[dict]

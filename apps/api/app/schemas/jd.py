import uuid
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field, computed_field

JDStatus = Literal["not_applied", "applied", "interview", "final_round", "offer", "accepted", "rejected"]


class JDCreate(BaseModel):
    raw_text: str = Field(max_length=50_000)
    title: str | None = Field(default=None, max_length=255)


class JDStatusUpdate(BaseModel):
    status: JDStatus


class JDTitleUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class JDOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    title: str
    raw_text: str
    parsed: dict | None
    status: str
    created_at: datetime
    # Latest completed tailoring session's score for this JD — not a column
    # on JobDescription itself, populated separately in list_jds/get_jd.
    # Lives on the JD (not Resume, which has no ats_score column at all)
    # because match quality is a property of "this resume against this job",
    # and one resume can be tailored against many JDs with different scores.
    ats_score: int | None = None
    # The tailored résumé the user saved for this JD from the Studio, if any.
    tailored_resume_id: uuid.UUID | None = None
    model_config = {"from_attributes": True}

    @computed_field
    @property
    def parsed_skills(self) -> list[str]:
        """The JD's skills as a flat chip list, from Agent 1's parse.

        This used to come from a separate legacy extractor (extract_jd_skills)
        whose output sat on the JD page beside Agent 1's matched/not-matched
        columns and disagreed with them — a skill could appear here and in
        neither column. One extraction now feeds both, and creating a JD no
        longer costs an extra model call.

        Only the buckets that are genuinely skill-shaped are included:
        domain_expertise_themes, seniority_indicators, core_responsibilities
        and target_job_titles hold sentences and would render as garbage chips.
        """
        if not self.parsed:
            return []
        agent1 = self.parsed.get("agent1")
        if agent1:
            buckets = (
                "exact_technical_tools",
                "methodologies_and_frameworks",
                "ats_filter_phrases",
                "nice_to_have_skills",
            )
            out: list[str] = []
            seen: set[str] = set()
            for bucket in buckets:
                for skill in agent1.get(bucket) or []:
                    key = str(skill).strip().lower()
                    if key and key not in seen:
                        seen.add(key)
                        out.append(skill)
            return out
        # Rows created before the legacy extractor was removed.
        required = self.parsed.get("required") or []
        nice_to_have = self.parsed.get("nice_to_have") or []
        return [*required, *nice_to_have]

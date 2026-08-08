import re
import json
from dataclasses import dataclass
from pydantic import BaseModel
from app.services.ai_engine.base import AIProvider
from app.services.ats import compute_delta, DeltaResult


class ParsedJD(BaseModel):
    required: list[str]
    nice_to_have: list[str]


class PrepQuestionData(BaseModel):
    topic: str
    question: str
    answer_framework: str
    is_gap_based: bool = True
    order_index: int


class PrepQuestionsWrapper(BaseModel):
    questions: list[PrepQuestionData]


@dataclass
class TailoringResult:
    tailored_content: dict
    matched_skills: list[str]
    missing_skills: list[str]
    ats_score: int
    prep_questions: list[PrepQuestionData]


def _strip_json_fence(raw: str) -> str:
    """Remove optional ```json ... ``` markdown fences from LLM output."""
    s = raw.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```$", "", s)
    return s.strip()


def _sanitize_skill_list(skills: list[str]) -> list[str]:
    """Strip control characters and cap length to prevent prompt injection."""
    result = []
    for s in skills:
        s = re.sub(r"[\x00-\x1f\x7f]", "", s)  # remove control chars
        s = s[:200]                               # cap individual skill length
        if s:
            result.append(s)
    return result


async def extract_jd_skills(jd_text: str, provider: AIProvider) -> ParsedJD:
    system = (
        "You are an expert technical recruiter. Extract skills from the job description. "
        "Return structured JSON only."
    )
    return await provider.complete_structured(system, jd_text, ParsedJD, model_tier="fast")


async def rewrite_bullets(
    resume_content: dict,
    matched_skills: list[str],
    missing_skills: list[str],
    jd_keywords: list[str],
    humanize_level: int,
    provider: AIProvider,
) -> dict:
    # Sanitize LLM-extracted lists before re-injecting into a new prompt
    safe_matched = _sanitize_skill_list(matched_skills)
    safe_missing = _sanitize_skill_list(missing_skills)
    safe_keywords = _sanitize_skill_list(jd_keywords)

    humanize_desc = (
        "Write in completely natural prose — keywords appear organically." if humanize_level < 30
        else "Front-load keywords prominently in each bullet for maximum ATS density." if humanize_level > 70
        else "Weave keywords naturally into bullets while keeping them readable."
    )
    system = (
        "You are a professional resume writer and ATS optimization expert.\n\n"
        "TASK: Rewrite the resume to maximize ATS score against the job description.\n\n"
        f"MATCHED SKILLS (already present — reinforce these with JD-exact phrasing): {safe_matched}\n"
        f"MISSING SKILLS (add to skills list only if the candidate could plausibly have them): {safe_missing}\n"
        f"JD KEYWORDS (exact phrases the ATS will scan for — embed these throughout): {safe_keywords}\n\n"
        "RULES:\n"
        "1. Rewrite experience bullets to use the exact phrases and terminology from the JD, not synonyms.\n"
        "2. Add any missing skills the candidate could plausibly have to the skills[] array.\n"
        "3. Keep all accomplishments, dates, and company names exactly as-is — never fabricate metrics.\n"
        f"4. {humanize_desc}\n"
        "5. Return the COMPLETE resume_content JSON (all fields) with changes applied.\n"
        "6. Output only raw JSON — no markdown fences, no explanation."
    )
    raw = await provider.complete(system, json.dumps(resume_content), model_tier="pro")
    try:
        return json.loads(_strip_json_fence(raw))
    except json.JSONDecodeError:
        return resume_content  # fallback: return original if parsing fails


async def extract_ats_keywords(jd_text: str, provider: AIProvider) -> list[str]:
    """Extract the exact keyword phrases an ATS would scan for in this JD."""
    system = (
        "You are an ATS (Applicant Tracking System) expert. Extract the exact keyword phrases "
        "that an ATS would use to filter resumes for this job description.\n"
        "Include: specific tool names, framework versions, methodology names, certification names, "
        "domain buzzwords, and action verbs the company uses.\n"
        "Return a JSON array of strings only — no explanation, no markdown."
    )
    raw = await provider.complete(system, jd_text, model_tier="fast")
    try:
        result = json.loads(_strip_json_fence(raw))
        return result if isinstance(result, list) else []
    except json.JSONDecodeError:
        return []


async def generate_prep_questions(
    missing_skills: list[str], resume_content: dict, provider: AIProvider
) -> list[PrepQuestionData]:
    safe_missing = _sanitize_skill_list(missing_skills)
    system = (
        "You are an expert interview coach. Generate 10 interview questions based on the "
        f"candidate's resume gaps. Missing skills: {safe_missing}. "
        "For each question, provide: topic, question, answer_framework (STAR-based), "
        "is_gap_based=true, order_index. Return as JSON with a 'questions' array."
    )
    wrapper = await provider.complete_structured(
        system, json.dumps(resume_content), PrepQuestionsWrapper, model_tier="pro"
    )
    return wrapper.questions


async def run_tailoring_pipeline(
    resume_content: dict, jd_text: str, humanize_level: int, provider: AIProvider
) -> TailoringResult:
    import asyncio

    # Step A: extract JD skills + ATS keywords in parallel (both fast model)
    parsed_jd, jd_keywords = await asyncio.gather(
        extract_jd_skills(jd_text, provider),
        extract_ats_keywords(jd_text, provider),
    )

    # Dedupe case-insensitively
    seen: set[str] = set()
    all_jd_skills: list[str] = []
    for skill in parsed_jd.required + parsed_jd.nice_to_have:
        key = skill.strip().lower()
        if key and key not in seen:
            seen.add(key)
            all_jd_skills.append(skill)

    # Step B: compute delta (local, no AI)
    resume_text = json.dumps(resume_content)
    delta = compute_delta(all_jd_skills, resume_text)

    # Step C: rewrite bullets with full keyword context (pro model)
    tailored = await rewrite_bullets(
        resume_content, delta.matched, delta.missing, jd_keywords, humanize_level, provider
    )

    # Step D: generate prep questions (pro model)
    questions = await generate_prep_questions(delta.missing, resume_content, provider)

    return TailoringResult(
        tailored_content=tailored,
        matched_skills=delta.matched,
        missing_skills=delta.missing,
        ats_score=delta.ats_score,
        prep_questions=questions,
    )

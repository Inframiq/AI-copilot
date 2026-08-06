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


async def extract_jd_skills(jd_text: str, provider: AIProvider) -> ParsedJD:
    system = (
        "You are an expert technical recruiter. Extract skills from the job description. "
        "Return structured JSON only."
    )
    return await provider.complete_structured(system, jd_text, ParsedJD, model_tier="fast")


async def rewrite_bullets(
    resume_content: dict, matched_skills: list[str], humanize_level: int, provider: AIProvider
) -> dict:
    humanize_desc = (
        "Write in completely natural prose — keywords appear organically." if humanize_level < 30
        else "Front-load keywords prominently in each bullet for maximum ATS density." if humanize_level > 70
        else "Weave keywords naturally into bullets while keeping them readable."
    )
    system = (
        f"You are a professional resume writer. Rewrite the experience bullets to include "
        f"these skills: {matched_skills}. {humanize_desc} "
        f"Return the full resume_content JSON with rewritten bullets only — do not add fake metrics."
    )
    raw = await provider.complete(system, json.dumps(resume_content), model_tier="pro")
    try:
        cleaned = raw.strip().lstrip("```json").rstrip("```").strip()
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return resume_content  # fallback: return original if parsing fails


async def generate_prep_questions(
    missing_skills: list[str], resume_content: dict, provider: AIProvider
) -> list[PrepQuestionData]:
    system = (
        "You are an expert interview coach. Generate 10 interview questions based on the "
        f"candidate's resume gaps. Missing skills: {missing_skills}. "
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
    # Step A: extract JD skills (fast model)
    parsed_jd = await extract_jd_skills(jd_text, provider)
    all_jd_skills = parsed_jd.required + parsed_jd.nice_to_have

    # Step B: compute delta (local, no AI)
    resume_text = json.dumps(resume_content)
    delta = compute_delta(all_jd_skills, resume_text)

    # Step C: rewrite bullets (pro model)
    tailored = await rewrite_bullets(resume_content, delta.matched, humanize_level, provider)

    # Step D: generate prep questions (pro model)
    questions = await generate_prep_questions(delta.missing, resume_content, provider)

    return TailoringResult(
        tailored_content=tailored,
        matched_skills=delta.matched,
        missing_skills=delta.missing,
        ats_score=delta.ats_score,
        prep_questions=questions,
    )

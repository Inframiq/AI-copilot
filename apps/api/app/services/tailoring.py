"""
4-Agent ATS Tailoring Pipeline
================================
Agent 0 — Company Intel     : (Optional) Extracts company-specific ATS keywords,
                              culture language, and terminology for a named company.
Agent 1 — JD Deconstructor  : Parses the JD into structured semantic categories,
                              enriched by company intel when available.
Agent 2 — Semantic Mapper   : Maps each JD requirement to specific resume bullets
                              with zero hallucination (mapping plan).
Agent 3 — Precision Writer  : Rewrites each bullet exactly per the mapping plan,
                              preserving all original metrics and dates.

prep_questions runs in parallel with Agent 3 once the mapping plan is ready.
"""
import re
import json
import asyncio
from copy import deepcopy
from dataclasses import dataclass
from pydantic import BaseModel
from app.services.ai_engine.base import AIProvider
from app.services.ats import compute_delta


# ── Pydantic models ───────────────────────────────────────────────────────────

class CompanyIntel(BaseModel):
    """Output of Agent 0 — company-specific ATS intelligence."""
    company_name: str
    culture_keywords: list[str]          # values/mission language used in job posts
    tech_stack_preferences: list[str]    # technologies this company is known to use
    ats_filter_phrases: list[str]        # verbatim multi-word phrases this company embeds in JDs
    terminology_preferences: list[str]  # how the company names roles/concepts (e.g. "Staff Eng" vs "Principal")
    known_not_found: bool = False        # True when the company is too obscure for reliable intel


class JDAnalysis(BaseModel):
    """Output of Agent 1 — structured deconstruction of the JD."""
    exact_technical_tools: list[str]
    methodologies_and_frameworks: list[str]
    domain_expertise_themes: list[str]
    seniority_indicators: list[str]
    ats_filter_phrases: list[str]  # verbatim phrases ATS scanners grep for


class BulletMapping(BaseModel):
    """One entry in the mapping plan produced by Agent 2."""
    original_bullet_id: str
    original_text: str
    target_jd_keywords_to_inject: list[str]
    preserved_metrics: list[str]
    strategic_instruction: str


class MappingPlan(BaseModel):
    """Output of Agent 2."""
    mapping_plan: list[BulletMapping]
    plausible_skills_to_add: list[str]


class RewrittenBullet(BaseModel):
    bullet_id: str
    rewritten_text: str


class WriterOutput(BaseModel):
    """Output of Agent 3."""
    rewritten_bullets: list[RewrittenBullet]
    updated_skills: list[str]


class PrepQuestionData(BaseModel):
    topic: str
    question: str
    answer_framework: str
    is_gap_based: bool = True
    order_index: int


class PrepQuestionsWrapper(BaseModel):
    questions: list[PrepQuestionData]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _strip_json_fence(raw: str) -> str:
    s = raw.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```$", "", s)
    return s.strip()


def _sanitize_skill_list(skills: list[str]) -> list[str]:
    result = []
    for s in skills:
        s = re.sub(r"[\x00-\x1f\x7f]", "", s)
        s = s[:200]
        if s:
            result.append(s)
    return result


def _index_bullets(resume_content: dict) -> tuple[dict, dict[str, str]]:
    """
    Assign a stable ID to every bullet in resume_content.
    Returns:
        indexed_content  — deep copy with bullet_id injected into each bullet dict
                           (or, for plain strings, wraps them as dicts)
        id_to_index      — mapping of bullet_id → (exp_index, bullet_index) as string
    """
    content = deepcopy(resume_content)
    bullet_index: dict[str, str] = {}
    for exp_i, exp in enumerate(content.get("experience", [])):
        new_bullets = []
        for b_i, bullet in enumerate(exp.get("bullets", [])):
            bid = f"exp{exp_i}_b{b_i}"
            bullet_index[bid] = f"experience[{exp_i}].bullets[{b_i}]"
            if isinstance(bullet, str):
                new_bullets.append({"bullet_id": bid, "text": bullet})
            else:
                bullet["bullet_id"] = bid
                new_bullets.append(bullet)
        exp["bullets"] = new_bullets
    return content, bullet_index


def _apply_writer_output(resume_content: dict, writer: WriterOutput) -> dict:
    """Patch rewritten bullets back into resume_content in-place."""
    content = deepcopy(resume_content)
    rewrite_map = {r.bullet_id: r.rewritten_text for r in writer.rewritten_bullets}

    for exp in content.get("experience", []):
        patched = []
        for bullet in exp.get("bullets", []):
            if isinstance(bullet, dict):
                bid = bullet.get("bullet_id", "")
                text = rewrite_map.get(bid, bullet.get("text", ""))
                patched.append(text)
            else:
                patched.append(bullet)
        exp["bullets"] = patched

    # Merge updated skills (dedupe, preserve order)
    existing = content.get("skills", [])
    seen = {s.lower() for s in existing}
    for skill in writer.updated_skills:
        if skill.lower() not in seen:
            existing.append(skill)
            seen.add(skill.lower())
    content["skills"] = existing
    return content


# ── Agent 0: Company Intelligence ────────────────────────────────────────────

_AGENT0_SYSTEM = """\
<system_role>
You are a senior talent intelligence analyst with deep knowledge of how \
Fortune 500 companies, top tech firms, and high-growth startups screen resumes. \
Your task is to produce company-specific ATS intelligence for a named company.
</system_role>

<rules>
1. Draw on your knowledge of the company's public job postings, engineering blog, \
culture docs, and known hiring practices.
2. culture_keywords: The exact values/mission language this company injects into \
every job description (e.g., Amazon: "customer obsession", "ownership", "bias \
for action"; Google: "impact at scale", "data-driven"; Meta: "move fast", \
"growth mindset").
3. tech_stack_preferences: Technologies this company is publicly known to use \
and therefore prefer in candidates (e.g., Google: Go, Spanner, Borg; \
Stripe: Ruby, Go, Postgres; Netflix: Java, Kafka, Cassandra).
4. ats_filter_phrases: Multi-word verbatim phrases this company's ATS \
commonly filters for — these often come from the company's own internal \
terminology or industry niche (e.g., "distributed systems at scale", \
"cross-functional collaboration", "zero-to-one product development").
5. terminology_preferences: How this company specifically refers to roles and \
concepts that differ from industry norms \
(e.g., Amazon calls senior ICs "Principals", not "Staff Engineers"; \
Apple calls PMs "Product Marketing Managers"; Shopify calls teams "Pods").
6. If the company is genuinely too obscure or too new for reliable intel, \
set known_not_found=true and return empty lists — do not hallucinate.
7. Output ONLY valid JSON matching the schema. No markdown, no preamble.
</rules>

<output_schema>
{
  "company_name": "string",
  "culture_keywords": ["string"],
  "tech_stack_preferences": ["string"],
  "ats_filter_phrases": ["string"],
  "terminology_preferences": ["string"],
  "known_not_found": false
}
</output_schema>"""


async def _agent0_company_intel(company_name: str, provider: AIProvider) -> CompanyIntel:
    safe_name = re.sub(r"[\x00-\x1f\x7f]", "", company_name)[:200]
    return await provider.complete_structured(
        _AGENT0_SYSTEM,
        f"Company: {safe_name}",
        CompanyIntel,
        model_tier="fast",
    )


# ── Agent 1: JD Deconstructor ─────────────────────────────────────────────────

_AGENT1_SYSTEM = """\
<system_role>
You are an elite ATS algorithmic parser and technical recruiter. \
Your task is to deconstruct a Job Description into structural data. \
Do not just look for keywords; extract the semantic themes and core competencies.
</system_role>

<rules>
1. Normalize all tech stacks (e.g., "React.js" and "ReactJS" both become "React").
2. Separate exact-match tooling from broad methodologies (e.g., Agile, CI/CD).
3. Ignore generic filler ("fast-paced environment", "team player", "self-starter").
4. ats_filter_phrases: capture the verbatim multi-word phrases an ATS regex would \
match — these are typically 2–5 word phrases that appear in the JD and are too \
specific to reduce to a single keyword (e.g., "distributed systems design", \
"end-to-end machine learning pipelines", "revenue growth through product-led \
growth").
5. seniority_indicators: capture phrases that signal level \
(e.g., "lead a team of", "5+ years", "principal", "architect", "owns the roadmap").
6. Output ONLY valid JSON matching the schema. No markdown, no preamble.
</rules>

<output_schema>
{
  "exact_technical_tools": ["string"],
  "methodologies_and_frameworks": ["string"],
  "domain_expertise_themes": ["string"],
  "seniority_indicators": ["string"],
  "ats_filter_phrases": ["string"]
}
</output_schema>"""


async def _agent1_parse_jd(
    jd_text: str, provider: AIProvider, company_intel: CompanyIntel | None = None
) -> JDAnalysis:
    user_msg = jd_text
    if company_intel and not company_intel.known_not_found:
        intel_block = json.dumps({
            "company_culture_keywords": company_intel.culture_keywords,
            "company_tech_stack": company_intel.tech_stack_preferences,
            "company_ats_phrases": company_intel.ats_filter_phrases,
            "company_terminology": company_intel.terminology_preferences,
        })
        user_msg = (
            f"<company_intelligence>\n{intel_block}\n</company_intelligence>\n\n"
            f"<job_description>\n{jd_text}\n</job_description>"
        )
    return await provider.complete_structured(
        _AGENT1_SYSTEM, user_msg, JDAnalysis, model_tier="fast"
    )


# ── Agent 2: Semantic Mapper ──────────────────────────────────────────────────

_AGENT2_SYSTEM = """\
<system_role>
You are a strict Data Integrity Auditor and Executive Resume Strategist. \
Your job is Semantic ATS Mapping: identify exactly where the requirements of a \
Job Description intersect with a candidate's actual history, then produce a \
precise rewrite plan.
</system_role>

<rules>
1. ZERO HALLUCINATION POLICY: You may only map a JD requirement to a resume \
bullet if the candidate's original text logically supports that experience. \
If there is no supporting evidence, do not force the mapping.
2. METRIC PRESERVATION: You must capture every number, percentage, dollar figure, \
and date from the original bullet in preserved_metrics. The writer must never \
alter these.
3. TRANSFORMATION TYPES — for each bullet choose the right instruction:
   - REINFORCE: candidate already demonstrates this skill; rephrase to use JD-exact \
terminology.
   - REFRAME: candidate has adjacent experience; shift the framing to align with \
the JD requirement without fabricating new facts.
   - INJECT: add a specific JD keyword that is factually supported by the bullet \
context.
   - SKIP: bullet has no reasonable mapping to any JD requirement — leave as-is.
4. plausible_skills_to_add: only list skills the candidate could genuinely claim \
based on their existing stack (e.g., if they use React, they plausibly know \
JavaScript). Never add skills with no foundation in their history.
5. Output ONLY valid JSON matching the schema. No markdown, no preamble.
</rules>

<output_schema>
{
  "mapping_plan": [
    {
      "original_bullet_id": "string",
      "original_text": "string",
      "target_jd_keywords_to_inject": ["string"],
      "preserved_metrics": ["string"],
      "strategic_instruction": "string"
    }
  ],
  "plausible_skills_to_add": ["string"]
}
</output_schema>"""


async def _agent2_semantic_map(
    jd_analysis: JDAnalysis,
    indexed_resume: dict,
    provider: AIProvider,
) -> MappingPlan:
    payload = {
        "jd_analysis": jd_analysis.model_dump(),
        "original_resume": indexed_resume,
    }
    return await provider.complete_structured(
        _AGENT2_SYSTEM, json.dumps(payload), MappingPlan, model_tier="pro"
    )


# ── Agent 3: Precision Writer ─────────────────────────────────────────────────

def _build_agent3_system(humanize_level: int) -> str:
    if humanize_level < 30:
        tone = (
            "Write in fluent, natural-sounding prose. ATS keywords must appear "
            "organically — a human reader should not notice they were inserted."
        )
    elif humanize_level > 70:
        tone = (
            "Optimise aggressively for ATS density. Front-load the single most "
            "important JD keyword in the first 4 words of each bullet. Pack in "
            "all target keywords while keeping grammar correct."
        )
    else:
        tone = (
            "Balance ATS density and human readability. Weave keywords naturally "
            "into strong action-verb bullets without making them feel keyword-stuffed."
        )

    return f"""\
<system_role>
You are an elite technical resume writer executing a precise, data-driven \
rewrite plan. Every change you make is authorised by the mapping_plan below. \
You do not improvise beyond those instructions.
</system_role>

<rules>
1. EXECUTE THE PLAN EXACTLY: For each bullet_id in the mapping_plan, apply \
the strategic_instruction and inject the target_jd_keywords_to_inject using \
the exact phrasing provided.
2. METRIC LOCK: Every value in preserved_metrics must appear verbatim in your \
rewritten bullet. Do not round, estimate, or omit any metric.
3. BULLET STRUCTURE: Start every bullet with a strong past-tense action verb \
(e.g., Architected, Spearheaded, Engineered, Reduced, Drove). \
Format: [Action Verb] + [Method/Tool with JD keyword] + [Quantified Impact].
4. SKIP BULLETS: If strategic_instruction is "SKIP", copy the original_text \
unchanged into rewritten_text.
5. SKILLS: updated_skills must be the complete final skills list — merge the \
original skills with plausible_skills_to_add, deduplicated.
6. TONE: {tone}
7. Output ONLY valid JSON matching the schema. No markdown, no preamble.
</rules>

<output_schema>
{{
  "rewritten_bullets": [
    {{
      "bullet_id": "string",
      "rewritten_text": "string"
    }}
  ],
  "updated_skills": ["string"]
}}
</output_schema>"""


async def _agent3_write(
    mapping_plan: MappingPlan,
    original_skills: list[str],
    humanize_level: int,
    provider: AIProvider,
) -> WriterOutput:
    payload = {
        "mapping_plan": mapping_plan.model_dump()["mapping_plan"],
        "plausible_skills_to_add": _sanitize_skill_list(
            mapping_plan.plausible_skills_to_add
        ),
        "original_skills": original_skills,
    }
    return await provider.complete_structured(
        _build_agent3_system(humanize_level),
        json.dumps(payload),
        WriterOutput,
        model_tier="pro",
    )


# ── Prep questions (runs in parallel with Agent 3) ────────────────────────────

async def generate_prep_questions(
    missing_skills: list[str], resume_content: dict, provider: AIProvider
) -> list[PrepQuestionData]:
    safe_missing = _sanitize_skill_list(missing_skills)
    system = (
        "You are an expert interview coach. Generate exactly 10 targeted interview "
        "questions for a candidate who is missing these skills: "
        f"{safe_missing}. "
        "For each question provide: topic, question, answer_framework (use the STAR "
        "method — Situation, Task, Action, Result), is_gap_based=true, order_index "
        "(1-based). Weight harder questions toward the most critical missing skills. "
        "Return JSON with a 'questions' array only."
    )
    wrapper = await provider.complete_structured(
        system, json.dumps(resume_content), PrepQuestionsWrapper, model_tier="pro"
    )
    return wrapper.questions


# ── Public entry point ────────────────────────────────────────────────────────

@dataclass
class TailoringResult:
    tailored_content: dict
    matched_skills: list[str]
    missing_skills: list[str]
    ats_score: int
    prep_questions: list[PrepQuestionData]
    company_keywords: list[str]  # company-specific ATS keywords surfaced to the frontend


async def run_tailoring_pipeline(
    resume_content: dict,
    jd_text: str,
    humanize_level: int,
    provider: AIProvider,
    company_name: str | None = None,
) -> TailoringResult:
    """
    Full 4-agent pipeline:

    Agent 0 (fast)  ─── company intel (optional, runs in parallel with Agent 1)
    Agent 1 (fast)  ─── parse JD into structured analysis (enriched by company intel)
         │
         ├── compute_delta (local, no AI) ── matched / missing / ats_score
         │
    Agent 2 (pro)   ─── semantic mapping of JD → resume bullets
         │
         ├── Agent 3 (pro)  ─── precision bullet rewrite    ┐ parallel
         └── prep questions (pro)                           ┘
    """
    # ── Step 1: company intel + JD parse in parallel when company_name given ─
    if company_name and company_name.strip():
        company_intel, jd_analysis_raw = await asyncio.gather(
            _agent0_company_intel(company_name.strip(), provider),
            _agent1_parse_jd(jd_text, provider),  # parse without intel first (fast)
        )
        # Re-run Agent 1 with intel injected (cheap — fast model)
        jd_analysis = await _agent1_parse_jd(jd_text, provider, company_intel)
    else:
        company_intel = None
        jd_analysis = await _agent1_parse_jd(jd_text, provider)

    # Flatten all skills for delta computation
    all_jd_skills: list[str] = []
    seen_lower: set[str] = set()
    for skill in (
        jd_analysis.exact_technical_tools
        + jd_analysis.methodologies_and_frameworks
        + jd_analysis.ats_filter_phrases
    ):
        key = skill.strip().lower()
        if key and key not in seen_lower:
            seen_lower.add(key)
            all_jd_skills.append(skill)

    # ── Step 2: compute match delta locally ──────────────────────────────────
    resume_text = json.dumps(resume_content)
    delta = compute_delta(all_jd_skills, resume_text)

    # ── Step 3: assign bullet IDs, build indexed resume for Agent 2 ──────────
    indexed_resume, _ = _index_bullets(resume_content)

    # ── Step 4: Agent 2 — semantic mapping (pro model) ───────────────────────
    mapping_plan = await _agent2_semantic_map(jd_analysis, indexed_resume, provider)

    # ── Step 5: Agent 3 + prep questions in parallel (both pro model) ────────
    original_skills = resume_content.get("skills", [])

    tailored_raw, questions = await asyncio.gather(
        _agent3_write(mapping_plan, original_skills, humanize_level, provider),
        generate_prep_questions(delta.missing, resume_content, provider),
    )

    # ── Step 6: patch rewritten bullets back into the original structure ──────
    tailored_content = _apply_writer_output(indexed_resume, tailored_raw)

    # Collect all company-specific keywords to surface to the frontend
    company_keywords: list[str] = []
    if company_intel and not company_intel.known_not_found:
        seen_ck: set[str] = set()
        for kw in (
            company_intel.culture_keywords
            + company_intel.tech_stack_preferences
            + company_intel.ats_filter_phrases
            + company_intel.terminology_preferences
        ):
            k = kw.strip()
            if k and k.lower() not in seen_ck:
                seen_ck.add(k.lower())
                company_keywords.append(k)

    return TailoringResult(
        tailored_content=tailored_content,
        matched_skills=delta.matched,
        missing_skills=delta.missing,
        ats_score=delta.ats_score,
        prep_questions=questions,
        company_keywords=company_keywords,
    )


# ── Kept for backward-compatibility (jd router still imports this) ────────────
class ParsedJD(BaseModel):
    required: list[str]
    nice_to_have: list[str]


async def extract_jd_skills(jd_text: str, provider: AIProvider) -> ParsedJD:
    """Legacy single-call JD skill extractor used by the /jd create endpoint."""
    system = (
        "You are an expert technical recruiter. Extract skills from the job description. "
        "Return structured JSON with keys 'required' and 'nice_to_have', each a list of strings."
    )
    return await provider.complete_structured(system, jd_text, ParsedJD, model_tier="fast")

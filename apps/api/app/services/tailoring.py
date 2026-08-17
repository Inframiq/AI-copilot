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
import logging
from copy import deepcopy
from dataclasses import dataclass
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.services.ai_engine.base import AIProvider
from app.services.ats import compute_delta
from app.services.resume_spec import BANNED_GENERIC_PHRASES, HARD_LIMITS
from app.db.models import SkillQuestionBank

logger = logging.getLogger("app")


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


class CoverLetterOutput(BaseModel):
    """Output of the cover-letter writer agent — one prose block including
    a generic salutation and signoff, ready to render or edit as-is."""
    body: str


class PrepQuestionData(BaseModel):
    topic: str
    question: str
    answer_framework: str
    is_gap_based: bool = True
    order_index: int


_TOPIC_VALUES = {"Technical", "Behavioral", "HR & Culture"}


class SkillQuestionData(BaseModel):
    skill: str
    topic: str
    question: str
    answer_framework: str


class SkillQuestionsWrapper(BaseModel):
    questions: list[SkillQuestionData]


class JDQuestionData(BaseModel):
    topic: str
    question: str
    answer_framework: str


class JDQuestionsWrapper(BaseModel):
    questions: list[JDQuestionData]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _strip_json_fence(raw: str) -> str:
    s = raw.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```$", "", s)
    return s.strip()


# Prose almost always opens with a verb describing what the candidate did —
# a real skill name never does. Defense-in-depth against the model ignoring
# the "short noun phrase, not a sentence" instruction in the Agent 2 prompt
# and echoing a bullet/responsibility fragment into the skills list instead.
_SKILL_LEADING_VERBS = re.compile(
    r"^(developed|managed|led|responsible for|worked|helped|created|built|"
    r"implemented|designed|collaborated|utilized|maintained|assisted|drove|"
    r"delivered|coordinated|analyzed|performed|conducted|supported|"
    r"experience (with|in)|proficient (with|in|at)|knowledge of|ability to)\b",
    re.IGNORECASE,
)


def _looks_like_a_skill(s: str) -> bool:
    """Reject prose that slipped past the LLM's own formatting rules — a
    process/responsibility description mistaken for a skill name, not a
    skill itself. Real skill names are short noun phrases; sentences and
    bullet fragments are not."""
    words = s.split()
    if len(words) == 0 or len(words) > 6:
        return False
    if ". " in s or s.count(",") > 1 or ";" in s:
        return False
    if _SKILL_LEADING_VERBS.match(s.strip()):
        return False
    return True


def _sanitize_skill_list(skills: list[str]) -> list[str]:
    result = []
    for s in skills:
        s = re.sub(r"[\x00-\x1f\x7f]", "", s)
        s = s[:200].strip()
        if s and _looks_like_a_skill(s):
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


def _apply_writer_output(
    resume_content: dict,
    writer: WriterOutput,
    mapping_plan: "MappingPlan | None" = None,
) -> dict:
    """Patch rewritten bullets back into resume_content in-place.

    Fallback priority when a bullet_id is absent from writer.rewritten_bullets:
      1. mapping_plan.original_text for that bullet_id (preserves the exact
         original text Agent 2 saw, which is the most reliable source)
      2. bullet["text"] from the indexed resume dict (same value, different path)
    """
    content = deepcopy(resume_content)
    rewrite_map = {r.bullet_id: r.rewritten_text for r in writer.rewritten_bullets}

    # Build a secondary fallback from the mapping plan's original_text
    plan_originals: dict[str, str] = {}
    if mapping_plan:
        for entry in mapping_plan.mapping_plan:
            plan_originals[entry.original_bullet_id] = entry.original_text

    missing_ids: list[str] = []
    for exp in content.get("experience", []):
        patched = []
        for bullet in exp.get("bullets", []):
            if isinstance(bullet, dict):
                bid = bullet.get("bullet_id", "")
                if bid and bid not in rewrite_map:
                    missing_ids.append(bid)
                # Fallback chain: rewrite → mapping plan original → indexed dict text
                text = rewrite_map.get(
                    bid,
                    plan_originals.get(bid, bullet.get("text", ""))
                )
                patched.append(text)
            else:
                patched.append(bullet)
        exp["bullets"] = patched

    if missing_ids:
        logger.warning(
            "Agent 3 omitted %d bullet(s) from rewritten_bullets (original text used): %s",
            len(missing_ids), missing_ids,
        )

    # Skills are NOT modified here — the user selects which suggested skills
    # to add via the UI. Keep original skills unchanged.
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
You are an Executive Resume Strategist and ATS Optimisation Specialist. \
Your job is Semantic ATS Mapping: produce a precise rewrite plan that aligns \
every resume bullet with the Job Description as aggressively as possible.
</system_role>

<rules>
1. FACT LOCK — the only hard constraint: Never invent or alter FACTS. \
Facts are: numbers, percentages, dollar figures, dates, company names, job \
titles, and specific named projects. These must survive unchanged.
   - ALLOWED: changing language, framing, action verbs, terminology, and \
keyword choices as aggressively as the JD requires.
   - FORBIDDEN: fabricating metrics ("reduced latency by 40%"), inventing \
experiences ("led a team of 10"), or claiming tools the candidate never used.
2. METRIC PRESERVATION: Capture every number, percentage, dollar figure, and \
date from the original bullet in preserved_metrics so the writer can echo \
them verbatim.
3. TRANSFORMATION TYPES — always choose the most aggressive option available:
   - REINFORCE: rephrase the bullet using JD-exact terminology and keywords \
while keeping the underlying facts.
   - REFRAME: shift the angle of the bullet to highlight a different JD \
requirement the same work also demonstrates.
   - INJECT: weave in a JD keyword or phrase that the work logically supports, \
even if the original bullet didn't use that exact language.
   - SKIP: the bullet genuinely cannot be connected to any JD requirement \
by any reasonable stretch — use this as rarely as possible. Fewer than 20% \
of bullets should be SKIPped for a typical role.
4. COMPLETE COVERAGE — MANDATORY: mapping_plan MUST contain exactly one entry \
per bullet_id present in original_resume — do not omit any bullet, even \
ones assigned SKIP. A mapping_plan that covers only some bullets is incorrect.
5. plausible_skills_to_add: list ONLY skills that are (a) explicitly mentioned \
in the JD AND (b) directly evidenced by the candidate's existing stack \
(e.g., if they use AWS Lambda and the JD says "serverless", add "Serverless \
Architecture"; if the JD never mentions JavaScript, do not add it just because \
they use React). Limit to at most 15 skills. Do not dump transitive or \
implied skills — only add what the JD is clearly testing for. ORDER MATTERS: \
list them most-important-first — the skill most central to this JD and best \
evidenced by the candidate's work goes first, the most marginal goes last. \
The frontend offers the user a "top 15" quick-add drawn from list order, so a \
skill's position is a real signal of priority, not incidental.
   - SHAPE: every entry must be a short skill name or tool/technology/\
methodology name — 1 to 4 words, no verbs, no punctuation, never a sentence \
or a paraphrase of a responsibility. "Kubernetes", "Stakeholder Management", \
"Serverless Architecture" are valid; "Managed a team of engineers to deliver \
projects on time" or "Experience with cloud infrastructure and deployment \
processes" are NOT skills and must never appear here — that is bullet-level \
narrative, not a skill.
6. PRIORITY SKILLS OVERRIDE: if priority_skills_from_user (in the payload) is \
non-empty, the user has explicitly confirmed they have every skill listed there \
and wants it highlighted — always include all of them in plausible_skills_to_add \
verbatim, bypassing the evidence filter in rule 5 for these specific skills only \
(they do not count toward the 15-skill cap in rule 5). Additionally, for any \
bullet whose work could plausibly demonstrate a priority skill, prefer INJECT to \
weave it in naturally — but never fabricate metrics or experience just to force \
the connection; it's fine for a priority skill to surface only in \
plausible_skills_to_add if no bullet fits.
7. Output ONLY valid JSON matching the schema. No markdown, no preamble.
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
    priority_skills: list[str] | None = None,
) -> MappingPlan:
    payload = {
        "jd_analysis": jd_analysis.model_dump(),
        "original_resume": indexed_resume,
        "priority_skills_from_user": priority_skills or [],
    }
    # "premium" (not "pro") deliberately — this is the one call in the
    # pipeline that gets OpenAIProvider's pricier model. See the tier
    # decision recorded on OpenAIProvider._model_for.
    return await provider.complete_structured(
        _AGENT2_SYSTEM, json.dumps(payload), MappingPlan, model_tier="premium"
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

    bullet_words = HARD_LIMITS["bullet_words"]
    banned = ", ".join(f'"{p}"' for p in BANNED_GENERIC_PHRASES)

    return f"""\
<system_role>
You are an elite technical resume writer executing a precise, data-driven \
rewrite plan. Every change you make is authorised by the mapping_plan below. \
You do not improvise beyond those instructions.
</system_role>

<rules>
1. EXECUTE THE PLAN EXACTLY: For each bullet_id in the mapping_plan, apply \
the strategic_instruction and inject the target_jd_keywords_to_inject using \
the exact phrasing provided. Be aggressive with language — your job is to \
make the bullet sound like it was written for this JD.
2. FACT LOCK — NEVER FABRICATE: Every value in preserved_metrics must appear \
verbatim in your rewritten bullet. Do not add, round, estimate, or omit any \
metric. Do not invent a percentage, dollar figure, user count, team size, \
tool, technology, responsibility, or outcome that is not already present in \
original_text or preserved_metrics. If the original bullet has no metric, \
your rewrite must not gain one. Language and framing are yours to change \
freely; facts are not.
3. BULLET STRUCTURE: Start every bullet with a strong past-tense action verb \
(e.g., Architected, Spearheaded, Engineered, Reduced, Drove). \
Format: [Action Verb] + [Method/Tool with JD keyword] + [Quantified Impact].
4. LENGTH — CONCISE, NOT COMPREHENSIVE: Target {bullet_words["prefer_min"]}-\
{bullet_words["prefer_max"]} words per bullet. {bullet_words["max"]} words is \
the absolute hard maximum — a bullet that runs long must be cut, not wrapped. \
Say less, more precisely; do not pad a short accomplishment with filler to \
sound more substantial.
5. BANNED WORDING: Never use these generic filler words/phrases unless the \
original bullet already uses one verbatim and removing it would lose meaning: \
{banned}. These read as vague résumé cliché, not evidence.
6. SKIP BULLETS: If strategic_instruction is "SKIP", copy the original_text \
unchanged into rewritten_text — but you MUST still include it in \
rewritten_bullets with its bullet_id.
7. COMPLETE COVERAGE — FATAL IF VIOLATED: Before producing your final JSON, \
mentally count the bullet_ids in mapping_plan. rewritten_bullets MUST contain \
EXACTLY that many entries — one per bullet_id, with no omissions and no \
duplicates. If even a single bullet_id is missing, the entire response is \
wrong and will cause the candidate's resume to be partially unchanged. A \
response that rewrites only some bullets while silently dropping others means \
the candidate sees only their skills list update and nothing else — this is \
the most common failure mode and it is unacceptable. (This rule governs which \
bullets you must respond to, not how many the candidate's resume should have — \
bullet-count selection happens upstream, before you ever see this plan.)
8. SKILLS: updated_skills must be EXACTLY the same list as original_skills — \
do not add or remove any skills. Skill additions are chosen by the user \
separately; your job is only to rewrite bullets.
9. TONE: {tone}
10. Output ONLY valid JSON matching the schema. No markdown, no preamble.
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


# ── Cover letter writer ────────────────────────────────────────────────────

def _build_cover_letter_system(humanize_level: int) -> str:
    if humanize_level < 30:
        tone = "Write in warm, natural prose — a real person's voice, not a template."
    elif humanize_level > 70:
        tone = "Front-load JD keywords and technical terms; prioritise ATS scanability over flow."
    else:
        tone = "Balance a natural, confident voice with the JD's key terminology."

    return f"""\
<system_role>
You are an expert cover letter writer. Given a job description's analysis \
and a candidate's resume, write a complete, ready-to-send cover letter body.
</system_role>

<rules>
1. FACT LOCK — NEVER FABRICATE: Only reference companies, titles, tools, and \
achievements that literally appear in resume_content. Never invent a hiring \
manager's name, a specific company address, an achievement, or a metric not \
already present in resume_content.
2. STRUCTURE: "Dear Hiring Manager," on its own line, then one opening \
paragraph naming the target role and company (target_role, company_name), \
one to two body paragraphs connecting 2-3 specific resume achievements to \
jd_analysis's themes/tools/skills (prioritise matched_skills — these are \
already confirmed to overlap with the JD), one closing paragraph expressing \
interest and inviting next steps, then "Sincerely," on its own line followed \
by the candidate's real name from resume_content.contact.name.
3. LENGTH: 250-400 words total, excluding the salutation and signoff lines.
4. TONE: {tone}
5. Output ONLY valid JSON matching the schema. No markdown, no preamble.
</rules>

<output_schema>
{{
  "body": "string — the full letter text, salutation through signoff, separated by blank lines between paragraphs"
}}
</output_schema>"""


async def write_cover_letter(
    resume_content: dict,
    jd_analysis: JDAnalysis,
    matched_skills: list[str],
    jd_title: str,
    company_name: str | None,
    humanize_level: int,
    provider: AIProvider,
) -> CoverLetterOutput:
    payload = {
        "target_role": jd_title,
        "company_name": company_name or "the company",
        "jd_analysis": jd_analysis.model_dump(),
        "matched_skills": _sanitize_skill_list(matched_skills),
        "resume_content": resume_content,
    }
    return await provider.complete_structured(
        _build_cover_letter_system(humanize_level),
        json.dumps(payload),
        CoverLetterOutput,
        model_tier="pro",
    )


# ── Prep questions (runs in parallel with Agent 3) ────────────────────────────

async def _generate_questions_for_skills(
    skills: list[str], resume_content: dict, provider: AIProvider
) -> list[SkillQuestionData]:
    """LLM call scoped to skills with no cached bank entry yet — never called
    for a skill get_or_generate_prep_questions already found in the cache."""
    system = (
        "You are an expert interview coach. For EACH of the following skills a "
        f"candidate is missing, generate exactly 2 targeted interview questions: {skills}. "
        "For each question provide: skill (must exactly match one of the input skills, "
        "verbatim), topic (exactly one of \"Technical\", \"Behavioral\", \"HR & Culture\"), "
        "question, answer_framework (use the STAR method — Situation, Task, Action, Result). "
        "These questions will be reused for other candidates missing the same skill, so keep "
        "them skill-focused rather than referencing this specific candidate's resume. "
        "Return JSON with a 'questions' array only."
    )
    wrapper = await provider.complete_structured(
        system, json.dumps(resume_content), SkillQuestionsWrapper, model_tier="pro"
    )
    return wrapper.questions


async def _generate_jd_specific_questions(
    jd_analysis: "JDAnalysis", company_name: str | None, resume_content: dict, provider: AIProvider
) -> list[JDQuestionData]:
    """LLM call anchored to this specific JD's parsed themes/seniority/company —
    unlike _generate_questions_for_skills, these are never cached or reused
    across users, since they're tied to this exact role rather than a bare
    skill name. Deliberately small (3 questions) and additive: the bulk of
    prep questions still come from the cheap, cached skill bank."""
    at_company = f" at {company_name.strip()}" if company_name and company_name.strip() else ""
    system = (
        f"You are an expert interview coach preparing a candidate for a specific role{at_company}. "
        "Based on this job's parsed requirements — "
        f"technical tools: {jd_analysis.exact_technical_tools}, "
        f"methodologies/frameworks: {jd_analysis.methodologies_and_frameworks}, "
        f"domain expertise themes: {jd_analysis.domain_expertise_themes}, "
        f"seniority indicators: {jd_analysis.seniority_indicators} — "
        "generate exactly 3 interview questions that probe this specific role's domain and "
        "seniority level, not generic skill trivia any candidate for any job could be asked. "
        "For each provide: topic (exactly one of \"Technical\", \"Behavioral\", \"HR & Culture\"), "
        "question, answer_framework (use the STAR method — Situation, Task, Action, Result). "
        "Return JSON with a 'questions' array only."
    )
    wrapper = await provider.complete_structured(
        system, json.dumps(resume_content), JDQuestionsWrapper, model_tier="pro"
    )
    return wrapper.questions


async def get_or_generate_prep_questions(
    missing_skills: list[str],
    resume_content: dict,
    provider: AIProvider,
    db: AsyncSession,
    jd_analysis: "JDAnalysis | None" = None,
    company_name: str | None = None,
) -> list[PrepQuestionData]:
    """Cache-aside prep-question lookup: reuses bank rows for skills already
    seen (from any prior user's tailoring run), and only calls the LLM for
    skills genuinely new to the bank — same pattern as the jd.parsed["agent1"]
    cache in routers/ai.py, applied to prep questions instead of JD parsing.

    When jd_analysis is given, also generates a few fresh, uncached questions
    anchored to this specific JD's domain/seniority/company (see
    _generate_jd_specific_questions) and places them first — the skill-bank
    questions alone are deliberately generic and shared across users, so on
    their own they don't feel tied to the JD being targeted.
    """
    safe_missing = _sanitize_skill_list(missing_skills)
    normalized: list[tuple[str, str]] = []
    seen_keys: set[str] = set()
    for s in safe_missing:
        key = s.strip().lower()
        if key and key not in seen_keys:
            seen_keys.add(key)
            normalized.append((key, s.strip()))
    if not normalized:
        return []

    keys = [key for key, _ in normalized]
    cached_rows = (
        await db.execute(
            select(SkillQuestionBank)
            .where(SkillQuestionBank.skill.in_(keys))
            .order_by(SkillQuestionBank.skill, SkillQuestionBank.created_at)
        )
    ).scalars().all()
    covered_keys = {row.skill for row in cached_rows}
    uncovered_display = [display for key, display in normalized if key not in covered_keys]
    uncovered_keys = {key for key, display in normalized if display in uncovered_display}

    new_rows: list[SkillQuestionBank] = []
    if uncovered_display:
        generated = await _generate_questions_for_skills(uncovered_display, resume_content, provider)
        for q in generated:
            key = q.skill.strip().lower()
            if key not in uncovered_keys:
                continue  # LLM echoed a skill we never asked about (or one already
                # cached) — drop it, don't cache garbage or duplicate a covered skill.
            topic = q.topic if q.topic in _TOPIC_VALUES else "Technical"
            row = SkillQuestionBank(
                skill=key, topic=topic, question=q.question, answer_framework=q.answer_framework
            )
            db.add(row)
            new_rows.append(row)
        if new_rows:
            await db.commit()

    # Round-robin across skills (at most 2 questions per skill) so a user
    # missing many skills gets breadth across all of them, not every question
    # for the first few skills encountered. `all_rows`' input order is
    # deterministic (cached_rows ordered by skill/created_at above, new_rows
    # generated in normalized/uncovered_display order), so this selection is
    # reproducible for identical cached input.
    by_skill: dict[str, list[SkillQuestionBank]] = {}
    order: list[str] = []
    for row in list(cached_rows) + new_rows:
        if row.skill not in by_skill:
            by_skill[row.skill] = []
            order.append(row.skill)
        by_skill[row.skill].append(row)

    # Capped at 7 (not 10) now that up to 3 JD-specific questions are
    # prepended below, keeping the total around the same as before.
    selected: list[SkillQuestionBank] = []
    round_idx = 0
    while len(selected) < 7 and round_idx < 2:
        for skill in order:
            if len(selected) >= 7:
                break
            bucket = by_skill[skill]
            if round_idx < len(bucket):
                selected.append(bucket[round_idx])
        round_idx += 1

    jd_specific: list[JDQuestionData] = []
    if jd_analysis is not None:
        jd_specific = await _generate_jd_specific_questions(
            jd_analysis, company_name, resume_content, provider
        )

    result: list[PrepQuestionData] = [
        PrepQuestionData(
            topic=q.topic if q.topic in _TOPIC_VALUES else "Technical",
            question=q.question,
            answer_framework=q.answer_framework,
            is_gap_based=False,
            order_index=i + 1,
        )
        for i, q in enumerate(jd_specific)
    ]
    offset = len(result)
    result += [
        PrepQuestionData(
            topic=row.topic,
            question=row.question,
            answer_framework=row.answer_framework,
            is_gap_based=True,
            order_index=offset + i + 1,
        )
        for i, row in enumerate(selected)
    ]
    return result


# ── Public entry points ───────────────────────────────────────────────────────

@dataclass
class JDMatchAnalysis:
    """Result of the cheap, read-only analyze step — no resume mutation."""
    jd_analysis: JDAnalysis
    matched_skills: list[str]
    missing_skills: list[str]
    ats_score: int
    company_keywords: list[str]  # company-specific ATS keywords surfaced to the frontend


@dataclass
class TailoringResult:
    tailored_content: dict
    matched_skills: list[str]
    missing_skills: list[str]
    ats_score: int
    prep_questions: list[PrepQuestionData]
    company_keywords: list[str]  # company-specific ATS keywords surfaced to the frontend
    suggested_skills: list[str]  # skills Agent 2 suggests adding — user opts in via UI


async def analyze_jd_match(
    resume_content: dict,
    jd_text: str,
    provider: AIProvider,
    company_name: str | None = None,
    cached_jd_analysis: "JDAnalysis | None" = None,
) -> JDMatchAnalysis:
    """
    Agent 0 (fast)  ─── company intel (optional)
    Agent 1 (fast)  ─── parse JD into structured analysis (enriched by company intel)
         │
         └── compute_delta (local, no AI) ── matched / missing / ats_score

    This is the "Analyze Description" step — read-only, doesn't touch the
    resume. run_tailoring_pipeline (the "Tailor Resume" step) continues on
    from here into the resume-rewriting agents.

    cached_jd_analysis — pass a previously stored JDAnalysis (no-company-name
    variant) to skip Agent 1 entirely.  The caller is responsible for only
    passing this when company_name is absent, since company intel changes the
    Agent 1 output.
    """
    if cached_jd_analysis:
        # Use the pre-computed JD analysis — deterministic, no LLM call.
        company_intel = None
        jd_analysis = cached_jd_analysis
    elif company_name and company_name.strip():
        company_intel = await _agent0_company_intel(company_name.strip(), provider)
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

    delta = compute_delta(all_jd_skills, resume_content)

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

    return JDMatchAnalysis(
        jd_analysis=jd_analysis,
        matched_skills=delta.matched,
        missing_skills=delta.missing,
        ats_score=delta.ats_score,
        company_keywords=company_keywords,
    )


async def run_tailoring_pipeline(
    resume_content: dict,
    jd_text: str,
    humanize_level: int,
    provider: AIProvider,
    db: AsyncSession,
    company_name: str | None = None,
    priority_skills: list[str] | None = None,
    cached_jd_analysis: "JDAnalysis | None" = None,
) -> TailoringResult:
    """
    Full pipeline — the "Tailor Resume" step. Re-runs analyze_jd_match (cheap,
    fast-model calls) and continues into the resume-rewriting agents:

    Agent 2 (pro)   ─── semantic mapping of JD → resume bullets
         │
         ├── Agent 3 (pro)  ─── precision bullet rewrite    ┐ parallel
         └── prep questions (pro)                           ┘

    priority_skills — keywords the user explicitly picked (e.g. from the JD
    Analyzer's "Not Matched" list) that they want the tailoring to prioritize.
    Passed to Agent 2 as a hint to weave them into bullets where plausible;
    guaranteed to appear in the returned suggested_skills regardless of
    whether Agent 2's prompt-following holds, via the merge below.

    cached_jd_analysis — pass a pre-computed JDAnalysis (no company-name
    variant) to skip Agent 1 and get a consistent skill list / ATS score.
    """
    analysis = await analyze_jd_match(
        resume_content, jd_text, provider, company_name,
        cached_jd_analysis=cached_jd_analysis,
    )

    # ── assign bullet IDs, build indexed resume for Agent 2 ──────────────────
    indexed_resume, _ = _index_bullets(resume_content)

    # ── Agent 2 — semantic mapping (pro model) ────────────────────────────────
    mapping_plan = await _agent2_semantic_map(
        analysis.jd_analysis, indexed_resume, provider, priority_skills=priority_skills,
    )

    # ── Agent 3 + prep questions in parallel (both pro model) ────────────────
    # return_exceptions=True so a prep-questions failure (e.g. the model's
    # structured-output JSON gets truncated for a long missing-skills list)
    # can't discard an otherwise-successful bullet rewrite — prep questions
    # are a bonus feature; the tailored resume itself is the point of this
    # call and must not be thrown away because a secondary call flaked.
    original_skills = resume_content.get("skills", [])

    tailored_raw, questions_result = await asyncio.gather(
        _agent3_write(mapping_plan, original_skills, humanize_level, provider),
        get_or_generate_prep_questions(
            analysis.missing_skills, resume_content, provider, db,
            jd_analysis=analysis.jd_analysis, company_name=company_name,
        ),
        return_exceptions=True,
    )
    if isinstance(tailored_raw, BaseException):
        raise tailored_raw
    if isinstance(questions_result, BaseException):
        logger.exception(
            "Prep-question generation failed — continuing tailoring without prep questions",
            exc_info=questions_result,
        )
        questions: list[PrepQuestionData] = []
    else:
        questions = questions_result

    # ── patch rewritten bullets back into the original structure ─────────────
    tailored_content = _apply_writer_output(indexed_resume, tailored_raw, mapping_plan)

    # ── merge in the user's priority skills — a code-level guarantee, not
    #    just a prompt instruction, that they show up for review ─────────────
    suggested = _sanitize_skill_list(mapping_plan.plausible_skills_to_add)
    if priority_skills:
        seen_lower = {s.lower() for s in suggested}
        for skill in _sanitize_skill_list(priority_skills):
            if skill.lower() not in seen_lower:
                suggested.append(skill)
                seen_lower.add(skill.lower())

    return TailoringResult(
        tailored_content=tailored_content,
        matched_skills=analysis.matched_skills,
        missing_skills=analysis.missing_skills,
        ats_score=analysis.ats_score,
        prep_questions=questions,
        company_keywords=analysis.company_keywords,
        suggested_skills=suggested,
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

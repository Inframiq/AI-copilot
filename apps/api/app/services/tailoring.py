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
from dataclasses import dataclass, field
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.services.ai_engine.base import AIProvider
from app.services.ats import (
    compute_delta, blend_scores, build_resume_text, title_match_verdict,
    default_importance, score_content, AtsFix, fix_slug, estimate_fix_delta,
)
from app.services.resume_spec import BANNED_GENERIC_PHRASES, HARD_LIMITS
from app.db.models import SkillQuestionBank

logger = logging.getLogger("app")

# Per-call output-token ceilings, replacing the single blanket
# OPENAI_MAX_OUTPUT_TOKENS cap every call used before. Agent 2 and Agent 3
# emit one JSON entry per resume bullet, so their legitimate output scales
# with resume size (a full rewrite can need 8k-16k tokens — this is the
# proven-safe cap from GeminiProvider's Agent 3 comment) and both keep the
# full ceiling. Every other call here has a small, roughly fixed-shape
# output (a handful of keyword lists, a few questions, one short letter);
# giving those the same 16384-token ceiling only gives gpt-5.6-luna (a
# reasoning model, whose invisible reasoning tokens share this same budget
# and are billed the same as visible output) unnecessary headroom to reason
# longer than the task needs, with no quality upside. Each cap below still
# carries a wide safety margin over the realistic max output so this does
# not reintroduce the 4096-was-too-low truncation bug — see
# docs/ai-pipeline.md.
_MAX_TOKENS_COMPANY_INTEL = 3000
_MAX_TOKENS_JD_PARSE = 3000
_MAX_TOKENS_SEMANTIC_MAP = 16384
_MAX_TOKENS_BULLET_WRITE = 16384
_MAX_TOKENS_COVER_LETTER = 3000
_MAX_TOKENS_SEMANTIC_VERIFY = 4000
_MAX_TOKENS_PREP_SKILL_QUESTIONS = 8000
_MAX_TOKENS_PREP_INTERVIEW_QUESTIONS = 6000


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
    core_responsibilities: list[str] = []  # the JD's actual duty lines — scope of work, not tools/themes
    target_job_titles: list[str] = []  # the role title(s) this JD is hiring for
    nice_to_have_skills: list[str] = []  # skills the JD frames as preferred / "a plus", not required
    importance: dict[str, str] = {}  # {term_lowercased: "high"|"medium"|"low"}; "job title" key for the title signal


class BulletMapping(BaseModel):
    """One entry in the mapping plan produced by Agent 2.

    reasoning and jd_responsibility_addressed are declared first so the
    Responses API's field-by-field generation order forces the model to
    reason about fact-lock/responsibility/genericness before it commits to
    the rest of the entry — see the schema-reinforcement note on
    _AGENT2_SYSTEM.
    """
    reasoning: str = ""
    jd_responsibility_addressed: str = ""
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
    """reasoning is declared first — same schema-order technique as
    BulletMapping above, applied to Agent 3's final text generation."""
    reasoning: str = ""
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
    source: str = "requirement"
    basis: str = ""
    order_index: int


_TOPIC_VALUES = {"Technical", "Behavioral", "HR & Culture"}


class SkillQuestionData(BaseModel):
    skill: str
    topic: str
    question: str
    answer_framework: str


class SkillQuestionsWrapper(BaseModel):
    questions: list[SkillQuestionData]


class InterviewQuestionData(BaseModel):
    """One question from the redesigned per-JD/per-resume prep generator —
    see _agent4_generate_interview_questions. source distinguishes which
    of the three required categories this question came from; basis names
    the specific responsibility/skill/resume detail it's grounded in, so
    the UI can show *why* this question was asked, not just that it was."""
    source: str  # "requirement" | "overlap" | "gap"
    basis: str
    topic: str
    question: str
    answer_framework: str


class InterviewQuestionsWrapper(BaseModel):
    questions: list[InterviewQuestionData]


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
        max_output_tokens=_MAX_TOKENS_COMPANY_INTEL,
        call_name="agent0_company_intel",
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
6. core_responsibilities: extract the JD's actual stated duties — usually under \
a "Responsibilities" / "What you'll do" / "Day-to-day" heading — as concise \
phrases describing scope of work (e.g., "own end-to-end delivery of the \
checkout pipeline", "partner with product on roadmap prioritisation", \
"mentor junior engineers on system design"). This is distinct from \
domain_expertise_themes (broad thematic areas like "distributed systems") and \
methodologies_and_frameworks (named processes/tools like "Agile" or "CI/CD") — \
it captures WHAT the role actually does day to day, not what topics or tools it \
touches. The resume mapper uses this to connect a candidate's real work to a \
specific duty, not just graft on a keyword.
7. target_job_titles: the job title(s) this posting is hiring for — the \
posting's own title plus any explicit equivalents it names \
(e.g. ["Senior Data Analyst", "Analytics Engineer"]). 1–3 entries. Use the \
literal title as written; do not invent a seniority level the JD doesn't state.
8. nice_to_have_skills: skills/tools the JD explicitly frames as preferred, \
desired, "bonus", "a plus", or "nice to have" rather than required. Put such \
skills ONLY here — never also in exact_technical_tools, \
methodologies_and_frameworks, or ats_filter_phrases.
9. importance: rate EVERY term you put in exact_technical_tools, \
methodologies_and_frameworks, ats_filter_phrases, nice_to_have_skills and \
core_responsibilities, plus a "job title" key, as "high" / "medium" / "low" \
for THIS role. high = defines the role, a stated hard requirement, or \
repeated/emphasised; medium = a normal requirement or day-to-day duty; \
low = "nice to have", peripheral, or generic. Keys are the term verbatim \
(lowercased); "job title" rates how much the posting hinges on title match.
10. Output ONLY valid JSON matching the schema. No markdown, no preamble.
</rules>

<output_schema>
{
  "exact_technical_tools": ["string"],
  "methodologies_and_frameworks": ["string"],
  "domain_expertise_themes": ["string"],
  "seniority_indicators": ["string"],
  "ats_filter_phrases": ["string"],
  "core_responsibilities": ["string"],
  "target_job_titles": ["string"],
  "nice_to_have_skills": ["string"],
  "importance": {"term": "high|medium|low"}
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
    result = await provider.complete_structured(
        _AGENT1_SYSTEM, user_msg, JDAnalysis, model_tier="fast",
        max_output_tokens=_MAX_TOKENS_JD_PARSE, call_name="agent1_parse_jd",
    )
    return _backfill_importance(result)


def _backfill_importance(jd: JDAnalysis) -> JDAnalysis:
    """Guarantee every extracted term (and "job title") has an importance,
    filling gaps from the deterministic bucket rule."""
    given = {k.strip().lower(): v for k, v in (jd.importance or {}).items()
             if v in ("high", "medium", "low")}
    titles = jd.target_job_titles or []
    hard = jd.exact_technical_tools or []
    mediums = (jd.methodologies_and_frameworks or []) + (jd.ats_filter_phrases or []) \
        + (jd.core_responsibilities or [])
    nice = jd.nice_to_have_skills or []
    terms = ["job title"] + titles + hard + mediums + nice
    filled = dict(given)
    for term in terms:
        key = term.strip().lower()
        if key and key not in filled:
            filled[key] = default_importance(
                term, titles=titles, hard_tools=hard, mediums=mediums, nice=nice,
            )
    jd.importance = filled
    return jd


# ── Semantic presence verifier ──────────────────────────────────────────────
# The lexical matcher in ats.compute_delta only recognises a JD phrase when the
# resume contains it near-verbatim.  A resume that demonstrates "revenue
# forecasting" by saying "forecasted quarterly revenue", or "CI/CD" by saying
# "continuous integration", scores those as missing.  This pass hands the
# lexically-unmatched phrases to a fast model and asks whether the resume shows
# evidence of each — paraphrase, synonym, or abbreviation included.

_VALID_VERDICTS = {"matched", "partial", "missing"}


class SemanticVerdict(BaseModel):
    phrase: str
    verdict: str  # "matched" | "partial" | "missing"
    evidence: str = ""  # short quote from the resume, for debugging / future UI


class SemanticMatchResult(BaseModel):
    verdicts: list[SemanticVerdict]


_SEMANTIC_VERIFY_SYSTEM = """\
<system_role>
You are an ATS resume evaluator. For each job-description phrase you are given, \
decide whether the RESUME TEXT provides evidence the candidate has done or knows \
that thing — even when the wording differs.
</system_role>

<rules>
1. Judge meaning, not string overlap. "forecasted quarterly revenue" IS evidence \
of "revenue forecasting"; "continuous integration pipeline" IS evidence of \
"CI/CD"; "led a squad of 6 engineers" IS evidence of "team leadership". \
Recognise synonyms, abbreviations (K8s = Kubernetes, ML = machine learning), \
and paraphrases.
2. verdict values:
   - "matched"  — the resume clearly demonstrates this phrase.
   - "partial"  — the resume touches the same area but does not clearly \
demonstrate it (adjacent tooling, a one-off mention, a related but weaker claim).
   - "missing"  — no meaningful evidence.
3. Do NOT invent evidence. If you are not sure, use "partial" or "missing".
4. evidence: a short verbatim fragment from the resume that justifies a \
"matched"/"partial" verdict, or "" for "missing".
5. Return exactly one verdict per input phrase, using the phrase text verbatim.
6. Output ONLY valid JSON matching the schema. No markdown, no preamble.
</rules>

<output_schema>
{"verdicts": [{"phrase": "string", "verdict": "matched|partial|missing", "evidence": "string"}]}
</output_schema>"""


async def _verify_semantic_presence(
    phrases: list[str], resume_text: str, provider: AIProvider
) -> dict[str, str]:
    """Return {phrase_lowercased: "matched"|"partial"|"missing"} for *phrases*.

    Never raises: any provider failure or malformed response yields {}, which
    leaves the caller on the pure lexical result.
    """
    phrases = [p.strip() for p in phrases if p and p.strip()]
    if not phrases:
        return {}

    user_msg = json.dumps({"resume_text": resume_text, "jd_phrases": phrases})
    try:
        result = await provider.complete_structured(
            _SEMANTIC_VERIFY_SYSTEM, user_msg, SemanticMatchResult,
            model_tier="fast", max_output_tokens=_MAX_TOKENS_SEMANTIC_VERIFY,
            call_name="verify_semantic_presence",
        )
        raw_verdicts = list(result.verdicts)
    except Exception:
        logger.warning("semantic presence verification failed", exc_info=True)
        return {}

    out: dict[str, str] = {}
    for v in raw_verdicts:
        verdict = str(getattr(v, "verdict", "")).strip().lower()
        phrase = str(getattr(v, "phrase", "")).strip().lower()
        if phrase:
            out[phrase] = verdict if verdict in _VALID_VERDICTS else "missing"
    return out


# ── Gap Filler: propose bullets + a headline for post-tailor gaps ─────────────

_MAX_TOKENS_GAP_FILL = 4000


class GapFillBullet(BaseModel):
    gap: str
    grounded: bool
    experience_index: int | None = None
    bullet_text: str


class GapFillerOutput(BaseModel):
    bullets: list[GapFillBullet] = []
    headline: str = ""


_GAP_FILLER_SYSTEM = """\
<system_role>
You help a candidate close specific gaps between their (already tailored) \
résumé and a job description. For each gap you are given, propose ONE résumé \
bullet that would close it.
</system_role>

<rules>
1. If the résumé already shows related experience, reframe the CLOSEST real \
experience into a bullet that names the gap explicitly — set grounded=true and \
experience_index to that entry's index.
2. If there is no basis in the résumé, write one plausible bullet for the \
role, set grounded=false and experience_index=null. The user will only keep it \
if it is actually true of them.
3. Never invent numbers, employers, dates, or tools the résumé doesn't support. \
A grounded bullet keeps the original metrics; a speculative bullet has none.
4. If a gap has kind "title", and only then, also return a `headline` string: \
a concise professional headline aligning the candidate to the target title \
(e.g. "Senior Data Analyst | Analytics Engineering"). Otherwise headline "".
5. One bullet per gap, in the same order. Output ONLY valid JSON matching the \
schema.
</rules>

<output_schema>
{"bullets": [{"gap": "string", "grounded": true, "experience_index": 0, "bullet_text": "string"}], "headline": "string"}
</output_schema>"""


async def _agent_gap_filler(
    tailored_content: dict,
    jd_analysis: JDAnalysis,
    gaps: list[dict],
    provider: AIProvider,
) -> GapFillerOutput:
    if not gaps:
        return GapFillerOutput()
    payload = json.dumps({
        "resume": tailored_content,
        "jd_themes": {
            "tools": jd_analysis.exact_technical_tools,
            "methodologies": jd_analysis.methodologies_and_frameworks,
            "responsibilities": jd_analysis.core_responsibilities,
            "target_job_titles": jd_analysis.target_job_titles,
        },
        "gaps": gaps,
    })
    try:
        return await provider.complete_structured(
            _GAP_FILLER_SYSTEM, payload, GapFillerOutput,
            model_tier="fast", max_output_tokens=_MAX_TOKENS_GAP_FILL,
            call_name="agent_gap_filler",
        )
    except Exception:
        logger.warning("gap filler failed", exc_info=True)
        return GapFillerOutput()


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
3. RESPONSIBILITY-FIRST REASONING — do this BEFORE picking a transformation \
type: for each bullet, use reasoning to briefly work out which (if any) of \
jd_analysis.core_responsibilities the bullet's underlying work actually \
evidences, and name that responsibility verbatim in \
jd_responsibility_addressed (leave it an empty string if none plausibly \
applies — do not force one). A transformation exists to make the bullet \
demonstrate that responsibility; it is not a search-and-replace for keywords. \
If you can't articulate which responsibility a bullet serves, that is a signal \
to REINFORCE lightly or SKIP, not to INJECT keywords onto it anyway.
4. TRANSFORMATION TYPES — choose based on rule 3's responsibility analysis, \
always the most aggressive option available that's still honest about what the \
bullet demonstrates:
   - REINFORCE: rephrase the bullet using JD-exact terminology and keywords \
while keeping the underlying facts.
   - REFRAME: shift the angle of the bullet to highlight a different JD \
requirement the same work also demonstrates.
   - INJECT: weave in a JD keyword or phrase that the work logically supports, \
even if the original bullet didn't use that exact language. Do not inject the \
same target keyword into more than 2-3 bullets across the whole mapping_plan \
unless the JD itself repeats that exact phrase 3+ times — spread distinct \
keywords across distinct bullets. Concentrating one phrase into every bullet \
outpaces the JD's own frequency, which real ATS scoring penalizes as gamed \
and reads that way to a human reviewer too.
   - SKIP: the bullet genuinely cannot be connected to any JD requirement \
by any reasonable stretch — use this as rarely as possible. Fewer than 20% \
of bullets should be SKIPped for a typical role.
5. SPECIFICITY OVER JD-MIRRORING: never let responsibility-matching or \
keyword injection make a bullet MORE generic or interchangeable than the \
original. A bullet that loses the original's concrete specifics (the actual \
tool, system, team, scale, or named project) to sound more like the JD is a \
failure, even if it now "matches" better — a resume full of bullets that could \
belong to any candidate is worse than one that matches the JD 20% less but \
still sounds like a specific person's real work. When the two goals conflict, \
specificity wins.
6. COMPLETE COVERAGE — MANDATORY: mapping_plan MUST contain exactly one entry \
per bullet_id present in original_resume — do not omit any bullet, even \
ones assigned SKIP. A mapping_plan that covers only some bullets is incorrect.
7. plausible_skills_to_add: list ONLY skills that are (a) explicitly mentioned \
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
8. PRIORITY SKILLS OVERRIDE: if priority_skills_from_user (in the payload) is \
non-empty, the user has explicitly confirmed they have every skill listed there \
and wants it highlighted — always include all of them in plausible_skills_to_add \
verbatim, bypassing the evidence filter in rule 7 for these specific skills only \
(they do not count toward the 15-skill cap in rule 7). Additionally, for any \
bullet whose work could plausibly demonstrate a priority skill, prefer INJECT to \
weave it in naturally — but never fabricate metrics or experience just to force \
the connection; it's fine for a priority skill to surface only in \
plausible_skills_to_add if no bullet fits.
9. Output ONLY valid JSON matching the schema. No markdown, no preamble.
</rules>

<output_schema>
{
  "mapping_plan": [
    {
      "reasoning": "string — brief: which core_responsibility (if any) this bullet evidences, and why this transformation type follows from that",
      "jd_responsibility_addressed": "string — the specific core_responsibility this bullet demonstrates, verbatim from jd_analysis.core_responsibilities, or empty string if none plausibly applies",
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
        _AGENT2_SYSTEM, json.dumps(payload), MappingPlan, model_tier="premium",
        max_output_tokens=_MAX_TOKENS_SEMANTIC_MAP, call_name="agent2_semantic_map",
    )


# ── Agent 3: Precision Writer ─────────────────────────────────────────────────

def _build_agent3_system(humanize_level: int, seniority_indicators: list[str] | None = None) -> str:
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
    seniority_block = (
        json.dumps(seniority_indicators) if seniority_indicators else "(none extracted for this JD)"
    )

    return f"""\
<system_role>
You are an elite technical resume writer executing a precise, data-driven \
rewrite plan. Every change you make is authorised by the mapping_plan below. \
You do not improvise beyond those instructions.
</system_role>

<rules>
1. EXECUTE THE PLAN: For each bullet_id in the mapping_plan, use \
jd_responsibility_addressed and reasoning to understand WHY this bullet is \
being transformed, then apply strategic_instruction and weave in \
target_jd_keywords_to_inject using the exact phrasing provided. Keyword \
injection is a byproduct of demonstrating jd_responsibility_addressed, not \
the goal itself — a reader must be able to see the bullet evidences that \
responsibility, not just that it contains the term. Be aggressive with \
language — your job is to make the bullet sound like it was written for this \
JD, without losing what makes it a specific, real accomplishment (rule 3).
2. FACT LOCK — NEVER FABRICATE: Every value in preserved_metrics must appear \
verbatim in your rewritten bullet. Do not add, round, estimate, or omit any \
metric. Do not invent a percentage, dollar figure, user count, team size, \
tool, technology, responsibility, or outcome that is not already present in \
original_text or preserved_metrics. If the original bullet has no metric, \
your rewrite must not gain one. Language and framing are yours to change \
freely; facts are not.
3. PRESERVE SPECIFICS — LAST LINE OF DEFENSE AGAINST GENERIC BULLETS: the \
original bullet's concrete specifics (the actual tool, system, team, scale, \
or named project) must survive the rewrite. If following strategic_instruction \
would strip out a specific in favour of sounding more like the JD, keep the \
specific and dial back the JD-mirroring instead — a bullet so generic it could \
belong to any candidate is a worse outcome than one that's slightly less \
keyword-dense but still reads as this person's real work.
4. BULLET STRUCTURE: Start every bullet with a strong past-tense action verb \
(e.g., Architected, Engineered, Reduced, Drove, Launched). \
Format: [Action Verb] + [Method/Tool with JD keyword] + [Impact]. \
Do not open more than one bullet in the full set with the same verb unless no \
reasonable synonym fits — repeated verbs read as a thin vocabulary to both \
recruiters and ATS scoring; vary word choice across the whole rewritten set. \
QUANTIFY WHEN THE FACTS SUPPORT IT, NOT ON EVERY BULLET: preserved_metrics \
gives you real numbers to echo — use them. But when a bullet genuinely has no \
number behind it, do not invent one (rule 2) and do not pad it with vague \
filler to sound quantified. A specific, concrete bullet with no number \
("Redesigned the onboarding flow to cut new-hire ramp time") beats a bullet \
that fabricates or forces a weak metric just to fit the format.
5. ACRONYM CLARITY: the first time a keyword with a well-known acronym form \
appears across the bullet set (e.g., SEO, CI/CD, SDLC, API), pair the full \
term with its acronym if the bullet's length budget allows (e.g., "Search \
Engine Optimization (SEO)") — some ATS platforms index the literal string and \
miss whichever form is absent. After the first pairing, the acronym alone is \
fine.
6. TENSE: Use past tense for every bullet, including bullets from the \
candidate's current/most recent role — consistency across the full set \
matters more than which tense, and mixed tense across many independently \
rewritten bullets is a real risk to avoid.
7. LENGTH — CONCISE, NOT COMPREHENSIVE: Target {bullet_words["prefer_min"]}-\
{bullet_words["prefer_max"]} words per bullet. {bullet_words["max"]} words is \
the absolute hard maximum — a bullet that runs long must be cut, not wrapped. \
Say less, more precisely; do not pad a short accomplishment with filler to \
sound more substantial.
8. BANNED WORDING: Never use these generic filler words/phrases unless the \
original bullet already uses one verbatim and removing it would lose meaning: \
{banned}. These read as vague résumé cliché, not evidence.
9. SKIP BULLETS: If strategic_instruction is "SKIP", copy the original_text \
unchanged into rewritten_text — but you MUST still include it in \
rewritten_bullets with its bullet_id.
10. COMPLETE COVERAGE — FATAL IF VIOLATED: Before producing your final JSON, \
mentally count the bullet_ids in mapping_plan. rewritten_bullets MUST contain \
EXACTLY that many entries — one per bullet_id, with no omissions and no \
duplicates. If even a single bullet_id is missing, the entire response is \
wrong and will cause the candidate's resume to be partially unchanged. A \
response that rewrites only some bullets while silently dropping others means \
the candidate sees only their skills list update and nothing else — this is \
the most common failure mode and it is unacceptable. (This rule governs which \
bullets you must respond to, not how many the candidate's resume should have — \
bullet-count selection happens upstream, before you ever see this plan.)
11. SKILLS: updated_skills must be EXACTLY the same list as original_skills — \
do not add or remove any skills. Skill additions are chosen by the user \
separately; your job is only to rewrite bullets.
12. SENIORITY-AWARE EMPHASIS: this JD's seniority signals are: \
{seniority_block}. Infer whether the role is individual-contributor, \
management/lead, or executive/director+ from these signals, and shape *how* \
each bullet reads accordingly — IC bullets should foreground technical scale, \
architecture decisions, and depth of hands-on ownership; management/lead \
bullets should foreground team scope, process ownership, and outcomes \
delivered through others; executive/director+ bullets should foreground \
strategic outcomes and org-level influence over hands-on technical detail. If \
the signals are sparse or ambiguous, default to a balanced technical+impact \
framing rather than guessing a level the JD doesn't clearly support.
13. TONE: {tone}
14. Output ONLY valid JSON matching the schema. No markdown, no preamble.
</rules>

<examples>
BAD (keyword-stuffed — contains the terms but demonstrates nothing specific):
"Led cross-functional stakeholder management to drive synergies across the \
organization leveraging data-driven decision making and best practices."
— reads as generic filler that could describe any candidate at any company; \
no tool, system, team, or outcome survives.

GOOD (responsibility-demonstrating — same candidate, same underlying work, \
actually evidences a duty):
"Partnered with product and 3 regional sales leads to redesign the deal-desk \
approval flow, cutting average deal cycle time from 11 to 6 days."
— keeps the real specifics (who was involved, what system, the number) while \
still speaking directly to a "cross-functional stakeholder management" / \
"process ownership" responsibility — the reader can see the work, not just \
the vocabulary.
</examples>

<output_schema>
{{
  "rewritten_bullets": [
    {{
      "reasoning": "string — brief: how this rewrite executes strategic_instruction and jd_responsibility_addressed while keeping rule 3's specifics intact",
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
    seniority_indicators: list[str] | None = None,
) -> WriterOutput:
    payload = {
        "mapping_plan": mapping_plan.model_dump()["mapping_plan"],
        "plausible_skills_to_add": _sanitize_skill_list(
            mapping_plan.plausible_skills_to_add
        ),
        "original_skills": original_skills,
    }
    return await provider.complete_structured(
        _build_agent3_system(humanize_level, seniority_indicators),
        json.dumps(payload),
        WriterOutput,
        model_tier="pro",
        max_output_tokens=_MAX_TOKENS_BULLET_WRITE,
        call_name="agent3_write",
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
        max_output_tokens=_MAX_TOKENS_COVER_LETTER,
        call_name="cover_letter",
    )


# ── Prep questions (runs in parallel with Agent 3) ────────────────────────────

_PREP_SOURCE_VALUES = {"requirement", "overlap", "gap"}
_MAX_PREP_QUESTIONS = 15


def _cap_balanced(questions: list["InterviewQuestionData"], limit: int) -> list["InterviewQuestionData"]:
    """Hard cap enforced in code — the system prompt's own cap (rule 2) is a
    cost/latency optimization, not a guarantee an LLM will actually respect.
    Round-robins across categories (in the order they first appear) so
    capping never just chops off whichever category the model happened to
    write last, e.g. always dropping every "gap" question."""
    if len(questions) <= limit:
        return questions
    buckets: dict[str, list["InterviewQuestionData"]] = {}
    order: list[str] = []
    for q in questions:
        key = q.source if q.source in _PREP_SOURCE_VALUES else "requirement"
        if key not in buckets:
            buckets[key] = []
            order.append(key)
        buckets[key].append(q)
    selected: list["InterviewQuestionData"] = []
    round_idx = 0
    while len(selected) < limit:
        progressed = False
        for key in order:
            if len(selected) >= limit:
                break
            bucket = buckets[key]
            if round_idx < len(bucket):
                selected.append(bucket[round_idx])
                progressed = True
        if not progressed:
            break
        round_idx += 1
    return selected


async def _generate_questions_for_skills(
    skills: list[str], resume_content: dict, provider: AIProvider
) -> list[SkillQuestionData]:
    """LLM call scoped to skills with no cached bank entry yet — never called
    for a skill _fill_skill_bank already found cached. Feeds ONLY the shared,
    cross-user SkillQuestionBank (Interview Center's pre-session browse
    view) — a real tailoring run's own prep questions come from
    _agent4_generate_interview_questions instead, which is grounded in this
    specific JD and resume rather than a bare skill name."""
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
        system, json.dumps(resume_content), SkillQuestionsWrapper, model_tier="pro",
        max_output_tokens=_MAX_TOKENS_PREP_SKILL_QUESTIONS, call_name="prep_questions_skills",
    )
    return wrapper.questions


async def _fill_skill_bank(
    missing_skills: list[str], resume_content: dict, provider: AIProvider, db: AsyncSession
) -> None:
    """Best-effort: keeps the shared, cross-user SkillQuestionBank growing
    for Interview Center's pre-session browse view (GET /ai/questions/browse)
    — a separate, lower-stakes experience from a real tailoring run's own
    prep questions, which this no longer feeds (see
    get_or_generate_prep_questions). Callers should treat failures here as
    non-fatal: a slow-growing browse bank is never worth risking the user's
    real, personalized questions."""
    safe_missing = _sanitize_skill_list(missing_skills)
    normalized: dict[str, str] = {}
    for s in safe_missing:
        key = s.strip().lower()
        if key and key not in normalized:
            normalized[key] = s.strip()
    if not normalized:
        return

    cached_keys = set(
        (await db.execute(
            select(SkillQuestionBank.skill).where(SkillQuestionBank.skill.in_(normalized.keys()))
        )).scalars().all()
    )
    uncovered_display = [display for key, display in normalized.items() if key not in cached_keys]
    if not uncovered_display:
        return
    uncovered_keys = {d.strip().lower() for d in uncovered_display}

    generated = await _generate_questions_for_skills(uncovered_display, resume_content, provider)
    new_rows: list[SkillQuestionBank] = []
    for q in generated:
        key = q.skill.strip().lower()
        if key not in uncovered_keys:
            continue  # LLM echoed a skill we never asked about (or one already
            # cached) — drop it, don't cache garbage or duplicate a covered skill.
        topic = q.topic if q.topic in _TOPIC_VALUES else "Technical"
        new_rows.append(SkillQuestionBank(
            skill=key, topic=topic, question=q.question, answer_framework=q.answer_framework
        ))
    if new_rows:
        db.add_all(new_rows)
        await db.commit()


def _build_interview_prep_system(seniority_indicators: list[str]) -> str:
    seniority_block = json.dumps(seniority_indicators) if seniority_indicators else "(none extracted for this JD)"
    return f"""\
<system_role>
You are an expert interview coach building a real, personalized prep set \
for one candidate applying to one specific role. Every question must be \
something a real interviewer would plausibly ask FOR THIS ROLE and THIS \
CANDIDATE — never generic trivia any candidate for any job could be asked.
</system_role>

<rules>
1. BEHAVIORAL-EVENT FRAMING — MANDATORY: every question must ask for a \
SPECIFIC PAST EXAMPLE, never a hypothetical. Use "Tell me about a time...", \
"Walk me through...", "Describe a situation where...". NEVER use "How would \
you..." or "What would you do if..." — past behavior is what real \
interviewers actually probe for; hypotheticals invite rehearsed, generic \
answers.
2. CAP: generate AT MOST 15 questions total across all three categories \
combined. If the input lists below could support more than that, prioritize \
the most role-critical responsibilities/skills and the clearest resume \
evidence — breadth of coverage matters less than every question being \
worth asking.
3. THREE REQUIRED CATEGORIES — generate questions across all three that \
have real input to draw from (skip a category only if its input list below \
is empty; do not force a question with nothing to ground it):
   - "requirement": seeded from jd_core_responsibilities — one question per \
responsibility (do not exceed the number of responsibilities given), \
probing whether the candidate has real experience matching that specific \
duty. Set basis to the exact responsibility text this question targets.
   - "overlap": seeded from matched_skills AND the candidate's actual \
resume_content — must reference or allude to a SPECIFIC real accomplishment \
from resume_content (not just repeat the skill name in the abstract), \
inviting the candidate to elaborate — e.g. "Walk me through how you [the \
specific thing their resume shows] — what made that work for [the JD's \
need]?". NEVER phrase this as skepticism or a demand for proof ("prove you \
really did X") — it must read as a genuine invitation to elaborate on real \
evidence, not an interrogation. Set basis to "<skill> — <the specific \
resume detail referenced>".
   - "gap": seeded from missing_skills, but NEVER a trivia/knowledge-check \
question on the missing skill itself ("explain how X works", "what is Y" \
are FORBIDDEN). Instead, ask the candidate to connect an ADJACENT skill \
they DO have (drawn from matched_skills or resume_content) to the gap — \
e.g. "You haven't listed direct Kubernetes experience, but you've run \
production Docker deployments — tell me about a time that container \
experience would carry over to a Kubernetes environment." Set basis to the \
missing skill name.
4. FACT LOCK: only reference resume content that literally appears in \
resume_content. Never invent an accomplishment, metric, tool, or project \
the candidate's resume doesn't actually show — an "overlap" question \
grounded in a fabricated detail is worse than not asking it at all.
5. SENIORITY-AWARE MIX: this JD's seniority signals are {seniority_block}. \
As seniority increases, bias the overall mix toward behavioral/ownership- \
framed questions over narrow technical-trivia framing — at senior levels \
the technical bar is largely assumed, and the real signal being tested is \
scope, ambiguity-handling, and influence over others' work. If signals are \
sparse or absent, default to a balanced technical+behavioral mix rather \
than guessing a level the JD doesn't clearly support.
6. TOPIC: exactly one of "Technical", "Behavioral", "HR & Culture" per \
question.
7. ANSWER FRAMEWORK: STAR method (Situation, Task, Action, Result) — a \
short structural cue for how to organize an answer, not a full model answer \
or a restatement of the question.
8. Output ONLY valid JSON matching the schema. No markdown, no preamble.
</rules>

<output_schema>
{{
  "questions": [
    {{
      "source": "requirement | overlap | gap",
      "basis": "string — the specific responsibility/skill/resume detail this question is grounded in",
      "topic": "string",
      "question": "string",
      "answer_framework": "string"
    }}
  ]
}}
</output_schema>"""


async def _agent4_generate_interview_questions(
    jd_analysis: "JDAnalysis",
    matched_skills: list[str],
    missing_skills: list[str],
    resume_content: dict,
    company_name: str | None,
    provider: AIProvider,
) -> list[InterviewQuestionData]:
    """The real, personalized prep-question generator for one JD + one
    resume — replaces the old design where most questions came from a
    generic, cross-user skill-name cache with no JD or resume grounding.
    See _build_interview_prep_system for the full rule set (behavioral-
    event framing, the three required categories, FACT LOCK, seniority-
    aware mix)."""
    at_company = f" at {company_name.strip()}" if company_name and company_name.strip() else None
    payload = {
        "target_role_context": at_company,
        "jd_core_responsibilities": jd_analysis.core_responsibilities,
        "jd_domain_expertise_themes": jd_analysis.domain_expertise_themes,
        "jd_exact_technical_tools": jd_analysis.exact_technical_tools,
        "jd_methodologies_and_frameworks": jd_analysis.methodologies_and_frameworks,
        "matched_skills": matched_skills[:15],
        "missing_skills": missing_skills[:10],
        "resume_content": resume_content,
    }
    wrapper = await provider.complete_structured(
        _build_interview_prep_system(jd_analysis.seniority_indicators),
        json.dumps(payload),
        InterviewQuestionsWrapper,
        model_tier="pro",
        max_output_tokens=_MAX_TOKENS_PREP_INTERVIEW_QUESTIONS,
        call_name="prep_questions_interview",
    )
    return wrapper.questions


async def get_or_generate_prep_questions(
    missing_skills: list[str],
    resume_content: dict,
    provider: AIProvider,
    db: AsyncSession,
    jd_analysis: "JDAnalysis | None" = None,
    company_name: str | None = None,
    matched_skills: list[str] | None = None,
) -> list[PrepQuestionData]:
    """This user's real, personalized interview prep set for one JD —
    grounded in the JD's actual responsibilities (source="requirement"),
    the candidate's real matched-skill evidence (source="overlap"), and a
    reframed take on their skill gaps (source="gap"), via
    _agent4_generate_interview_questions. See that function's system prompt
    for the full rule set. There is no meaningful question to generate
    without a JD to ground it — jd_analysis is effectively required (the
    real caller always supplies it); omitting it returns [].

    Also best-effort keeps the separate, lower-stakes SkillQuestionBank
    growing (see _fill_skill_bank) for Interview Center's pre-session
    browse view — a failure there is logged and swallowed, never allowed
    to affect the real questions returned here.
    """
    try:
        await _fill_skill_bank(missing_skills, resume_content, provider, db)
    except Exception:
        logger.warning("Skill-bank fill failed (non-fatal — browse view only)", exc_info=True)

    if jd_analysis is None:
        return []

    safe_matched = _sanitize_skill_list(matched_skills or [])
    safe_missing = _sanitize_skill_list(missing_skills)
    questions = await _agent4_generate_interview_questions(
        jd_analysis, safe_matched, safe_missing, resume_content, company_name, provider
    )
    questions = _cap_balanced(questions, _MAX_PREP_QUESTIONS)

    result: list[PrepQuestionData] = []
    for i, q in enumerate(questions):
        source = q.source if q.source in _PREP_SOURCE_VALUES else "requirement"
        result.append(PrepQuestionData(
            topic=q.topic if q.topic in _TOPIC_VALUES else "Technical",
            question=q.question,
            answer_framework=q.answer_framework,
            is_gap_based=(source == "gap"),
            source=source,
            basis=q.basis,
            order_index=i + 1,
        ))
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
    # {phrase_lowercased: matched|partial|missing} from the semantic pass — the
    # caller persists this (keyed by resume fingerprint) so re-analyzing an
    # unchanged resume reuses it instead of re-hitting the model.
    semantic_verdicts: dict[str, str] = field(default_factory=dict)
    # "" when the JD had no extractable title, else matched|partial|missing for
    # whether the candidate's recent title(s) align with the role being hired.
    title_match: str = ""


@dataclass
class TailoringResult:
    tailored_content: dict
    matched_skills: list[str]
    missing_skills: list[str]
    ats_score: int
    prep_questions: list[PrepQuestionData]
    company_keywords: list[str]  # company-specific ATS keywords surfaced to the frontend
    suggested_skills: list[str]  # skills Agent 2 suggests adding — user opts in via UI
    ats_fixes: list[AtsFix] = field(default_factory=list)
    bullet_importance: dict[str, str] = field(default_factory=dict)


_IMPORTANCE_RANK = {"high": 0, "medium": 1, "low": 2}


def _max_importance(levels: list[str]) -> str:
    valid = [l for l in levels if l in _IMPORTANCE_RANK]
    return min(valid, key=lambda l: _IMPORTANCE_RANK[l]) if valid else "medium"


async def analyze_jd_match(
    resume_content: dict,
    jd_text: str,
    provider: AIProvider,
    company_name: str | None = None,
    cached_jd_analysis: "JDAnalysis | None" = None,
    cached_semantic_verdicts: "dict[str, str] | None" = None,
) -> JDMatchAnalysis:
    """
    Agent 0 (fast)  ─── company intel (optional)
    Agent 1 (fast)  ─── parse JD into structured analysis (enriched by company intel)
         │
         ├── compute_delta (local, no AI) ── exact lexical matched / missing
         └── _verify_semantic_presence (fast) ── paraphrase/synonym recovery on
             the lexically-missing phrases + core_responsibilities
                  │
                  └── blend_scores ── final matched / missing / ats_score

    This is the "Analyze Description" step — read-only, doesn't touch the
    resume. run_tailoring_pipeline (the "Tailor Resume" step) continues on
    from here into the resume-rewriting agents.

    cached_jd_analysis — pass a previously stored JDAnalysis (no-company-name
    variant) to skip Agent 1 entirely.  The caller is responsible for only
    passing this when company_name is absent, since company intel changes the
    Agent 1 output.

    cached_semantic_verdicts — {phrase_lowercased: verdict} from a previous
    analyze of the *same resume text*; when given, the semantic model call is
    skipped and these verdicts are used directly (keeps the score stable across
    repeat clicks).  Only safe when the resume content is unchanged.
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

    # ── lexical + semantic + title blend, all via the pure score_content ────
    resume_text, _ = build_resume_text(resume_content)

    # Which phrases still need the semantic pass (lexical misses + responsibilities)
    probe = score_content(resume_content, jd_analysis, {})
    responsibilities = [
        r.strip() for r in (jd_analysis.core_responsibilities or []) if r and r.strip()
    ]
    to_verify = list(probe.missing) + responsibilities

    if cached_semantic_verdicts is not None:
        semantic_verdicts = dict(cached_semantic_verdicts)
    elif to_verify:
        semantic_verdicts = await _verify_semantic_presence(
            to_verify, resume_text, provider
        )
    else:
        semantic_verdicts = {}

    blended = score_content(resume_content, jd_analysis, semantic_verdicts)

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
        matched_skills=blended.matched,
        missing_skills=blended.missing,
        ats_score=blended.ats_score,
        company_keywords=company_keywords,
        semantic_verdicts=semantic_verdicts,
        title_match=blended.title_match,
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
        _agent3_write(
            mapping_plan, original_skills, humanize_level, provider,
            seniority_indicators=analysis.jd_analysis.seniority_indicators,
        ),
        get_or_generate_prep_questions(
            analysis.missing_skills, resume_content, provider, db,
            jd_analysis=analysis.jd_analysis, company_name=company_name,
            matched_skills=analysis.matched_skills,
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

    # ── re-score against the *tailored* resume ──────────────────────────────
    # The first analyze_jd_match ran on the resume the user started with — its
    # score/matched/missing describe the BEFORE state and drive Agent 2's
    # mapping + prep questions. What we hand back must describe the AFTER
    # state, or "Tailor Resume" appears to do nothing to the ATS score.
    # cached_jd_analysis reuses Agent 1 (same JD) so this is one fast
    # semantic call, not a full re-parse.
    post = await analyze_jd_match(
        tailored_content, jd_text, provider, company_name,
        cached_jd_analysis=analysis.jd_analysis,
    )

    # ── diagnostics: what did tailoring actually move? ──────────────────────
    before_missing = {m.strip().lower() for m in analysis.missing_skills}
    after_missing = {m.strip().lower() for m in post.missing_skills}
    n_bullets = sum(len(e.get("bullets") or []) for e in (resume_content.get("experience") or []))
    logger.info(
        "tailoring delta: ats %d -> %d | title %r -> %r | "
        "missing %d -> %d (closed: %s) | bullets rewritten %d/%d | skills unchanged (%d)",
        analysis.ats_score, post.ats_score,
        analysis.title_match or "n/a", post.title_match or "n/a",
        len(analysis.missing_skills), len(post.missing_skills),
        sorted(before_missing - after_missing) or "none",
        len(tailored_raw.rewritten_bullets), n_bullets,
        len(resume_content.get("skills") or []),
    )

    # ── build the gap → fix list ────────────────────────────────────────────
    imp = analysis.jd_analysis.importance or {}

    def _imp(term: str) -> str:
        return imp.get(term.strip().lower()) or default_importance(
            term,
            titles=analysis.jd_analysis.target_job_titles or [],
            hard_tools=analysis.jd_analysis.exact_technical_tools or [],
            mediums=(analysis.jd_analysis.methodologies_and_frameworks or [])
                + (analysis.jd_analysis.ats_filter_phrases or [])
                + (analysis.jd_analysis.core_responsibilities or []),
            nice=analysis.jd_analysis.nice_to_have_skills or [],
        )

    gap_specs: list[dict] = []
    for skill in post.missing_skills:
        gap_specs.append({"gap": skill, "kind": "skill", "importance": _imp(skill)})
    for resp in (analysis.jd_analysis.core_responsibilities or []):
        if post.semantic_verdicts.get(resp.strip().lower(), "missing") in ("partial", "missing"):
            gap_specs.append({"gap": resp, "kind": "responsibility", "importance": _imp(resp)})
    if post.title_match in ("", "partial", "missing") and (analysis.jd_analysis.target_job_titles or []):
        gap_specs.append({"gap": "job title", "kind": "title", "importance": _imp("job title")})

    gap_out = await _agent_gap_filler(
        tailored_content, analysis.jd_analysis, gap_specs, provider,
    )

    fixes: list[AtsFix] = []
    # skill fixes: every missing skill + Agent 2's plausible-to-add set
    skill_names: list[str] = list(post.missing_skills) + _sanitize_skill_list(
        mapping_plan.plausible_skills_to_add
    )
    seen_skill = set()
    for name in skill_names:
        k = name.strip().lower()
        if not k or k in seen_skill:
            continue
        seen_skill.add(k)
        fixes.append(AtsFix(
            id=fix_slug("skill", name), type="skill", gap=name,
            importance=_imp(name), grounded=True, text=name, default_accept=False,
        ))
    # bullet fixes from the gap filler
    for b in gap_out.bullets:
        fixes.append(AtsFix(
            id=fix_slug("bullet", b.gap), type="bullet", gap=b.gap,
            importance=_imp(b.gap), grounded=b.grounded, text=b.bullet_text,
            experience_index=b.experience_index,
            default_accept=b.grounded,   # only a grounded bullet pre-accepts
        ))
    # headline fix
    if gap_out.headline.strip():
        fixes.append(AtsFix(
            id="headline:job-title", type="headline", gap="job title",
            importance=_imp("job title"), grounded=False,
            text=gap_out.headline.strip(), default_accept=False,
        ))

    for f in fixes:
        f.score_delta = estimate_fix_delta(
            tailored_content, analysis.jd_analysis, post.semantic_verdicts,
            post.ats_score, f,
        )
    fixes.sort(key=lambda f: (_IMPORTANCE_RANK[f.importance], -f.score_delta))

    bullet_importance: dict[str, str] = {}
    for m in mapping_plan.mapping_plan:
        terms = [t for t in ([m.jd_responsibility_addressed] + list(m.target_jd_keywords_to_inject or [])) if t]
        if terms:
            bullet_importance[m.original_bullet_id] = _max_importance([_imp(t) for t in terms])

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
        matched_skills=post.matched_skills,
        missing_skills=post.missing_skills,
        ats_score=post.ats_score,
        prep_questions=questions,
        company_keywords=post.company_keywords,
        suggested_skills=suggested,
        ats_fixes=fixes,
        bullet_importance=bullet_importance,
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
    return await provider.complete_structured(
        system, jd_text, ParsedJD, model_tier="fast",
        max_output_tokens=_MAX_TOKENS_JD_PARSE, call_name="extract_jd_skills_legacy",
    )

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
import hashlib
import re
import json
import logging
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Literal
from pydantic import BaseModel, field_validator
from sqlalchemy.ext.asyncio import AsyncSession
from app.services.ai_engine.base import AIProvider
from app.services.ats import (
    compute_delta, blend_scores, build_resume_text, title_match_verdict,
    default_importance, score_content, AtsFix, fix_slug, estimate_fix_delta,
    bullet_already_present, verdicts_with_rewrites,
)
from app.services.resume_spec import BANNED_GENERIC_PHRASES, HARD_LIMITS
from app.services.bullet_guard import guard_rewrite
from app.services.ai_engine.base import AITruncatedError

logger = logging.getLogger("app")

# Per-call output-token ceilings, replacing the single blanket
# OPENAI_MAX_OUTPUT_TOKENS cap every call used before. Agent 2 and Agent 3
# emit one JSON entry per resume bullet, so their legitimate output scales
# with resume size (a full rewrite can need 8k-16k tokens) and both keep
# the full ceiling. Every other call here has a small, roughly fixed-shape
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

    # Runs on EVERY construction path — a fresh Agent 1 parse AND a
    # JDAnalysis rebuilt from a previously cached DB row (routers/ai.py's
    # `JDAnalysis(**raw_cached)`) — so a requirement sentence ("Bachelor's
    # degree in...", "working knowledge of X") that leaked into one of these
    # skill-chip fields before this filter existed gets cleaned up on a JD
    # analyzed before this fix shipped too, without needing to re-run (and
    # re-pay for) Agent 1 on it. Never applied to core_responsibilities,
    # domain_expertise_themes, seniority_indicators, or target_job_titles —
    # those are meant to hold full sentences or are never surfaced as chips.
    @field_validator(
        "exact_technical_tools", "methodologies_and_frameworks",
        "ats_filter_phrases", "nice_to_have_skills",
    )
    @classmethod
    def _strip_requirement_prose(cls, v: list[str]) -> list[str]:
        return _sanitize_skill_list(v)


class _TermImportance(BaseModel):
    """One {term, level} pair. OpenAI's Structured Outputs strict mode
    rejects an open-ended dict[str, str] (arbitrary JD-term keys) — see
    _JDAnalysisWire below — so Agent 1's raw wire schema carries a list of
    these instead; _agent1_parse_jd folds the list into JDAnalysis.importance's
    plain dict for every other caller."""
    term: str
    level: str


class _JDAnalysisWire(BaseModel):
    """Agent 1's actual LLM response schema — identical to JDAnalysis except
    importance is a list, not a dict (see _TermImportance)."""
    exact_technical_tools: list[str]
    methodologies_and_frameworks: list[str]
    domain_expertise_themes: list[str]
    seniority_indicators: list[str]
    ats_filter_phrases: list[str]
    core_responsibilities: list[str] = []
    target_job_titles: list[str] = []
    nice_to_have_skills: list[str] = []
    importance: list[_TermImportance] = []


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
    # The four types rule 4 defines, as a real enum rather than prose buried in
    # strategic_instruction. Agent 3's rule 9 exact-matches "SKIP" to decide
    # whether to pass the original through, and _apply_writer_output now
    # enforces that in code — a free-text "Skip — no JD fit" silently missed
    # both. Structured outputs reject anything off this list.
    transformation: Literal["REINFORCE", "REFRAME", "INJECT", "SKIP"] = "REINFORCE"
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
    r"delivered|coordinated|analyzed|performed|conducted|supported)\b",
    re.IGNORECASE,
)

# Requirement/qualifier phrasing wraps what otherwise reads like a plausible
# noun phrase ("working knowledge of relational databases", "proficiency
# with content management systems", "Bachelor's degree in software
# engineering") — checked anywhere in the string, not just at the start,
# since the qualifier is rarely the very first word.
_SKILL_PROSE_MARKERS = re.compile(
    r"\b(experience (with|in)|proficient (with|in|at)|proficiency (with|in)|"
    r"knowledge of|ability to|familiarity with|understanding of|"
    r"degree (in|with)|bachelor'?s|master'?s|ph\.?d|years? of)\b",
    re.IGNORECASE,
)


def _looks_like_a_skill(s: str) -> bool:
    """Reject prose that slipped past the LLM's own formatting rules — a
    process/responsibility description mistaken for a skill name, not a
    skill itself. Real skill names are short noun phrases; sentences and
    bullet fragments are not."""
    words = s.split()
    # Four, not six: the parse prompt has always told the model "1 to 4 words",
    # and the extra two let JD phrases through as skill chips reading like
    # sentences. "Google Cloud Platform" and "Stakeholder Management" fit.
    if len(words) == 0 or len(words) > 4:
        return False
    if ". " in s or s.count(",") > 1 or ";" in s:
        return False
    if _SKILL_LEADING_VERBS.match(s.strip()):
        return False
    if _SKILL_PROSE_MARKERS.search(s):
        return False
    return True


def skill_candidates(
    missing: list[str], plausible: list[str], existing: list[str]
) -> list[str]:
    """The skills worth offering to add, in the order they should be offered.

    Two things the review screen used to get wrong. `missing` comes straight
    from the ATS analysis, which draws on Agent 1's responsibilities and filter
    phrases — prose by nature — and only `plausible` was ever shape-checked, so
    whole clauses arrived as skill chips. And nothing compared either list
    against the skills the résumé already carries, so a skill could be offered
    as an addition while sitting in "on your résumé now".

    Missing first: a gap the JD names outranks one the mapper merely thinks
    plausible.
    """
    seen = {str(e).strip().lower() for e in existing}
    out: list[str] = []
    for name in list(missing) + list(plausible):
        key = str(name).strip().lower()
        if not key or key in seen or not _looks_like_a_skill(str(name).strip()):
            continue
        seen.add(key)
        out.append(str(name).strip())
    return out


def _sanitize_skill_list(skills: list[str]) -> list[str]:
    result = []
    for s in skills:
        s = re.sub(r"[\x00-\x1f\x7f]", "", s)
        s = s[:200].strip()
        if s and _looks_like_a_skill(s):
            result.append(s)
    return result


# Every résumé section whose entries carry rewritable bullets, with the
# bullet_id prefix each one uses. Projects are here because a fresher's
# technical evidence lives there — indexing only "experience" meant Agent 2
# and Agent 3 never saw those bullets and a fresher's tailor run was a no-op.
_BULLET_SECTIONS: list[tuple[str, str]] = [("experience", "exp"), ("projects", "proj")]
_BULLET_ID_RE = re.compile(r"^(exp|proj)(\d+)_b(\d+)$")


def _bullet_text(content: dict, bullet_id: str) -> str | None:
    """The text of *bullet_id* ("exp0_b2") in plain résumé content."""
    m = _BULLET_ID_RE.match(bullet_id)
    if not m:
        return None
    section = dict((p, s) for s, p in _BULLET_SECTIONS)[m.group(1)]
    entries = content.get(section) or []
    e, b = int(m.group(2)), int(m.group(3))
    if e >= len(entries) or b >= len(entries[e].get("bullets") or []):
        return None
    return entries[e]["bullets"][b]


def _with_bullet(content: dict, bullet_id: str, text: str) -> dict:
    """A copy of *content* with *bullet_id* set to *text*."""
    m = _BULLET_ID_RE.match(bullet_id)
    out = deepcopy(content)
    if not m:
        return out
    section = dict((p, s) for s, p in _BULLET_SECTIONS)[m.group(1)]
    out[section][int(m.group(2))]["bullets"][int(m.group(3))] = text
    return out


def _collect_all_bullets(content: dict) -> list[str]:
    """Every bullet string across all rewritable sections, in section order."""
    return [
        b
        for section, _prefix in _BULLET_SECTIONS
        for entry in (content.get(section) or [])
        for b in (entry.get("bullets") or [])
    ]


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
    for section, prefix in _BULLET_SECTIONS:
        for entry_i, entry in enumerate(content.get(section) or []):
            new_bullets = []
            for b_i, bullet in enumerate(entry.get("bullets") or []):
                bid = f"{prefix}{entry_i}_b{b_i}"
                bullet_index[bid] = f"{section}[{entry_i}].bullets[{b_i}]"
                if isinstance(bullet, str):
                    new_bullets.append({"bullet_id": bid, "text": bullet})
                else:
                    bullet["bullet_id"] = bid
                    new_bullets.append(bullet)
            entry["bullets"] = new_bullets
    return content, bullet_index


def _guard_writer_output(
    indexed_resume: dict,
    writer: WriterOutput,
    mapping_plan: "MappingPlan | None" = None,
    tool_terms: list[str] | None = None,
    evidence_text: str = "",
) -> tuple[WriterOutput, list[dict]]:
    """Enforce fact-lock on Agent 3's rewrites before they reach the résumé.

    tool_terms / evidence_text (the JD's tools, the whole original résumé)
    also reject a rewrite that claims a tool the candidate never mentions.

    Agent 3's rules about metrics, length and banned filler were prompt-only —
    this is where they become checks. A rewrite that breaks one is reverted to
    the candidate's own original text (see bullet_guard for why reverting is
    always the safe remedy) and reported in the returned list so the pipeline
    can log it and the review screen can say what happened, instead of the
    user silently getting a bullet they never chose.

    Returns (guarded_writer_output, reverted) where each `reverted` entry is
    {bullet_id, reasons, original_text, rejected_text}.
    """
    originals: dict[str, str] = {}
    for section, _prefix in _BULLET_SECTIONS:
        for entry in indexed_resume.get(section) or []:
            for bullet in entry.get("bullets") or []:
                if isinstance(bullet, dict) and bullet.get("bullet_id"):
                    originals[bullet["bullet_id"]] = bullet.get("text", "")

    metrics: dict[str, list[str]] = {}
    plan_originals: dict[str, str] = {}
    if mapping_plan:
        for entry in mapping_plan.mapping_plan:
            metrics[entry.original_bullet_id] = list(entry.preserved_metrics or [])
            plan_originals[entry.original_bullet_id] = entry.original_text

    guarded: list[RewrittenBullet] = []
    reverted: list[dict] = []
    for rb in writer.rewritten_bullets:
        # The indexed résumé is built locally from the user's own content, so
        # it is the authoritative original; the mapping plan is model output
        # and only fills in when an id somehow isn't in the indexed résumé.
        original = originals.get(rb.bullet_id, plan_originals.get(rb.bullet_id, ""))
        if not original:
            guarded.append(rb)
            continue
        text, reasons = guard_rewrite(
            original, rb.rewritten_text, metrics.get(rb.bullet_id, []), tool_terms, evidence_text,
        )
        if reasons:
            reverted.append({
                "bullet_id": rb.bullet_id,
                "reasons": reasons,
                "original_text": original,
                "rejected_text": rb.rewritten_text,
            })
        guarded.append(RewrittenBullet(
            reasoning=rb.reasoning, bullet_id=rb.bullet_id, rewritten_text=text,
        ))

    return WriterOutput(rewritten_bullets=guarded, updated_skills=writer.updated_skills), reverted


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
    skipped: set[str] = set()
    if mapping_plan:
        for entry in mapping_plan.mapping_plan:
            plan_originals[entry.original_bullet_id] = entry.original_text
            if entry.transformation == "SKIP":
                skipped.add(entry.original_bullet_id)

    # A SKIP means Agent 2 found no honest connection between this bullet and
    # the JD. Agent 3 is told to copy it through untouched (its rule 9), but
    # that was a prompt promise with nothing behind it — and a rewrite of a
    # bullet nobody could tie to a requirement is exactly the kind that
    # invents one. Drop any rewrite for a skipped id.
    for bid in skipped:
        rewrite_map.pop(bid, None)

    missing_ids: list[str] = []
    for section, _prefix in _BULLET_SECTIONS:
        for entry in content.get(section) or []:
            patched = []
            for bullet in entry.get("bullets") or []:
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
            entry["bullets"] = patched

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
</rules>"""


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
</rules>"""


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
    wire = await provider.complete_structured(
        _AGENT1_SYSTEM, user_msg, _JDAnalysisWire, model_tier="fast",
        max_output_tokens=_MAX_TOKENS_JD_PARSE, call_name="agent1_parse_jd",
    )
    # wire.importance is normally a list[_TermImportance] (see _JDAnalysisWire);
    # tolerate a plain dict too since test doubles sometimes hand back a
    # JDAnalysis directly regardless of the requested schema.
    raw_importance = wire.importance
    importance = (
        raw_importance if isinstance(raw_importance, dict)
        else {i.term: i.level for i in raw_importance}
    )
    # JDAnalysis's own field validator strips requirement prose from the
    # skill-chip fields (exact_technical_tools etc.) on construction here —
    # see the comment on that validator for why it lives on the model
    # instead of this one call site.
    result = JDAnalysis(**wire.model_dump(exclude={"importance"}), importance=importance)
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
</rules>"""


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
1. ONLY propose a bullet for a gap the résumé does NOT already cover, even \
loosely. If any existing bullet already touches the gap, skip it entirely \
(omit it from the output) — the résumé's own bullets already speak to it and a \
second, reworded bullet would just duplicate them.
2. For a genuine gap, write ONE plausible new bullet for the role. It is \
speculative: the user keeps it only if it is actually true of them. Always set \
grounded=false and experience_index=null. Write it as one plain, concrete \
sentence under 20 words: past-tense action verb + what was done + with what. \
No buzzwords, no stacked JD phrases, no purpose clause such as ", ensuring…".
3. Never invent numbers, employers, dates, or tools. A speculative bullet has \
no metrics — it describes a capability, not a measured result.
4. If a gap has kind "title", and only then, also return a `headline` string: \
a concise professional headline aligning the candidate to the target title \
(e.g. "Senior Data Analyst | Analytics Engineering"). Otherwise headline "".
5. At most one bullet per gap, in the same order; gaps the résumé already \
covers produce no bullet at all. Output ONLY valid JSON matching the schema.
</rules>"""


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
You are a senior resume strategist. Plan how each resume bullet should be \
rewritten so it speaks to the Job Description (JD) while staying 100% true to \
what the candidate actually did. A writer executes your plan literally, so \
every instruction you give must be one an honest writer can follow.
</system_role>

<rules>
1. TRUTH FIRST — FACT LOCK: never plan a change that alters or adds a fact. \
Facts are numbers, percentages, money, dates, company names, job titles, named \
projects, AND the concrete things worked on (the system, domain, data, tool, \
audience). "order fulfilment API" must not become "payment API"; "4M records" \
must not become "4M transactions". Record every number, percentage, money \
figure and date in preserved_metrics exactly as written.
2. EVIDENCE RULE FOR KEYWORDS — a JD keyword may go in \
target_jd_keywords_to_inject ONLY if it (a) already appears in the bullet, \
(b) is the standard name or umbrella term for something the bullet explicitly \
describes ("pulled data from three systems into a warehouse" → "ETL"; \
"automated deployment pipelines" → "CI/CD"), or (c) is a tool/technology named \
elsewhere in the SAME role or project entry. A tool, language or platform that \
appears nowhere in that entry is never injected, however well it fits the JD — \
that is fabrication, not tailoring. A JD domain is not an umbrella for a \
different domain: "order fulfilment" work does not license "payment \
processing". At most 2 keywords per bullet.
3. RESPONSIBILITY-FIRST REASONING: before choosing a transformation, decide \
which of jd_analysis.core_responsibilities (if any) the bullet's real work \
evidences and copy it verbatim into jd_responsibility_addressed; leave it "" \
if none honestly applies. The goal is a bullet that demonstrates that \
responsibility, not one that merely contains its words. Keep reasoning to one \
short sentence (max 30 words).
4. TRANSFORMATION (the `transformation` field) — choose the lightest one that \
does the job:
   - REINFORCE: same content, clearer wording, JD terminology where rule 2 allows.
   - REFRAME: same facts, lead with the aspect the JD cares about.
   - INJECT: add a rule-2-approved keyword that names what the work already was.
   - SKIP: no honest connection to the JD, or the bullet is already strong and \
relevant. Unchanged is a valid, often correct, outcome — never force a change.
   Spread distinct keywords across bullets: the same keyword in more than 2-3 \
bullets reads as stuffing unless the JD itself repeats it 3+ times.
5. SPECIFICITY OVER JD-MIRRORING: a rewrite must never be more generic than the \
original. If matching the JD would cost a concrete detail, keep the detail.
6. strategic_instruction: one or two plain sentences telling the writer what to \
emphasise and which specifics to keep. Never instruct the writer to add a \
purpose or benefit the original does not state ("to support business goals", \
"ensuring quality") — that is padding.
7. COMPLETE COVERAGE: exactly one mapping_plan entry per bullet_id in \
original_resume, including SKIPs.
8. plausible_skills_to_add: at most 15 skills (the 15-skill cap), each (a) named \
in the JD and (b) evidenced by the candidate's own résumé, most important \
first — the frontend's quick-add takes them in list order. Each is a 1-4 word \
skill/tool/method name ("Kubernetes", "Stakeholder Management"), never a \
sentence or duty.
9. priority_skills_from_user (if non-empty): the user confirms having these. \
Always include every one in plausible_skills_to_add verbatim (outside the \
15-skill cap) and prefer INJECT where a bullet's work genuinely shows one — \
but never fabricate a metric or experience to force it in.
10. Output ONLY valid JSON.
</rules>

<examples>
JD core_responsibility: "own end-to-end delivery of the payments platform"; \
JD tools: ["Python", "Kubernetes"]
BULLET: "Built the order fulfilment API in Python, cutting average order \
processing time from 800ms to 240ms"
GOOD: reasoning "Owning a transactional API end-to-end mirrors owning payments \
delivery; Python is there, Kubernetes is not." transformation REINFORCE, \
keywords ["Python"], preserved_metrics ["800ms", "240ms"], \
strategic_instruction "Present the API as owned end-to-end; keep 'order \
fulfilment', Python and both latency figures."
BAD: INJECT ["Kubernetes", "payments platform"] — Kubernetes is not in the \
entry, and it swaps the real system for the JD's words.

BULLET: "Ran monthly reporting on campaign performance across six channels" \
(the JD wants SQL; no SQL anywhere in this role)
GOOD: REINFORCE, keywords [], strategic_instruction "Keep it about the monthly \
six-channel performance reporting; add no tool."

BULLET: "Organised the team's annual offsite" → SKIP, jd_responsibility_addressed "".
</examples>"""


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

def _humanize_tone(humanize_level: int) -> str:
    """Shared by Agent 3 and the single-bullet rewrite so the two cannot drift."""
    if humanize_level < 30:
        return (
            "Write in fluent, natural-sounding prose. ATS keywords must appear "
            "organically — a human reader should not notice they were inserted."
        )
    if humanize_level > 70:
        return (
            "Optimise for ATS matching. Put the most important approved JD "
            "keyword early in the bullet, and use every approved keyword that "
            "fits naturally — but never at the cost of a clear, literal sentence."
        )
    return (
        "Balance ATS density and human readability. Weave keywords naturally "
        "into strong action-verb bullets without making them feel keyword-stuffed."
    )


def build_single_bullet_system(humanize_level: int) -> str:
    """Rules for rewriting ONE bullet on its own — the Studio's inline
    "Rewrite" button (routers/ai.py rewrite_bullet).

    That endpoint used to carry a two-sentence prompt while Agent 3 carried
    ~1300 words and a deterministic fact-lock, so the same user clicking
    "Rewrite" on a pipeline-written bullet reliably got a worse one back. This
    is Agent 3's rule set minus everything that only makes sense for a batch:
    no mapping plan, no bullet_ids, no coverage rule — instructions a
    single-bullet call could not follow.
    """
    bw = HARD_LIMITS["bullet_words"]
    banned = ", ".join(f'"{p}"' for p in BANNED_GENERIC_PHRASES)
    return f"""\
<system_role>
You are an elite technical resume writer rewriting a single resume bullet.
</system_role>

<rules>
1. FACT LOCK — NEVER FABRICATE: every number, percentage, dollar figure, date,
company name, job title and named project in the original must survive
unchanged. Do not add a metric, tool, technology, responsibility or outcome
that is not already in the original. Language and framing are yours to change
freely; facts are not.
2. PRESERVE SPECIFICS: the original's concrete details (the actual tool,
system, team, scale or named project) must survive. A bullet so generic it
could belong to any candidate is a worse outcome than one that is slightly
less keyword-dense but still reads as this person's real work.
3. STRUCTURE: open with a strong past-tense action verb, then what was done
and how, then the result if the original has one. Quantify only where the
original already supports it — never invent a number.
4. MEANING: a reader who has never seen the job description must understand
exactly what was done. Plain verbs, concrete nouns, grammatical and literal —
no pasted-in jargon, no buzzword chains. Never add a purpose or benefit the
original does not state (", ensuring…", ", supporting…", "to enhance…").
5. LENGTH: {bw["max"]} words is the hard maximum. Do not lengthen the bullet
unless you are adding real information from the original; if you have nothing
to add, the rewrite should be no longer than what you started with.
6. BANNED WORDING: never use these unless the original already does:
{banned}.
7. TONE: {_humanize_tone(humanize_level)}
8. Return ONLY the rewritten bullet — no quotes, no preamble, no explanation.
</rules>"""


def _build_agent3_system(humanize_level: int, seniority_indicators: list[str] | None = None) -> str:
    tone = _humanize_tone(humanize_level)

    bullet_words = HARD_LIMITS["bullet_words"]
    banned = ", ".join(f'"{p}"' for p in BANNED_GENERIC_PHRASES)
    seniority_block = (
        json.dumps(seniority_indicators) if seniority_indicators else "(none extracted for this JD)"
    )

    return f"""\
<system_role>
You are an expert resume writer. Rewrite each bullet in the mapping_plan so it \
reads as a clear, specific, true sentence about this candidate's real work, \
angled toward the job. The plan says what to emphasise; you make it read well.
</system_role>

<rules>
1. EXECUTE THE PLAN: for each bullet_id, follow strategic_instruction and use \
jd_responsibility_addressed to know which duty the bullet should visibly \
evidence. Use target_jd_keywords_to_inject with the exact phrasing given — \
keyword use is a byproduct of demonstrating jd_responsibility_addressed, not \
the goal. A keyword that will not fit grammatically and truthfully is left out.
2. FACT LOCK — NEVER FABRICATE: every value in preserved_metrics appears \
verbatim. Do not invent a number, tool, technology, team, audience, outcome or \
purpose that is not in original_text or the plan's keywords, and do not rename \
the thing that was built ("order fulfilment API" stays that, not "payment \
API"). If the original has no metric, the rewrite has none.
3. PRESERVE SPECIFICS: the original's concrete details (tool, system, data, \
team, scale, named project) survive, in their own words — never swap a \
specific noun for a broader one ("service scaffolding" must not become \
"platform infrastructure") and never weaken the verb ("Maintained" must not \
become "Collaborated on maintaining"). If the plan would cost a specific, \
keep the specific and do less JD-mirroring.
4. MEANING TEST — every bullet must pass all three:
   - A hiring manager who has never seen the JD understands exactly what was \
done, to what, and (if the original says) with what result.
   - Every phrase is grammatical and literal. Never paste a JD phrase in as a \
label or modifier ("platform development service scaffolding", "to \
collaborate on modeling data") — if it does not read naturally, drop it.
   - No abstract noun stacks or buzzword chains; plain verbs and concrete nouns.
5. STRUCTURE: open with a strong past-tense action verb (e.g., Built, Cut, \
Migrated, Led, Redesigned), then what was done and how, then the result if \
the original has one. Past tense throughout, current role included. Vary \
opening verbs across the set. Quantify when the facts support it, not on \
every bullet — a concrete bullet with no number beats a forced metric.
6. LENGTH FOLLOWS FACTS: target {bullet_words["prefer_min"]}-\
{bullet_words["prefer_max"]} words; {bullet_words["max"]} is the hard maximum. \
The range is a ceiling, never a quota: a short original stays short, and a \
rewrite is longer only when it carries more real information.
   - NO TRAILING RESTATEMENT: never end with a clause that adds no new fact — \
", ensuring…", ", supporting…", ", enabling…", ", aligned with business \
goals", "to enhance…". If the original does not state a purpose or benefit, \
you do not add one. End the sentence when the facts run out.
   - NO ADDED TAILS: every trailing phrase starting "for…", "to…", \
"through…", "using…", "via…" or an adverb like "accurately" must restate \
something the original says. "Built the order fulfilment API in Python for \
payment processing" invents a purpose; "stored it in PostgreSQL using SQL \
queries" invents a method.
7. ACRONYMS: the first time a keyword with a common acronym appears in the \
set, pair them if length allows ("Continuous Integration (CI/CD)"); after \
that the acronym alone.
8. BANNED WORDING: never use these unless the original already does: {banned}.
9. SKIP: if transformation is "SKIP", copy original_text unchanged. When a \
bullet is already strong and nothing honest can be added, returning it \
unchanged or near-unchanged is correct.
10. COMPLETE COVERAGE: rewritten_bullets has exactly one entry per bullet_id \
in mapping_plan — no omissions, no duplicates, SKIPs included. (This governs \
which bullets you must respond to, not how many the candidate's resume should \
have — bullet-count selection happens upstream, before you ever see this plan.)
11. SKILLS: updated_skills is exactly original_skills, unchanged.
12. SENIORITY-AWARE EMPHASIS: this JD's seniority signals are: \
{seniority_block}. For individual-contributor roles foreground technical \
depth and hands-on ownership; for lead/management roles, team scope and \
outcomes delivered through others; for executive roles, strategic outcomes. \
If the signals are sparse, use a balanced technical-plus-impact framing — \
and never claim scope the original does not show.
13. TONE: {tone}
14. reasoning: at most 15 words — name the duty evidenced and confirm nothing \
was added. Output ONLY valid JSON matching the schema.
</rules>

<examples>
BAD (keyword-stuffed): "Led cross-functional stakeholder management to drive \
synergies across the organization with data-driven decision making."
GOOD: "Partnered with product and 3 regional sales leads to redesign the \
deal-desk approval flow, cutting average deal cycle time from 11 to 6 days."

BAD (padded): "Remediated accessibility issues flagged in client audits, \
aligning accessible interfaces with web accessibility standards."
GOOD: "Remediated WCAG accessibility issues flagged across client audits."

BAD (invented tool): original "Ran monthly reporting on campaign performance \
across six channels" → "Built monthly SQL dashboards analysing campaign \
performance across six channels" — SQL was never in the original.
GOOD: "Produced monthly campaign-performance reporting across six channels."
</examples>"""


async def _agent3_write(
    mapping_plan: MappingPlan,
    original_skills: list[str],
    humanize_level: int,
    provider: AIProvider,
    seniority_indicators: list[str] | None = None,
) -> WriterOutput:
    """Rewrite every bullet in the plan, splitting the request if it overruns.

    Agent 3 emits one JSON entry per résumé bullet, so its output scales with
    résumé size. A long résumé can exhaust _MAX_TOKENS_BULLET_WRITE mid-JSON —
    the failure mode rule 10 of its own prompt calls the most common one. That
    used to surface as an opaque AttributeError that failed the whole run and
    refunded the credit.

    Retrying the same request is pointless: the same plan produces the same
    overrun. Halving it is what actually fits, so a truncation splits the plan
    and rewrites each half, recursively. A single entry that still truncates is
    genuinely unfixable here and re-raises.
    """
    entries = mapping_plan.mapping_plan
    if not entries:
        return WriterOutput(rewritten_bullets=[], updated_skills=list(original_skills))

    out = await _agent3_call(
        mapping_plan, original_skills, humanize_level, provider, seniority_indicators,
    )

    # Rule 10 calls omitting a bullet the most common failure mode, and the
    # fallback in _apply_writer_output makes it invisible: the bullet keeps its
    # original text and the user has paid for a tailor that quietly did not
    # happen on that line. A SKIP is deliberate and expected; anything else
    # missing is a drop, so ask again for exactly those.
    returned = {b.bullet_id for b in out.rewritten_bullets}
    dropped = [e for e in entries
               if e.transformation != "SKIP" and e.original_bullet_id not in returned]
    if dropped:
        logger.warning(
            "agent3_write omitted %d/%d bullet(s) — re-requesting: %s",
            len(dropped), len(entries), [e.original_bullet_id for e in dropped],
        )
        retry = await _agent3_call(
            MappingPlan(mapping_plan=dropped,
                        plausible_skills_to_add=mapping_plan.plausible_skills_to_add),
            original_skills, humanize_level, provider, seniority_indicators,
        )
        # One retry only. A second miss means the model will not answer for
        # these, and _apply_writer_output's fallback keeps their originals.
        out = WriterOutput(
            rewritten_bullets=out.rewritten_bullets + retry.rewritten_bullets,
            updated_skills=list(original_skills),
        )
    return out


async def _agent3_call(
    mapping_plan: MappingPlan,
    original_skills: list[str],
    humanize_level: int,
    provider: AIProvider,
    seniority_indicators: list[str] | None = None,
) -> WriterOutput:
    """One Agent 3 request, splitting the plan if the response overruns."""
    entries = mapping_plan.mapping_plan

    # Agent 2's reasoning stays behind: it justified the plan, and the writer
    # needs the plan (jd_responsibility_addressed, strategic_instruction), not
    # the justification. Resending it cost input tokens on every bullet.
    payload = {
        "mapping_plan": mapping_plan.model_dump(
            exclude={"mapping_plan": {"__all__": {"reasoning"}}}
        )["mapping_plan"],
        "plausible_skills_to_add": _sanitize_skill_list(
            mapping_plan.plausible_skills_to_add
        ),
        "original_skills": original_skills,
    }
    try:
        # "premium", not "pro" — Agent 3 does fact-locked rewriting of every
        # résumé bullet; on the budget model it's the call most prone to
        # dropping bullets, fabricating metrics, or truncating the JSON. It
        # shares the premium model with Agent 2 (see _agent2_semantic_map and
        # OpenAIProvider._model_for). Every other pipeline call stays on the
        # budget model.
        return await provider.complete_structured(
            _build_agent3_system(humanize_level, seniority_indicators),
            json.dumps(payload),
            WriterOutput,
            model_tier="premium",
            max_output_tokens=_MAX_TOKENS_BULLET_WRITE,
            call_name="agent3_write",
        )
    except AITruncatedError:
        if len(entries) == 1:
            raise
        mid = len(entries) // 2
        logger.warning(
            "agent3_write truncated on %d bullets — splitting into %d + %d",
            len(entries), mid, len(entries) - mid,
        )
        halves = [
            MappingPlan(
                mapping_plan=chunk,
                plausible_skills_to_add=mapping_plan.plausible_skills_to_add,
            )
            for chunk in (entries[:mid], entries[mid:])
        ]
        rewritten: list[RewrittenBullet] = []
        for half in halves:
            part = await _agent3_call(
                half, original_skills, humanize_level, provider, seniority_indicators,
            )
            rewritten.extend(part.rewritten_bullets)
        # Skills are never Agent 3's to change (its rule 11) and a split must
        # not let one half's answer drop them — carry the originals through.
        return WriterOutput(rewritten_bullets=rewritten, updated_skills=list(original_skills))


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
</rules>"""


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
</rules>"""


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
    """
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
    # Rewrites rejected by the deterministic fact-lock (see
    # _guard_writer_output): the bullet kept its original text. Each entry is
    # {bullet_id, reasons, original_text, rejected_text}. Surfaced so the user
    # is told a bullet was left alone and why, rather than just not seeing it
    # in the review list.
    reverted_bullets: list[dict] = field(default_factory=list)
    # {bullet_id: {"responsibility": str, "keywords": [str]}} — Agent 2's own
    # account of why each bullet was transformed. Generated and billed on
    # every run; kept so the review screen can show WHY a bullet changed,
    # not just that it did. Bullets with neither signal (a SKIP) are absent.
    bullet_rationale: dict[str, dict] = field(default_factory=dict)
    # The score the résumé had BEFORE this run. ats_score above is the after.
    # The pipeline always computed both (it logs "ats %d -> %d"); returning
    # the pair makes the lift measurable instead of only greppable.
    ats_score_before: int = 0
    # The JD analysis this run used. Returned so the caller can persist it the
    # way /ai/analyze does — POST /ai/project-score needs a cached Agent 1
    # parse and 409s without one, which silently froze the review screen's
    # live score for every JD that was tailored but never analyzed.
    jd_analysis: "JDAnalysis | None" = None
    # {"before": ..., "after": ...} semantic verdicts — persisted so the
    # review's live score can credit each kept rewrite (see project-score).
    score_verdicts: dict = field(default_factory=dict)


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


# Bump when a prompt or pipeline change should stop old results being reused.
# 2: sessions now store score_verdicts and per-rewrite score_delta; version-1
#    results lack both, so reusing them froze the review's live score.
TAILOR_PIPELINE_VERSION = "2"


def tailor_fingerprint(
    resume_content: dict,
    jd_text: str,
    humanize_level: int,
    priority_skills: list[str] | None,
    company_name: str | None,
) -> str:
    """Identity of a tailoring run's inputs. The model takes no temperature
    or seed, so re-running identical inputs rewords every time; routers/ai.py
    reuses a completed session with the same fingerprint instead. Key order,
    priority-skill order/case and surrounding whitespace are not inputs."""
    payload = {
        "v": TAILOR_PIPELINE_VERSION,
        "resume": resume_content,
        "jd": (jd_text or "").strip(),
        "humanize": humanize_level,
        "priority": sorted({s.strip().lower() for s in (priority_skills or []) if s.strip()}),
        "company": (company_name or "").strip().lower(),
    }
    blob = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


async def run_tailoring_pipeline(
    resume_content: dict,
    jd_text: str,
    humanize_level: int,
    provider: AIProvider,
    db: AsyncSession,  # unused since prep questions became lazy; kept for call-signature stability
    company_name: str | None = None,
    priority_skills: list[str] | None = None,
    cached_jd_analysis: "JDAnalysis | None" = None,
    cached_semantic_verdicts: "dict[str, str] | None" = None,
) -> TailoringResult:
    """
    Full pipeline — the "Tailor Resume" step. Re-runs analyze_jd_match (cheap,
    fast-model calls) and continues into the resume-rewriting agents:

    Agent 2 (premium) ─── semantic mapping of JD → resume bullets
         │
    Agent 3 (premium) ─── precision bullet rewrite
         │
    gap filler (fast) ─── speculative bullets/headline for remaining gaps

    Prep questions are NOT generated here — they're lazy (first view of the
    Interview Center); see get_or_generate_prep_questions and the
    GET /ai/sessions/{id}/questions endpoint.

    priority_skills — keywords the user explicitly picked (e.g. from the JD
    Analyzer's "Not Matched" list) that they want the tailoring to prioritize.
    Passed to Agent 2 as a hint to weave them into bullets where plausible;
    guaranteed to appear in the returned suggested_skills regardless of
    whether Agent 2's prompt-following holds, via the merge below.

    cached_jd_analysis — pass a pre-computed JDAnalysis (no company-name
    variant) to skip Agent 1 and get a consistent skill list / ATS score.

    cached_semantic_verdicts — verdicts for the ORIGINAL resume from a previous
    analyze of the same resume text (routers/ai.py caches these per resume
    fingerprint). Applied only to the pre-tailoring analysis; the post-tailoring
    one always re-verifies, since the whole point is that the resume changed.
    Pinning Agent 1 alone still left ats_score_before swinging up to 10 points
    between identical runs, because this second model call re-ran each time —
    which made controlled prompt A/Bs impossible. See evals/README.md.
    """
    analysis = await analyze_jd_match(
        resume_content, jd_text, provider, company_name,
        cached_jd_analysis=cached_jd_analysis,
        cached_semantic_verdicts=cached_semantic_verdicts,
    )

    # ── assign bullet IDs, build indexed resume for Agent 2 ──────────────────
    indexed_resume, _ = _index_bullets(resume_content)

    # ── Agent 2 — semantic mapping (pro model) ────────────────────────────────
    mapping_plan = await _agent2_semantic_map(
        analysis.jd_analysis, indexed_resume, provider, priority_skills=priority_skills,
    )

    # ── Agent 3 — precision bullet rewrite ──────────────────────────────────
    original_skills = resume_content.get("skills", [])

    tailored_raw = await _agent3_write(
        mapping_plan, original_skills, humanize_level, provider,
        seniority_indicators=analysis.jd_analysis.seniority_indicators,
    )

    # Prep questions are generated lazily on first view in the Interview
    # Center (GET /ai/sessions/{id}/questions), not here: most tailor runs
    # are never followed by interview prep, and that generation call is
    # ~15-20% of a run's tokens. This pipeline no longer needs `db`.
    questions: list[PrepQuestionData] = []

    # ── fact-lock Agent 3's output, then patch it back in ───────────────────
    # Rules 2, 7 and 8 of the Agent 3 prompt are promises; this is the check.
    # A rewrite that fabricates a metric, drops one Agent 2 flagged to keep,
    # runs past the word cap, or reaches for banned filler is reverted to the
    # candidate's own text before it ever reaches the résumé.
    # And a rewrite that claims one of the JD's tools the résumé never
    # mentions anywhere — the prompt forbids it; this makes it certain.
    guarded, reverted_bullets = _guard_writer_output(
        indexed_resume, tailored_raw, mapping_plan,
        tool_terms=analysis.jd_analysis.exact_technical_tools,
        evidence_text=build_resume_text(resume_content)[0],
    )
    if reverted_bullets:
        logger.warning(
            "fact-lock reverted %d/%d rewritten bullet(s): %s",
            len(reverted_bullets), len(tailored_raw.rewritten_bullets),
            [(r["bullet_id"], r["reasons"]) for r in reverted_bullets],
        )
    tailored_content = _apply_writer_output(indexed_resume, guarded, mapping_plan)

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
    n_bullets = len(_collect_all_bullets(resume_content))
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
    # skill fixes: every missing skill + Agent 2's plausible-to-add set.
    # Plausible skills (evidenced by the résumé) and the user's own priority
    # picks start accepted — with everything off, the "after" score measured
    # rewording alone. A skill that is merely missing still waits for a yes.
    plausible = _sanitize_skill_list(mapping_plan.plausible_skills_to_add)
    vouched = {s.strip().lower() for s in plausible + _sanitize_skill_list(priority_skills or [])}
    # Shape-checked and de-duplicated against the résumé together: missing_skills
    # is raw JD phrasing, and offering a skill the résumé already lists put the
    # same name in both halves of the Skills card.
    skill_names = skill_candidates(
        missing=list(post.missing_skills),
        plausible=plausible,
        existing=list(tailored_content.get("skills") or []),
    )
    for name in skill_names:
        k = name.strip().lower()
        fixes.append(AtsFix(
            id=fix_slug("skill", name), type="skill", gap=name,
            importance=_imp(name), grounded=True, text=name,
            default_accept=k in vouched,
        ))
    # bullet fixes from the gap filler. These are always speculative (new
    # content the résumé lacks) — never a reword of an existing bullet, so
    # accepting one can't duplicate what's already there. Pin it to the
    # most-recent role (index 0); the review UI lets the user move it. Skip
    # any that still restate an existing bullet as a belt-and-braces guard.
    all_bullets = _collect_all_bullets(tailored_content)
    n_roles = len(tailored_content.get("experience") or [])
    for b in gap_out.bullets:
        if bullet_already_present(all_bullets, b.bullet_text):
            continue
        exp_idx = 0 if n_roles > 0 else None
        fixes.append(AtsFix(
            id=fix_slug("bullet", b.gap), type="bullet", gap=b.gap,
            importance=_imp(b.gap), grounded=False, text=b.bullet_text,
            experience_index=exp_idx, default_accept=False,
        ))
    # headline fix
    if gap_out.headline.strip():
        fixes.append(AtsFix(
            id="headline:job-title", type="headline", gap="job title",
            importance=_imp("job title"), grounded=False,
            text=gap_out.headline.strip(), default_accept=False,
        ))

    bullet_importance: dict[str, str] = {}
    bullet_rationale: dict[str, dict] = {}
    for m in mapping_plan.mapping_plan:
        responsibility = (m.jd_responsibility_addressed or "").strip()
        keywords = [k.strip() for k in (m.target_jd_keywords_to_inject or []) if k and k.strip()]
        terms = [t for t in ([responsibility] + keywords) if t]
        if terms:
            bullet_importance[m.original_bullet_id] = _max_importance([_imp(t) for t in terms])
            bullet_rationale[m.original_bullet_id] = {
                "responsibility": responsibility,
                "keywords": keywords,
            }

    # ── one scoring model for the whole review ──────────────────────────────
    # The review re-scores the user's picks with verdicts_with_rewrites: the
    # before-verdicts, upgraded for each kept rewrite on exactly the terms it
    # targeted. The score returned here and every "+N pts" use that same
    # model, so ticking everything lands on this number and unticking all
    # rewrites lands on the before-score.
    before_verdicts = dict(analysis.semantic_verdicts)
    after_verdicts = dict(post.semantic_verdicts)
    rewritten_ids = [
        bid for bid in bullet_rationale
        if _bullet_text(tailored_content, bid) not in (None, _bullet_text(resume_content, bid))
    ]
    full_verdicts = verdicts_with_rewrites(before_verdicts, after_verdicts, bullet_rationale, rewritten_ids)
    full_score = score_content(tailored_content, analysis.jd_analysis, full_verdicts).ats_score
    for bid in rewritten_ids:
        without = score_content(
            _with_bullet(tailored_content, bid, _bullet_text(resume_content, bid) or ""),
            analysis.jd_analysis,
            verdicts_with_rewrites(
                before_verdicts, after_verdicts, bullet_rationale,
                [b for b in rewritten_ids if b != bid],
            ),
        ).ats_score
        bullet_rationale[bid]["score_delta"] = max(0, full_score - without)

    for f in fixes:
        f.score_delta = estimate_fix_delta(
            tailored_content, analysis.jd_analysis, full_verdicts, full_score, f,
        )
    fixes.sort(key=lambda f: (_IMPORTANCE_RANK[f.importance], -f.score_delta))

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
        ats_score=full_score,
        prep_questions=questions,
        company_keywords=post.company_keywords,
        suggested_skills=suggested,
        ats_fixes=fixes,
        bullet_importance=bullet_importance,
        reverted_bullets=reverted_bullets,
        bullet_rationale=bullet_rationale,
        ats_score_before=analysis.ats_score,
        jd_analysis=analysis.jd_analysis,
        # Everything project-score needs to re-score this run: the verdicts,
        # and the JD parse itself for runs that never cached one on the JD.
        score_verdicts={
            "before": before_verdicts,
            "after": after_verdicts,
            "jd_analysis": analysis.jd_analysis.model_dump(),
        },
    )

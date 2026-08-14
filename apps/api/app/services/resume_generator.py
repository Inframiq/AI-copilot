"""AI resume generation pipeline.

Unlike tailoring.py (which only rewrites existing bullets against a JD),
this builds a full resume from a raw, unbounded candidate profile. The
goal is NOT to use all available candidate information — it is to select
the smallest set of strong, evidence-backed content that presents the
candidate well, then write it tightly and validate it against the hard
limits in resume_spec.py.

Pipeline:
  1. Relevance classification (AI)  — tag every candidate item CORE/
     SUPPORTING/OPTIONAL/EXCLUDE relative to the target role.
  2. Deterministic selection        — cap counts per resume_spec.HARD_LIMITS,
     always preferring higher-tier items, never padding to reach a cap.
  3. Evidence-bound bullet writing (AI) — rewrite only the selected bullets;
     forbidden to add facts not present in the raw text.
  4. Summary/objective + headline writing (AI) — or omit if neither adds
     real information.
  5. Assembly into a ResumeContent-shaped dict with a resolved section_order.
  6. Deterministic validation (resume_validator) + a bounded compression
     loop that targets exactly the violations reported, never touching
     content that wasn't flagged.
"""
import json
import logging
import re
from copy import deepcopy
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel

from app.services.ai_engine.base import AIProvider
from app.services.resume_spec import (
    BANNED_GENERIC_PHRASES,
    CandidateType,
    HARD_LIMITS,
    resolve_section_order,
)
from app.services.resume_validator import Violation, ValidationResult, validate_resume

logger = logging.getLogger("app")

_MAX_COMPRESSION_ROUNDS = 4

_LIST_KEYS = {
    "certifications": "cert",
    "achievements": "achievement",
    "awards": "award",
    "leadership": "leadership",
    "volunteer": "volunteer",
}

_TIER_RANK = {"CORE": 0, "SUPPORTING": 1, "OPTIONAL": 2, "EXCLUDE": 3}


# ── Pydantic I/O models ─────────────────────────────────────────────────────

class RelevanceTier(BaseModel):
    item_id: str
    tier: Literal["CORE", "SUPPORTING", "OPTIONAL", "EXCLUDE"]


class SelectionPlan(BaseModel):
    """Output of the relevance-classification agent."""
    tiers: list[RelevanceTier]


class RewrittenItem(BaseModel):
    item_id: str
    text: str


class WrittenBullets(BaseModel):
    """Output of the bullet-writing agent."""
    bullets: list[RewrittenItem]


class SummaryPlan(BaseModel):
    headline: str = ""
    kind: Literal["summary", "objective", "none"]
    text: str = ""


@dataclass
class GenerationResult:
    resume_content: dict
    validation: ValidationResult
    candidate_type: CandidateType


# ── Item indexing ────────────────────────────────────────────────────────────

def _index_profile(profile: dict) -> dict[str, str]:
    """Flatten every classifiable candidate item into {item_id: raw_text}.
    Experience is indexed per bullet (fine-grained); projects and the
    plain-list sections are indexed as whole items (coarse-grained) since
    the spec selects whole projects/certifications, not individual lines
    within them."""
    items: dict[str, str] = {}
    for i, job in enumerate(profile.get("experience") or []):
        for j, b in enumerate(job.get("bullets") or []):
            items[f"exp{i}_b{j}"] = b
    for i, p in enumerate(profile.get("projects") or []):
        items[f"project{i}"] = f"{p.get('name', '')}: " + " | ".join(p.get("bullets") or [])
    for key, prefix in _LIST_KEYS.items():
        for i, text in enumerate(profile.get(key) or []):
            items[f"{prefix}{i}"] = text
    return items


def _rank_and_cap(ids: list[str], tiers: dict[str, str], cap: int, min_keep: int = 0) -> list[int]:
    """Return original-order indices to keep. EXCLUDE-tier items are always
    dropped. Only CORE/SUPPORTING items are kept by default — OPTIONAL
    items are backfilled only if that's not enough to reach `min_keep` (a
    section is never left emptier than the raw material actually allows).
    Result is capped at `cap` and never padded up to it."""
    ranked = sorted(range(len(ids)), key=lambda idx: _TIER_RANK.get(tiers.get(ids[idx], "SUPPORTING"), 1))
    non_exclude = [idx for idx in ranked if tiers.get(ids[idx], "SUPPORTING") != "EXCLUDE"]
    strong = [idx for idx in non_exclude if tiers.get(ids[idx], "SUPPORTING") in ("CORE", "SUPPORTING")]
    kept = strong if len(strong) >= min_keep else non_exclude[: max(min_keep, len(strong))]
    return sorted(kept[:cap])


def _cap_skills(skills):
    cat_max = HARD_LIMITS["skill_categories"]["max"]
    per_cat_max = HARD_LIMITS["skills_per_category"]["max"]
    if isinstance(skills, dict):
        return {cat: list(items)[:per_cat_max] for cat, items in list(skills.items())[:cat_max]}
    if isinstance(skills, list):
        return skills[: cat_max * per_cat_max]
    return skills or []


# ── Agent: relevance classification ──────────────────────────────────────────

_SELECTOR_SYSTEM = """\
<system_role>
You are a resume content strategist. Classify every piece of candidate
content below by how much it strengthens an application for the stated
target role.
</system_role>

<rules>
1. Classify each item_id as exactly one of: CORE, SUPPORTING, OPTIONAL, EXCLUDE.
2. CORE: directly relevant to the target role, strong evidence, high impact,
recent, or unique — the resume is meaningfully weaker without it.
3. SUPPORTING: relevant but secondary — worth including if space allows.
4. OPTIONAL: tangential, generic, dated, or weakly evidenced.
5. EXCLUDE: irrelevant to the target role, redundant with a stronger item,
or too vague to help the candidate.
6. Judge by: target-role relevance, evidence strength, technical/professional
depth, impact, recency, and uniqueness — never by length or wording quality.
7. Classify every item_id given — do not omit any.
8. Output ONLY valid JSON matching the schema. No markdown, no preamble.
</rules>

<output_schema>
{"tiers": [{"item_id": "string", "tier": "CORE|SUPPORTING|OPTIONAL|EXCLUDE"}]}
</output_schema>"""


async def _classify_relevance(
    items: dict[str, str], target_role: str, jd_text: str | None, provider: AIProvider
) -> SelectionPlan:
    payload = {"target_role": target_role, "job_description": jd_text or "", "items": items}
    return await provider.complete_structured(
        _SELECTOR_SYSTEM, json.dumps(payload), SelectionPlan, model_tier="pro"
    )


# ── Agent: evidence-bound bullet writer ──────────────────────────────────────

def _build_writer_system() -> str:
    bw = HARD_LIMITS["bullet_words"]
    banned = ", ".join(f'"{p}"' for p in BANNED_GENERIC_PHRASES)
    return f"""\
<system_role>
You are an elite technical resume writer. Rewrite each candidate item below
into one polished, evidence-bound resume bullet.
</system_role>

<rules>
1. FACT LOCK — NEVER FABRICATE: use only facts, numbers, tools, and outcomes
already present in the item's raw text. Do not invent a metric, percentage,
user count, team size, tool, technology, responsibility, or outcome that
isn't there. If there is no metric, your rewrite must not gain one.
2. STRUCTURE: [Action verb] + [what was done] + [technology/method] +
[result/impact, only if the raw text supports it].
3. LENGTH: target {bw["prefer_min"]}-{bw["prefer_max"]} words. {bw["max"]}
words is the absolute hard maximum — cut, don't wrap, a bullet that runs long.
4. BANNED WORDING: never use {banned} unless the raw text already uses one
verbatim and removing it would lose meaning.
5. Rewrite every item_id given — do not omit any.
6. Output ONLY valid JSON matching the schema. No markdown, no preamble.
</rules>

<output_schema>
{{"bullets": [{{"item_id": "string", "text": "string"}}]}}
</output_schema>"""


async def _write_bullets(items: dict[str, str], provider: AIProvider) -> WrittenBullets:
    return await provider.complete_structured(
        _build_writer_system(), json.dumps(items), WrittenBullets, model_tier="pro"
    )


# ── Agent: summary/objective/headline writer ─────────────────────────────────

_SUMMARY_SYSTEM = """\
<system_role>
You are an expert resume writer producing the top-of-resume summary block.
</system_role>

<rules>
1. Optionally propose a one-line headline (job title / specialization) —
leave it empty if nothing meaningfully specific can be said. Never make it
just the candidate's current/most recent job title restated verbatim or
near-verbatim — that title is already shown in Experience, so repeating it
here adds no information. Only propose a headline if it adds something
Experience doesn't already say on its own: a specialization, industry
focus, or scope ("Sr. Business Analyst — Data & Process Automation", not
"Sr. Business Analyst").
2. Choose exactly one "kind": "summary" (an experienced candidate, or a
fresher with enough evidence for one), "objective" (a fresher with a clear
target and not enough experience for a summary), or "none" — use "none"
whenever neither would add real information beyond what's already visible
in Experience/Projects/Education. Never write generic career-objective
language just to fill the slot.
3. Summary: 40-80 words. Objective: 25-50 words. Base every claim strictly
on the selected_content provided — never invent skills, experience, or
achievements not present there.
4. Never use generic filler: passionate, motivated, hardworking,
results-driven, dynamic, team player, self-starter, seamless, synergy, etc.
5. Output ONLY valid JSON matching the schema. No markdown, no preamble.
</rules>

<output_schema>
{"headline": "string", "kind": "summary|objective|none", "text": "string"}
</output_schema>"""


async def _write_summary(
    candidate_type: CandidateType, target_role: str, selected_content: dict, provider: AIProvider
) -> SummaryPlan:
    payload = {
        "candidate_type": candidate_type,
        "target_role": target_role,
        "selected_content": selected_content,
    }
    return await provider.complete_structured(
        _SUMMARY_SYSTEM, json.dumps(payload), SummaryPlan, model_tier="pro"
    )


# ── Compression pass (targets only the reported violations) ─────────────────

def _find_container(content: dict, section_label: str) -> dict | None:
    if section_label.startswith("Experience ("):
        name = section_label[len("Experience ("):-1]
        return next((j for j in content.get("experience", []) if j.get("company") == name), None)
    if section_label.startswith("Project ("):
        name = section_label[len("Project ("):-1]
        return next((p for p in content.get("projects", []) if p.get("name") == name), None)
    return None


def _strip_phrase_everywhere(content: dict, phrase: str) -> None:
    pattern = re.compile(re.escape(phrase), re.IGNORECASE)

    def clean(text: str) -> str:
        return re.sub(r"\s{2,}", " ", pattern.sub("", text)).strip(" ,")

    for job in content.get("experience", []):
        job["bullets"] = [clean(b) for b in job.get("bullets", [])]
    for p in content.get("projects", []):
        p["bullets"] = [clean(b) for b in p.get("bullets", [])]


def _truncate_named_bullet(content: dict, section: str, issue: str) -> None:
    container = _find_container(content, section)
    if not container:
        return
    quoted = issue.split('"', 1)[1].rsplit('"', 1)[0]
    prefix = quoted[:-3] if quoted.endswith("...") else quoted
    max_words = HARD_LIMITS["bullet_words"]["max"]
    bullets = container.get("bullets") or []
    for i, b in enumerate(bullets):
        if b.startswith(prefix):
            words = b.split()
            if len(words) > max_words:
                bullets[i] = " ".join(words[:max_words])
            break


def _drop_second_duplicate(content: dict, issue: str) -> None:
    m = re.match(r'"(.*?)\.\.\.?" \((.*?)\) duplicates', issue)
    if not m:
        return
    prefix, label = m.group(1), m.group(2)
    container = _find_container(content, label)
    if not container:
        return
    bullets = container.get("bullets") or []
    for i, b in enumerate(bullets):
        if b.startswith(prefix):
            del bullets[i]
            break


def _shrink_skills(content: dict, section: str) -> None:
    skills = content.get("skills")
    cat_max = HARD_LIMITS["skill_categories"]["max"]
    per_cat_max = HARD_LIMITS["skills_per_category"]["max"]
    if section == "Skills":
        if isinstance(skills, dict):
            content["skills"] = dict(list(skills.items())[:cat_max])
        elif isinstance(skills, list):
            content["skills"] = skills[: cat_max * per_cat_max]
    elif section.startswith("Skills (") and isinstance(skills, dict):
        cat = section[len("Skills ("):-1]
        if cat in skills:
            skills[cat] = skills[cat][:per_cat_max]


def _drop_empty(content: dict, section: str) -> None:
    if section.startswith("Experience ("):
        name = section[len("Experience ("):-1]
        content["experience"] = [j for j in content.get("experience", []) if j.get("company") != name]
    elif section.startswith("Project ("):
        name = section[len("Project ("):-1]
        content["projects"] = [p for p in content.get("projects", []) if p.get("name") != name]


def _truncate_headline(content: dict) -> None:
    max_words = HARD_LIMITS["headline"]["max_words"]
    words = (content.get("headline") or "").replace("\n", " ").split()
    content["headline"] = " ".join(words[:max_words])


def _truncate_summary_or_objective(content: dict, section: str) -> None:
    # section is "Summary" or "Objective" (see resume_validator.py) — matches
    # the corresponding lowercase content key one-to-one.
    key = section.lower()
    max_words = HARD_LIMITS[key]["max_words"]
    words = (content.get(key) or "").split()
    if len(words) > max_words:
        content[key] = " ".join(words[:max_words]).rstrip(",;:") + "."


def _reduce_for_page_overflow(content: dict) -> None:
    """Priority per spec: drop weak optional sections first, then the
    weakest (last-ranked) project, then shorten the single longest bullet.
    Never removes high-value evidence — only ever touches one thing per
    call, letting the surrounding compression loop re-check afterward."""
    for key in ("volunteer", "awards", "languages"):
        if content.get(key):
            content[key] = []
            return
    projects = content.get("projects") or []
    if len(projects) > HARD_LIMITS["projects"]["prefer_min"]:
        projects.pop()
        return
    longest_len, longest = 0, None
    for job in content.get("experience", []):
        for i, b in enumerate(job.get("bullets") or []):
            if len(b.split()) > longest_len:
                longest_len, longest = len(b.split()), (job, i)
    for p in content.get("projects", []):
        for i, b in enumerate(p.get("bullets") or []):
            if len(b.split()) > longest_len:
                longest_len, longest = len(b.split()), (p, i)
    if longest:
        container, i = longest
        words = container["bullets"][i].split()
        cut = max(HARD_LIMITS["bullet_words"]["prefer_min"], len(words) - 5)
        container["bullets"][i] = " ".join(words[:cut])


def _compress(content: dict, violations: list[Violation]) -> dict:
    """One compression pass. Walks the exact violations reported this
    round and applies the spec's priority order — generic wording, then
    duplicates, then bullet length, then skills/section overflow, then
    page-overflow content removal — touching only what was flagged."""
    content = deepcopy(content)
    for v in violations:
        issue, section = v.issue, v.section
        if "generic filler phrase" in issue:
            _strip_phrase_everywhere(content, issue.split('"')[1])
        elif section == "Duplicate content":
            _drop_second_duplicate(content, issue)
        elif "bullet is" in issue and "words" in issue:
            _truncate_named_bullet(content, section, issue)
        elif section.startswith("Skills"):
            _shrink_skills(content, section)
        elif section in ("Certifications", "Achievements", "Awards", "Leadership", "Volunteer"):
            key = section.lower()
            content[key] = (content.get(key) or [])[: HARD_LIMITS[key]["max"]]
        elif section == "Education":
            content["education"] = (content.get("education") or [])[: HARD_LIMITS["education_entries"]["max"]]
        elif section == "Projects" and "projects" in issue:
            content["projects"] = (content.get("projects") or [])[: HARD_LIMITS["projects"]["max"]]
        elif "empty section" in issue:
            _drop_empty(content, section)
        elif section == "Headline":
            _truncate_headline(content)
        elif section in ("Summary", "Objective") and "below minimum" not in issue:
            _truncate_summary_or_objective(content, section)
        elif section == "Page count":
            _reduce_for_page_overflow(content)
    return content


# ── Public entry point ───────────────────────────────────────────────────────

async def generate_resume(
    profile: dict,
    candidate_type: CandidateType,
    provider: AIProvider,
    target_role: str = "",
    jd_text: str | None = None,
    template_id: str = "ats_clean",
) -> GenerationResult:
    """Build a full, spec-compliant resume from a raw candidate profile.

    profile is a superset of ResumeContent with no size limits — the
    candidate's full history. This never uses all of it: only the smallest
    set of CORE/strong-SUPPORTING content survives selection.
    """
    items = _index_profile(profile)
    tiers: dict[str, str] = {}
    if items:
        plan = await _classify_relevance(items, target_role, jd_text, provider)
        tiers = {t.item_id: t.tier for t in plan.tiers}

    # ── deterministic selection under HARD_LIMITS — never padding ───────────
    experience = deepcopy(profile.get("experience") or [])
    exp_limits = HARD_LIMITS["experience_bullets_per_role"]
    exp_cap = min(exp_limits["prefer_max"], exp_limits["max"])
    exp_min = exp_limits["min"]
    for i, job in enumerate(experience):
        bullets = job.get("bullets") or []
        ids = [f"exp{i}_b{j}" for j in range(len(bullets))]
        keep = _rank_and_cap(ids, tiers, exp_cap, min_keep=min(exp_min, len(bullets)))
        job["bullets"] = [bullets[k] for k in keep]
        job["_bullet_ids"] = [ids[k] for k in keep]
    experience = [job for job in experience if job.get("bullets")]

    projects_raw = profile.get("projects") or []
    proj_ids = [f"project{i}" for i in range(len(projects_raw))]
    proj_limits = HARD_LIMITS["projects"]
    proj_bullet_max = HARD_LIMITS["project_bullets"]["max"]
    projects = []
    for k in _rank_and_cap(proj_ids, tiers, proj_limits["max"]):
        p = deepcopy(projects_raw[k])
        p["bullets"] = (p.get("bullets") or [])[:proj_bullet_max]
        p["_item_id"] = proj_ids[k]
        if p["bullets"]:
            projects.append(p)

    def _select_list(key: str, prefix: str) -> list[str]:
        raw = profile.get(key) or []
        ids = [f"{prefix}{i}" for i in range(len(raw))]
        keep = _rank_and_cap(ids, tiers, HARD_LIMITS[key]["max"])
        return [raw[k] for k in keep]

    certifications = _select_list("certifications", "cert")
    achievements = _select_list("achievements", "achievement")
    awards = _select_list("awards", "award")
    leadership = _select_list("leadership", "leadership")
    volunteer = _select_list("volunteer", "volunteer")

    # ── evidence-bound bullet rewrite (prose bullets only) ───────────────────
    to_write: dict[str, str] = {}
    for job in experience:
        for bid, text in zip(job["_bullet_ids"], job["bullets"]):
            to_write[bid] = text
    for p in projects:
        for j, text in enumerate(p["bullets"]):
            to_write[f"{p['_item_id']}_b{j}"] = text

    if to_write:
        written = await _write_bullets(to_write, provider)
        rewrite_map = {w.item_id: w.text for w in written.bullets}
        for job in experience:
            job["bullets"] = [rewrite_map.get(bid, text) for bid, text in zip(job["_bullet_ids"], job["bullets"])]
            del job["_bullet_ids"]
        for p in projects:
            p["bullets"] = [rewrite_map.get(f"{p['_item_id']}_b{j}", text) for j, text in enumerate(p["bullets"])]
            del p["_item_id"]
    else:
        for job in experience:
            job.pop("_bullet_ids", None)
        for p in projects:
            p.pop("_item_id", None)

    assembled: dict = {
        "contact": profile.get("contact") or {},
        "headline": (profile.get("headline") or "").strip(),
        "experience": experience,
        "projects": projects,
        "education": (profile.get("education") or [])[: HARD_LIMITS["education_entries"]["max"]],
        "skills": _cap_skills(profile.get("skills")),
        "certifications": certifications,
        "achievements": achievements,
        "awards": awards,
        "leadership": leadership,
        "volunteer": volunteer,
        "languages": profile.get("languages") or [],
    }

    summary_plan = await _write_summary(candidate_type, target_role, assembled, provider)
    if summary_plan.kind == "summary":
        assembled["summary"] = summary_plan.text.strip()
    elif summary_plan.kind == "objective":
        assembled["objective"] = summary_plan.text.strip()
    if summary_plan.headline.strip() and not assembled["headline"]:
        assembled["headline"] = summary_plan.headline.strip()

    assembled["section_order"] = resolve_section_order(candidate_type, assembled)
    result = validate_resume(assembled, candidate_type, template_id)

    rounds = 0
    while not result.valid and rounds < _MAX_COMPRESSION_ROUNDS:
        assembled = _compress(assembled, result.violations)
        assembled["section_order"] = resolve_section_order(candidate_type, assembled)
        result = validate_resume(assembled, candidate_type, template_id)
        rounds += 1

    if not result.valid:
        logger.warning(
            "generate_resume: %d violation(s) remain after %d compression rounds: %s",
            len(result.violations), rounds, result.to_dict(),
        )

    return GenerationResult(resume_content=assembled, validation=result, candidate_type=candidate_type)

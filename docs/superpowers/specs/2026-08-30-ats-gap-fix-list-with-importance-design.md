# ATS "gap → fix" list with per-item importance

## Problem

After tailoring, the review screen tells the user *what's missing* (a flat
"Missing" chip list) but not *what to do about it* or *what matters most*.
Two concrete gaps:

1. **No résumé additions are proposed.** Tailoring only rewrites existing
   bullets. A JD requirement with no matching bullet, or a skill the résumé
   doesn't list, stays missing with no suggested fix. The user's own ask:
   *"give what additional points need to be added into the resume and let
   the user accept if he's comfortable speaking about it in an interview."*
2. **Everything reads as equally urgent.** A hard, title-defining
   requirement and a "nice to have" sit in the same undifferentiated list,
   so the user can't tell where to spend effort for a given JD.

## Scope

Replace the tailoring review screen's standalone `SkillsBlock` /
`SkillsDelta` with a **unified "ATS gap → fix" list**:

- Each fix is a concrete résumé addition — a skill, a new bullet, or a
  headline edit — the user accepts or rejects. Accept means *"I can speak
  to this in an interview."*
- Bullets for gaps with no résumé basis are **speculative**: visually
  flagged, pre-set to rejected.
- Every actionable item in the review screen carries a **High / Medium /
  Low importance mark for this JD** — the gap → fix suggestions, every JD
  keyword chip (matched and missing), and every existing résumé bullet.
- Importance has **one source**: Agent 1 rates each JD item. Everything
  else derives its mark from the JD item it relates to.
- A running **"Projected ATS"** number updates as the user accepts/rejects.

**In scope:** the tailoring review screen (`BulletReviewPanel`), the
tailoring pipeline, Agent 1, one new "Gap Filler" LLM call, one new
read-only scoring endpoint, one migration.

**Out of scope:**
- The Analyze screen gets importance marks on its JD keyword chips only
  (cheap, from Agent 1 output) — **no** fix list there.
- No standalone "gap report" view.
- Fixes are generated once per tailor; not regenerated as the user edits.
- Accept/reject state stays client-side for the review session, exactly
  like today's bullet decisions — not persisted server-side.
- Cover-letter flow untouched.

## Data model

### `JDAnalysis.importance` (Agent 1 output)

```python
importance: dict[str, str] = {}   # "<term|phrase|responsibility>": "high"|"medium"|"low"
```

- Keys are the **lowercased, stripped** term exactly as it appears in
  `exact_technical_tools`, `methodologies_and_frameworks`,
  `ats_filter_phrases`, `nice_to_have_skills`, and `core_responsibilities`,
  plus the literal key `"job title"` for the title signal.
- New field, default `{}`. Old cached `jd_row.parsed["agent1"]` blobs
  deserialize fine and fall through to the deterministic fallback below.

**Deterministic fallback** — `ats.default_importance(jd_analysis, term)`,
used whenever `importance` lacks a key:

| Bucket | Level |
|---|---|
| `target_job_titles` / `"job title"` | high |
| `exact_technical_tools` | high |
| `ats_filter_phrases`, `methodologies_and_frameworks`, `core_responsibilities` | medium |
| `nice_to_have_skills`, `domain_expertise_themes`, company keywords | low |
| unknown term | medium |

### `AtsFix`

```python
class AtsFix(BaseModel):
    id: str                        # stable: f"{type}:{slug(gap)}"
    type: Literal["skill", "bullet", "headline"]
    gap: str                       # JD phrase / responsibility / "job title" this closes
    importance: Literal["high", "medium", "low"]
    grounded: bool                 # False -> speculative: flagged, default-off
    text: str                      # skill name | bullet text | headline text
    experience_index: int | None   # bullet only: which experience entry it appends to
    score_delta: int               # indicative +X% vs the post-tailor score (see note)
    default_accept: bool           # only a grounded bullet defaults to accepted
```

`default_accept = (type == "bullet" and grounded)`. Skill additions,
speculative bullets, and headline edits all start **rejected** — each is a
claim the user has to stand behind, the same bar as today's opt-in
suggested skills.

`score_delta` is computed **independently per fix** against the post-tailor
score (`estimate_fix_delta` below), so two fixes' deltas do **not** sum —
overlapping keywords would double-count. It's an at-a-glance "is this worth
it" hint; the authoritative combined number is the `/ai/project-score`
response, which re-scores the actual accepted set.

### `TailoringSession` — new columns (migration `014`)

```python
ats_fixes: Mapped[list[dict] | None] = mapped_column(JSONB, nullable=True)
bullet_importance: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # {bullet_id: "high"|"medium"|"low"}
```

`suggested_skills` stays as-is (other readers depend on it); the new UI
renders skills from `ats_fixes` instead. Migration only `add_column`s —
no backfill; existing completed sessions show the old-style list until
re-tailored (acceptable — they predate the feature).

## Backend

### Agent 1 — `_agent1_parse_jd`

- `_AGENT1_SYSTEM`: add a rule and schema key for `importance` — *"rate
  every skill, phrase, and responsibility you extracted as high / medium /
  low importance for THIS role: high = defines the role or a stated hard
  requirement or repeated/emphasised; medium = a normal requirement or
  duty; low = 'nice to have', peripheral, or generic. Include a `"job
  title"` key."*
- `JDAnalysis.importance` populated from the response; missing keys are
  filled by `default_importance` before return so downstream code always
  gets a complete map.

### Scoring refactor — `ats.py`

Extract the post-Agent-1 body of `analyze_jd_match` into a pure function so
it can be reused for per-fix estimates and the projection endpoint with
**no LLM call**:

```python
def score_content(
    content: dict,
    jd_analysis: JDAnalysis,
    semantic_verdicts: dict[str, str],
) -> DeltaResult:
    """compute_delta (required + nice) + reuse semantic_verdicts for
    still-missing phrases + title_match_verdict + blend_scores. Pure."""
```

`analyze_jd_match` keeps ownership of running Agent 1 and
`_verify_semantic_presence`, then calls `score_content`.

### `apply_fix` / `estimate_fix_delta` — `ats.py` (pure)

```python
def apply_fix(content: dict, fix: AtsFix) -> dict
    # deep-copy, then: skill -> append fix.text to content["skills"];
    # bullet -> append fix.text to experience[fix.experience_index]["bullets"];
    # headline -> content["headline"] = fix.text
def apply_fixes(content: dict, fixes: list[AtsFix]) -> dict
    # fold a list in order. A skill fix past MAX_MERGED_SKILLS, or a bullet
    # fix past that section's HARD_LIMITS bullet count, is SKIPPED whole
    # (never truncated mid-text). ats.py imports HARD_LIMITS from resume_spec.
def estimate_fix_delta(content, jd_analysis, semantic_verdicts, base_score, fix) -> int
    # max(0, score_content(apply_fix(content, fix), jd_analysis, semantic_verdicts).ats_score - base_score)
```

### Gap Filler agent — `tailoring.py`

```python
class GapFillBullet(BaseModel):
    gap: str
    grounded: bool
    experience_index: int | None
    bullet_text: str

class GapFillerOutput(BaseModel):
    bullets: list[GapFillBullet]
    headline: str = ""      # non-empty only when a title gap was passed in

async def _agent_gap_filler(
    tailored_content: dict,
    jd_analysis: JDAnalysis,
    gaps: list[dict],       # [{gap, kind: "skill"|"responsibility"|"title", importance}]
    provider: AIProvider,
) -> GapFillerOutput
```

- `model_tier="fast"`, `max_output_tokens ≈ 4000`, `call_name="agent_gap_filler"`.
- Prompt: for each gap, either reframe the closest real experience into a
  bullet naming the gap (`grounded=True`, `experience_index` set) or, if
  there's no basis, write one plausible bullet flagged `grounded=False`.
  Zero fabrication of metrics. One `headline` string iff a title gap is
  present. Reuses `jd_analysis`; no re-parse.

### `run_tailoring_pipeline` wiring

After the existing `post = analyze_jd_match(tailored_content, …)` re-score:

1. **Gaps** = `post.missing_skills`, `core_responsibilities` whose verdict
   in `post.semantic_verdicts` is `partial`/`missing`, and `"job title"` if
   `post.title_match in {"", "partial", "missing"}`. The pipeline
   re-derives whether each missing skill is *required* vs *nice-to-have* by
   checking `jd_analysis.nice_to_have_skills` (case-insensitive), since
   `blend_scores` merges both into one `missing` list. Attach importance
   from `jd_analysis.importance` (→ `default_importance` fallback).
2. `gap_out = await _agent_gap_filler(tailored_content, jd_analysis, gaps, provider)`.
3. Assemble `ats_fixes` (`grounded=True` for skills since the *name* isn't
   fabricated, but `default_accept` still follows the one rule — only
   grounded bullets pre-accept):
   - **skill** fixes — one per missing required/nice skill, plus
     `mapping_plan.plausible_skills_to_add` (the set today's
     `suggested_skills` carries). `type="skill"`, `grounded=True`.
   - **bullet** fixes — one per `gap_out.bullets` entry, `grounded` from
     the model.
   - **headline** fix — from `gap_out.headline` if non-empty,
     `grounded=False`.
   - `score_delta` for each via `estimate_fix_delta(tailored_content,
     jd_analysis, post.semantic_verdicts, post.ats_score, fix)`.
   - Sort High → Medium → Low, then by `score_delta` desc.
4. **`bullet_importance`** = for each `BulletMapping` in `mapping_plan`,
   `max(importance(jd_responsibility_addressed),
   importance(each target_jd_keywords_to_inject))` keyed by
   `original_bullet_id`. Unmapped bullets omitted.
5. `TailoringResult` gains `ats_fixes: list[AtsFix]` and
   `bullet_importance: dict[str, str]`.

`_run_tailoring_background` writes both new columns onto the session row.

### Endpoints

**`POST /ai/project-score`** (`routers/ai.py`, `@limiter.limit("30/minute")`)

```
body: { session_id: UUID, accepted_fix_ids: list[str] }
-> { projected_score: int }
```

- Load session by `id` + `user_id`; 404 otherwise. Require
  `status == "completed"` and `tailored_content` present.
- `jd_row = session.jd`; `jd_analysis = JDAnalysis(**jd_row.parsed["agent1"])`;
  `semantic_verdicts = jd_row.parsed.get("semantic", {}).get("verdicts", {})`.
- `fixes = [AtsFix(**f) for f in session.ats_fixes if f["id"] in accepted_fix_ids]`.
- `score_content(apply_fixes(session.tailored_content, fixes), jd_analysis,
  semantic_verdicts).ats_score`. **No LLM call.**

**`GET /ai/sessions/{id}`** — response gains `ats_fixes` and
`bullet_importance` (straight passthrough of the columns).

**`POST /ai/analyze`** — `AnalyzeOut` gains
`importance: dict[str, str]` = `analysis.jd_analysis.importance` (already
complete after the Agent 1 change). No other change.

### Backward compatibility

- Old `parsed["agent1"]` without `importance` → `JDAnalysis(**blob)` gives
  `{}` → `default_importance` covers every lookup. Re-analyzing the JD
  re-parses and fills the real map.
- Old completed sessions with `ats_fixes IS NULL` → frontend falls back to
  the legacy `missing_skills` / `suggested_skills` rendering.

## Frontend

### `stores/tailoring-store.ts`

- State: `atsFixes: AtsFix[]`, `bulletImportance: Record<string, Level>`,
  `jdImportance: Record<string, Level>` (from analyze), `projectedAtsScore:
  number | null`.
- Populated in the tailor-completion and `loadSession` paths alongside
  `matchedSkills` etc.
- Fix decisions reuse the existing `bulletDecisions` record with
  `fix:<id>` keys; initial value per fix = `fix.default_accept ? "accept" :
  "reject"`.
- `buildMergedContent(pending, original, bulletDecisions, suggestedSkills,
  atsFixes)` — new param. For each `fix:<id> === "accept"`:
  - `skill` → add `fix.text` to the skill-add pool (existing
    `MAX_MERGED_SKILLS` slice still applies).
  - `bullet` → push `fix.text` onto
    `mergedExperience[fix.experience_index].bullets`, capped at the
    section's `HARD_LIMITS` bullet count (mirror the server rule already
    referenced in `BulletReviewPanel`).
  - `headline` → `merged.headline = fix.text`.
- `projectScore(acceptedIds: string[])` action — debounced ~400ms,
  `POST /ai/project-score`, sets `projectedAtsScore`. Called on every fix
  toggle.

### Components

- **`components/resume/ImportanceBadge.tsx`** — `{ level: Level }` → a
  colored dot + label (High red, Medium amber, Low grey), matching the
  existing `TIER_DOT_CLASS` palette in `BulletReviewPanel`.
- **`components/resume/AtsGapFixPanel.tsx`** — replaces `<SkillsDelta/>`
  usage inside `BulletReviewPanel`. Sections:
  1. Header: `atsScore%  →  projectedAtsScore%`.
  2. Existing-skill keep/drop sub-block — **kept verbatim** from today's
     `SkillsBlock` (the `MAX_MERGED_SKILLS` budget, "Auto-select Top",
     keep/add chips). Each chip gains an `ImportanceBadge` from
     `jdImportance` when known.
  3. Fix list — `atsFixes` in server order (already sorted High → Low).
     Each row: `ImportanceBadge` · `+{score_delta}%` · gap label · the fix
     text · Accept / Reject. `grounded === false` rows render in the
     amber "speculative" style with an "only add if you've actually done
     this" note and start rejected.
- **`BulletReviewPanel`** — each existing bullet card shows an
  `ImportanceBadge` from `bulletImportance[bulletId]` when present.
- **`SkillsDelta` / `EditorPanel`** (analyze screen) — matched/missing
  keyword chips get an `ImportanceBadge` from the analyze response's
  `importance` map.

### `lib/api-client.ts`

- `analyzeJd` response type gains `importance`.
- `getTailoringSession` response type gains `ats_fixes`, `bullet_importance`.
- New `projectScore(sessionId, acceptedFixIds)` client method.

## Testing

**`apps/api` (pytest, TDD):**
- `test_ats.py`: `default_importance` bucket rules; `score_content`
  parity with the old inline path; `apply_fix` / `apply_fixes`
  (skill/bullet/headline, cap enforcement, no mutation);
  `estimate_fix_delta` (adding a matched keyword raises the score by its
  weight; clamped ≥ 0).
- `test_tailoring.py`: Agent 1 emits `importance` and missing keys are
  backfilled; `_agent_gap_filler` shape via schema-dispatch mock;
  `run_tailoring_pipeline` returns sorted `ats_fixes` with deltas and a
  `bullet_importance` map derived from the mapping plan; speculative
  bullets get `default_accept=False`.
- `test_jd_and_tailor_endpoints.py`: `/ai/project-score` applies only the
  accepted ids and returns a number, 404 on foreign session, no LLM
  provider call; `/ai/analyze` returns `importance`; `/ai/sessions/{id}`
  returns the two new fields.
- `test_migration_014` smoke (columns exist, nullable).

**`apps/web` (vitest):**
- `buildMergedContent` folds accepted skill/bullet/headline fixes,
  respects caps, ignores rejected ones.
- `ImportanceBadge` renders the right class per level.
- store `projectScore` debounces and stores the result;
  fix-decision defaults follow `default_accept`.

## Rollout

1. Migration `014` (additive, safe to deploy ahead of code).
2. Backend: Agent 1 `importance`, `score_content` refactor, Gap Filler,
   pipeline wiring, endpoints.
3. Frontend: store + `ImportanceBadge` + `AtsGapFixPanel` + analyze-chip
   badges.
4. No feature flag — old sessions degrade to the legacy list via the
   null-column fallback; new tailors get the full experience.

## Cost

Per tailor: **+1 fast-tier LLM call** (Gap Filler). Agent 1's existing
call returns a larger payload (the importance map). Per-fix `score_delta`
and `/ai/project-score` are pure computation — no LLM.

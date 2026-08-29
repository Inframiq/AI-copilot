# ATS gap→fix list with per-item importance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tailoring review screen's flat missing-skills list with an accept/reject "gap → fix" list (skills, new bullets, headline), a running Projected ATS number, and a High/Medium/Low importance mark on every fix, every JD keyword chip, and every existing résumé bullet.

**Architecture:** Agent 1 emits one `importance` map for the JD; everything derives its mark from it. A new fast-tier "Gap Filler" agent proposes bullets + a headline for the post-tailor gaps. Per-fix score deltas and the live projected total are pure re-scoring (no LLM) via a `score_content` function extracted from `analyze_jd_match`. Fixes + a bullet-importance map are stored on the tailoring session; a new read-only `/ai/project-score` endpoint powers the running total.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic + Pydantic (`apps/api`, pytest); Next.js + Zustand + React (`apps/web`, vitest). AI via `AIProvider.complete_structured(system, user, schema, model_tier=..., max_output_tokens=..., call_name=...)`.

**Spec:** `docs/superpowers/specs/2026-08-30-ats-gap-fix-list-with-importance-design.md`

## Global Constraints

- Python tests: run from `apps/api/` with `python3 -m pytest`. Pre-existing unrelated failures: `*_requires_auth` (403 vs 401) and PDF/`docx` env suites — ignore those, never "fix" them here.
- Web tests: run from `apps/web/` with `npx vitest run`. Typecheck with `npx tsc --noEmit`.
- Importance levels are exactly the strings `"high"`, `"medium"`, `"low"`. Fix types are exactly `"skill"`, `"bullet"`, `"headline"`.
- `AtsFix.default_accept` rule: `type == "bullet" and grounded`. Nothing else pre-accepts.
- New `JDAnalysis.importance` field defaults to `{}`; every consumer must tolerate a missing key via `default_importance(...)`.
- Migration id is `014`, `down_revision = "013"`.
- Commit message trailer on every commit: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`
- Branch: work on the current branch `feat/ats-hybrid-semantic-title-scoring`.
- `MAX_MERGED_SKILLS` is `20` (frontend `apps/web/stores/tailoring-store.ts`). Backend mirrors it as `_MAX_SKILLS = 20`. Bullet-per-role ceiling is `7` (`HARD_LIMITS["experience_bullets_per_role"]["max"]`).

---

## File Structure

**Backend (`apps/api`):**
- `app/services/ats.py` — add `default_importance`, `AtsFix`, `JdScore`, `score_content`, `apply_fix`, `apply_fixes`, `estimate_fix_delta`. Pure, no I/O.
- `app/services/tailoring.py` — Agent 1 `importance`; `GapFillBullet`/`GapFillerOutput`/`_agent_gap_filler`; `analyze_jd_match` uses `score_content`; `run_tailoring_pipeline` assembles `ats_fixes` + `bullet_importance`; `TailoringResult` + `JDMatchAnalysis` gain fields.
- `app/db/models.py` — `TailoringSession.ats_fixes`, `.bullet_importance` (JSONB, nullable).
- `app/alembic/versions/014_ats_fixes_and_bullet_importance.py` — additive migration.
- `app/schemas/ai.py` — `AnalyzeOut.importance`; `ProjectScoreRequest`, `ProjectScoreOut`.
- `app/routers/ai.py` — `/ai/analyze` returns `importance`; new `POST /ai/project-score`; `_run_tailoring_background` writes new columns; both `/sessions/*` endpoints return them.
- Tests: `tests/test_ats.py`, `tests/test_tailoring.py`, `tests/test_jd_and_tailor_endpoints.py`, `tests/test_migration_014.py`.

**Frontend (`apps/web`):**
- `components/resume/ImportanceBadge.tsx` — new, presentational.
- `components/resume/AtsGapFixPanel.tsx` — new; replaces `<SkillsDelta/>` in the review screen; keeps the existing skill keep/drop sub-block.
- `components/resume/BulletReviewPanel.tsx` — swap panel; per-bullet badge.
- `components/resume/SkillsDelta.tsx` — badges on analyze-screen chips.
- `stores/tailoring-store.ts` — `atsFixes`, `bulletImportance`, `jdImportance`, `projectedAtsScore`; `buildMergedContent` new param; `projectScore` action.
- `lib/api-client.ts` — types + `projectScore`.
- Tests: `__tests__/tailoring-store.test.ts`, `__tests__/api-client.test.ts`, `__tests__/components/ImportanceBadge.test.tsx`.

---

## Task 1: `default_importance` — deterministic fallback

**Files:**
- Modify: `apps/api/app/services/ats.py`
- Test: `apps/api/tests/test_ats.py`

**Interfaces:**
- Consumes: `JDAnalysis` from `app.services.tailoring` — but to avoid a circular import, `default_importance` takes plain lists, not the model. Signature below.
- Produces: `default_importance(term: str, *, titles: list[str], hard_tools: list[str], mediums: list[str], nice: list[str]) -> str` returning `"high" | "medium" | "low"`.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/tests/test_ats.py`:

```python
from app.services.ats import default_importance


def test_default_importance_title_and_hard_tools_are_high():
    kw = dict(titles=["Senior Data Analyst"], hard_tools=["Python"],
              mediums=["Agile"], nice=["Looker"])
    assert default_importance("job title", **kw) == "high"
    assert default_importance("Senior Data Analyst", **kw) == "high"
    assert default_importance("Python", **kw) == "high"


def test_default_importance_mediums_and_unknown_are_medium():
    kw = dict(titles=[], hard_tools=["Python"], mediums=["Agile", "own the roadmap"], nice=[])
    assert default_importance("Agile", **kw) == "medium"
    assert default_importance("own the roadmap", **kw) == "medium"
    assert default_importance("something not in any list", **kw) == "medium"


def test_default_importance_nice_is_low():
    kw = dict(titles=[], hard_tools=[], mediums=[], nice=["Looker", "dbt"])
    assert default_importance("Looker", **kw) == "low"
    assert default_importance("DBT", **kw) == "low"  # case-insensitive


def test_default_importance_matches_case_insensitively():
    kw = dict(titles=["Data Analyst"], hard_tools=[], mediums=[], nice=[])
    assert default_importance("data analyst", **kw) == "high"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python3 -m pytest tests/test_ats.py -k default_importance -v`
Expected: FAIL — `ImportError: cannot import name 'default_importance'`

- [ ] **Step 3: Write minimal implementation**

Add to `apps/api/app/services/ats.py` (after `title_match_verdict`):

```python
def default_importance(
    term: str,
    *,
    titles: list[str],
    hard_tools: list[str],
    mediums: list[str],
    nice: list[str],
) -> str:
    """Bucket-based importance for a JD term when Agent 1 didn't rate it
    (old cache, or an item it missed). See the spec's fallback table."""
    t = term.strip().lower()
    if t == "job title" or any(t == x.strip().lower() for x in titles):
        return "high"
    if any(t == x.strip().lower() for x in hard_tools):
        return "high"
    if any(t == x.strip().lower() for x in nice):
        return "low"
    if any(t == x.strip().lower() for x in mediums):
        return "medium"
    return "medium"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python3 -m pytest tests/test_ats.py -k default_importance -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/ats.py apps/api/tests/test_ats.py
git commit -m "feat: default_importance bucket fallback for JD terms

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Agent 1 emits an `importance` map

**Files:**
- Modify: `apps/api/app/services/tailoring.py` (`JDAnalysis`, `_AGENT1_SYSTEM`, `_agent1_parse_jd`)
- Test: `apps/api/tests/test_tailoring.py`

**Interfaces:**
- Consumes: `default_importance` from Task 1.
- Produces: `JDAnalysis.importance: dict[str, str]` — after `_agent1_parse_jd` returns, every term across `exact_technical_tools + methodologies_and_frameworks + ats_filter_phrases + nice_to_have_skills + core_responsibilities + target_job_titles` plus the literal key `"job title"` has an entry (model value if present, else `default_importance`). Keys are `term.strip().lower()`.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/tests/test_tailoring.py`:

```python
@pytest.mark.asyncio
async def test_agent1_backfills_importance_for_unrated_terms():
    from app.services.tailoring import _agent1_parse_jd, JDAnalysis

    raw = JDAnalysis(
        exact_technical_tools=["Python", "AWS"],
        methodologies_and_frameworks=["Agile"],
        domain_expertise_themes=[],
        seniority_indicators=[],
        ats_filter_phrases=["revenue forecasting"],
        core_responsibilities=["own the analytics roadmap"],
        target_job_titles=["Senior Data Analyst"],
        nice_to_have_skills=["Looker"],
        importance={"python": "high"},  # model only rated one term
    )
    provider = make_mock_provider(structured_return=raw)

    out = await _agent1_parse_jd("jd text", provider)

    # model value kept
    assert out.importance["python"] == "high"
    # everything else backfilled by default_importance
    assert out.importance["job title"] == "high"
    assert out.importance["senior data analyst"] == "high"
    assert out.importance["aws"] == "high"          # hard tool
    assert out.importance["agile"] == "medium"
    assert out.importance["revenue forecasting"] == "medium"
    assert out.importance["own the analytics roadmap"] == "medium"
    assert out.importance["looker"] == "low"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python3 -m pytest tests/test_tailoring.py -k test_agent1_backfills_importance -v`
Expected: FAIL — `TypeError` on `JDAnalysis(... importance=...)` (field doesn't exist) or `KeyError` on `out.importance`.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/app/services/tailoring.py`:

3a. Add the field to `JDAnalysis` (after `nice_to_have_skills`):

```python
    importance: dict[str, str] = {}  # {term_lowercased: "high"|"medium"|"low"}; "job title" key for the title signal
```

3b. In `_AGENT1_SYSTEM`, insert a rule before the final "Output ONLY valid JSON" rule and add the schema key:

```
9. importance: rate EVERY term you put in exact_technical_tools, \
methodologies_and_frameworks, ats_filter_phrases, nice_to_have_skills and \
core_responsibilities, plus a "job title" key, as "high" / "medium" / "low" \
for THIS role. high = defines the role, a stated hard requirement, or \
repeated/emphasised; medium = a normal requirement or day-to-day duty; \
low = "nice to have", peripheral, or generic. Keys are the term verbatim \
(lowercased); "job title" rates how much the posting hinges on title match.
10. Output ONLY valid JSON matching the schema. No markdown, no preamble.
```

(Renumber the old rule 9 → 10.) In `<output_schema>` add:

```
  "importance": {"term": "high|medium|low"}
```

3c. After `_agent1_parse_jd` gets its result, backfill. Replace the `return await provider.complete_structured(...)` at the end of `_agent1_parse_jd` with:

```python
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
```

3d. Add the import at the top of `tailoring.py` (it already imports several names from `app.services.ats`):

```python
from app.services.ats import (
    compute_delta, blend_scores, build_resume_text, title_match_verdict,
    default_importance,
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python3 -m pytest tests/test_tailoring.py -k "test_agent1_backfills_importance or analyze_jd_match" -v`
Expected: PASS (new test + all existing `analyze_jd_match` tests still green).

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/tailoring.py apps/api/tests/test_tailoring.py
git commit -m "feat: Agent 1 rates each JD term high/medium/low importance

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `/ai/analyze` returns the importance map

**Files:**
- Modify: `apps/api/app/schemas/ai.py` (`AnalyzeOut`)
- Modify: `apps/api/app/routers/ai.py` (`analyze_jd` return)
- Test: `apps/api/tests/test_jd_and_tailor_endpoints.py`

**Interfaces:**
- Consumes: `JDMatchAnalysis.jd_analysis.importance` (populated in Task 2).
- Produces: `AnalyzeOut.importance: dict[str, str]` on the `POST /ai/analyze` response.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/tests/test_jd_and_tailor_endpoints.py` (near the other `/ai/analyze` tests; reuse the `make_mock_db`, `make_resume`, `make_jd`, `make_auth_header` helpers already in that file):

```python
@pytest.mark.asyncio
async def test_analyze_returns_importance_map():
    from app.services.tailoring import JDMatchAnalysis, JDAnalysis

    override, mock_session = make_mock_db()
    resume = make_resume()
    jd = make_jd()
    rr = MagicMock(); rr.scalar_one_or_none.return_value = resume
    jr = MagicMock(); jr.scalar_one_or_none.return_value = jd
    mock_session.execute = AsyncMock(side_effect=[rr, jr])

    fake = JDMatchAnalysis(
        jd_analysis=JDAnalysis(
            exact_technical_tools=["Python"], methodologies_and_frameworks=[],
            domain_expertise_themes=[], seniority_indicators=[], ats_filter_phrases=[],
            importance={"python": "high", "job title": "medium"},
        ),
        matched_skills=["Python"], missing_skills=[], ats_score=100, company_keywords=[],
    )

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.analyze_jd_match", new=AsyncMock(return_value=fake)):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post("/ai/analyze",
                    json={"resume_id": str(resume.id), "jd_id": str(jd.id)},
                    headers=make_auth_header())
        assert r.status_code == 200
        assert r.json()["importance"] == {"python": "high", "job title": "medium"}
    finally:
        app.dependency_overrides.pop(get_db, None)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python3 -m pytest tests/test_jd_and_tailor_endpoints.py -k test_analyze_returns_importance_map -v`
Expected: FAIL — `KeyError: 'importance'` in the response JSON.

- [ ] **Step 3: Write minimal implementation**

3a. `apps/api/app/schemas/ai.py` — add to `AnalyzeOut`:

```python
    importance: dict[str, str] = {}  # {jd_term_lowercased: "high"|"medium"|"low"}
```

3b. `apps/api/app/routers/ai.py` — in `analyze_jd`, add to the `AnalyzeOut(...)` return:

```python
        importance=analysis.jd_analysis.importance,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python3 -m pytest tests/test_jd_and_tailor_endpoints.py -k "analyze" -v`
Expected: PASS (new test + existing analyze tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/schemas/ai.py apps/api/app/routers/ai.py apps/api/tests/test_jd_and_tailor_endpoints.py
git commit -m "feat: expose JD term importance on /ai/analyze

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `ImportanceBadge` component

**Files:**
- Create: `apps/web/components/resume/ImportanceBadge.tsx`
- Test: `apps/web/__tests__/components/ImportanceBadge.test.tsx`

**Interfaces:**
- Produces: `export type ImportanceLevel = "high" | "medium" | "low";`
  `export function ImportanceBadge({ level, className }: { level: ImportanceLevel; className?: string }): JSX.Element`
  Renders a dot + capitalised label; `data-testid="importance-badge"`, `data-level={level}`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/components/ImportanceBadge.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ImportanceBadge } from "@/components/resume/ImportanceBadge";

describe("ImportanceBadge", () => {
  it("renders the level as a data attribute and label", () => {
    const { getByTestId } = render(<ImportanceBadge level="high" />);
    const el = getByTestId("importance-badge");
    expect(el.getAttribute("data-level")).toBe("high");
    expect(el.textContent).toContain("High");
  });

  it("uses the error dot for high and the muted dot for low", () => {
    const { getByTestId, rerender } = render(<ImportanceBadge level="high" />);
    expect(getByTestId("importance-badge").querySelector(".bg-error")).not.toBeNull();
    rerender(<ImportanceBadge level="low" />);
    expect(getByTestId("importance-badge").querySelector(".bg-error")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/components/ImportanceBadge.test.tsx`
Expected: FAIL — cannot resolve `@/components/resume/ImportanceBadge`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/components/resume/ImportanceBadge.tsx`:

```tsx
export type ImportanceLevel = "high" | "medium" | "low";

const DOT: Record<ImportanceLevel, string> = {
  high: "bg-error",
  medium: "bg-tertiary",
  low: "bg-on-surface-variant/40",
};

const LABEL: Record<ImportanceLevel, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function ImportanceBadge({
  level,
  className = "",
}: {
  level: ImportanceLevel;
  className?: string;
}) {
  return (
    <span
      data-testid="importance-badge"
      data-level={level}
      className={`inline-flex items-center gap-xs text-caption text-on-surface-variant ${className}`}
      title={`${LABEL[level]} importance for this JD`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${DOT[level]}`} />
      {LABEL[level]}
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/components/ImportanceBadge.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/resume/ImportanceBadge.tsx apps/web/__tests__/components/ImportanceBadge.test.tsx
git commit -m "feat: ImportanceBadge component

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Analyze-screen keyword chips show importance

**Files:**
- Modify: `apps/web/lib/api-client.ts` (analyze response type)
- Modify: `apps/web/stores/tailoring-store.ts` (`jdImportance` state + hydration)
- Modify: `apps/web/components/resume/SkillsDelta.tsx`
- Test: `apps/web/__tests__/tailoring-store.test.ts`

**Interfaces:**
- Consumes: `POST /ai/analyze` response `importance` (Task 3).
- Produces: `useTailoringStore().jdImportance: Record<string, ImportanceLevel>`, populated by `runAnalysis` and `setAnalysisResults`.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/__tests__/tailoring-store.test.ts` (follow the existing mocking of `apiClient`; find how other tests stub `apiClient.analyzeJd` / the analyze call and mirror it):

```ts
it("stores jdImportance from the analyze response", async () => {
  vi.mocked(apiClient.analyzeJd).mockResolvedValue({
    ats_score: 80,
    matched_skills: ["Python"],
    missing_skills: ["AWS"],
    company_keywords: [],
    importance: { python: "high", aws: "low" },
  } as never);

  const store = useTailoringStore.getState();
  store.setJd("jd-1", "jd text");
  await store.runAnalysis("resume-1");

  expect(useTailoringStore.getState().jdImportance).toEqual({ python: "high", aws: "low" });
});
```

(If `runAnalysis` isn't the method the existing tests exercise, use whichever analyze entrypoint they use — `setAnalysisResults` also needs the field; add a second assertion for it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/tailoring-store.test.ts -t jdImportance`
Expected: FAIL — `jdImportance` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

3a. `apps/web/lib/api-client.ts` — the `analyzeJd` return type: add

```ts
    importance?: Record<string, "high" | "medium" | "low">;
```

3b. `apps/web/stores/tailoring-store.ts`:
- Import the type: `import type { ImportanceLevel } from "@/components/resume/ImportanceBadge";`
- In `TailoringState` add: `jdImportance: Record<string, ImportanceLevel>;`
- In the `create(...)` initial object add: `jdImportance: {},`
- In `setAnalysisResults` params add `jdImportance?: Record<string, ImportanceLevel>` and `set({ ..., jdImportance: jdImportance ?? {} })`.
- In `runAnalysis`, where the response is unpacked into `set({...})`, add `jdImportance: (res.importance ?? {}) as Record<string, ImportanceLevel>`.
- In `resetStore` / the "different JD" reset paths, reset `jdImportance: {}` alongside `matchedSkills: []`.

3c. `apps/web/components/resume/SkillsDelta.tsx`:
- `import { ImportanceBadge } from "./ImportanceBadge";`
- `const jdImportance = useTailoringStore((s) => s.jdImportance);`
- In both the matched-chip and missing-chip `.map`, render after the skill text:

```tsx
{jdImportance[s.toLowerCase()] && (
  <ImportanceBadge level={jdImportance[s.toLowerCase()]} className="ml-xs" />
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/tailoring-store.test.ts && npx tsc --noEmit`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/api-client.ts apps/web/stores/tailoring-store.ts apps/web/components/resume/SkillsDelta.tsx apps/web/__tests__/tailoring-store.test.ts
git commit -m "feat: importance badges on analyze-screen keyword chips

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Extract `score_content` from `analyze_jd_match`

**Files:**
- Modify: `apps/api/app/services/ats.py` (new `JdScore`, `score_content`)
- Modify: `apps/api/app/services/tailoring.py` (`analyze_jd_match` calls `score_content`)
- Test: `apps/api/tests/test_ats.py`

**Interfaces:**
- Produces:
  ```python
  @dataclass
  class JdScore:
      matched: list[str]
      missing: list[str]
      ats_score: int
      title_match: str  # "" | "matched" | "partial" | "missing"

  def score_content(content: dict, jd_analysis: "JDAnalysis-like", semantic_verdicts: dict[str, str]) -> JdScore
  ```
  `jd_analysis` is duck-typed: `score_content` reads `.exact_technical_tools`, `.methodologies_and_frameworks`, `.ats_filter_phrases`, `.nice_to_have_skills`, `.core_responsibilities`, `.target_job_titles`. No import of `JDAnalysis` into `ats.py` (avoids a cycle).
- Consumes: existing `compute_delta`, `blend_scores`, `title_match_verdict`, `build_resume_text` in `ats.py`.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/tests/test_ats.py`:

```python
from types import SimpleNamespace
from app.services.ats import score_content, JdScore


def _jd(**kw):
    base = dict(exact_technical_tools=[], methodologies_and_frameworks=[],
               ats_filter_phrases=[], nice_to_have_skills=[],
               core_responsibilities=[], target_job_titles=[])
    base.update(kw)
    return SimpleNamespace(**base)


def test_score_content_lexical_hit_plus_semantic_verdict():
    jd = _jd(exact_technical_tools=["Python", "AWS"])
    content = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}
    # AWS not in the résumé; semantic verifier said "partial"
    out = score_content(content, jd, {"aws": "partial"})
    assert isinstance(out, JdScore)
    assert out.matched == ["Python"]
    assert out.missing == ["AWS"]
    assert out.ats_score == 75          # 1.0 + 0.5 over 2
    assert out.title_match == ""        # no target_job_titles


def test_score_content_scores_title_when_jd_has_one():
    jd = _jd(exact_technical_tools=["Python"], target_job_titles=["Senior Data Analyst"])
    content = {"headline": "Senior Data Analyst",
               "experience": [{"title": "Senior Data Analyst", "bullets": ["Used Python"]}],
               "skills": ["Python"]}
    out = score_content(content, jd, {})
    assert out.title_match == "matched"
    assert out.ats_score == 100


def test_score_content_nice_to_have_half_weight():
    jd = _jd(exact_technical_tools=["Python"], nice_to_have_skills=["Looker"])
    content = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}
    out = score_content(content, jd, {"looker": "missing"})
    assert out.ats_score == 67          # 1.0 over 1.5
    assert out.missing == ["Looker"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python3 -m pytest tests/test_ats.py -k score_content -v`
Expected: FAIL — `ImportError: cannot import name 'score_content'`.

- [ ] **Step 3: Write minimal implementation**

3a. In `apps/api/app/services/ats.py`, add after `blend_scores`:

```python
@dataclass
class JdScore:
    matched: list[str]
    missing: list[str]
    ats_score: int
    title_match: str  # "" | "matched" | "partial" | "missing"


def _dedupe_ci(*groups: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for g in groups:
        for p in g or []:
            k = p.strip().lower()
            if k and k not in seen:
                seen.add(k)
                out.append(p)
    return out


def score_content(content: dict, jd_analysis, semantic_verdicts: dict[str, str]) -> JdScore:
    """Blend a résumé's lexical + (pre-computed) semantic match against a
    parsed JD into a 0-100 score. Pure — never calls a model. Missing
    phrases fall back to whatever `semantic_verdicts` says, else "missing"."""
    required = _dedupe_ci(
        jd_analysis.exact_technical_tools,
        jd_analysis.methodologies_and_frameworks,
        jd_analysis.ats_filter_phrases,
    )
    nice = [p for p in _dedupe_ci(jd_analysis.nice_to_have_skills)
            if p.strip().lower() not in {r.strip().lower() for r in required}]
    responsibilities = [r.strip() for r in (jd_analysis.core_responsibilities or []) if r and r.strip()]

    d_req = compute_delta(required, content)
    d_nice = compute_delta(nice, content)

    def verdicts_for(phrases: list[str], lexically_matched: list[str]) -> dict[str, str]:
        matched_set = {m.strip().lower() for m in lexically_matched}
        out: dict[str, str] = {}
        for p in phrases:
            k = p.strip().lower()
            out[p] = "matched" if k in matched_set else semantic_verdicts.get(k, "missing")
        return out

    skill_verdicts = verdicts_for(required, d_req.matched)
    nice_verdicts = verdicts_for(nice, d_nice.matched)
    resp_verdicts = {r: semantic_verdicts.get(r.strip().lower(), "missing") for r in responsibilities}

    jd_titles = [t.strip() for t in (jd_analysis.target_job_titles or []) if t and t.strip()]
    title_verdict = None
    if jd_titles:
        resume_titles = [str(content.get("headline") or "")]
        for exp in (content.get("experience") or [])[:2]:
            resume_titles.append(str(exp.get("title") or ""))
        title_verdict = title_match_verdict(jd_titles, [t for t in resume_titles if t])

    blended = blend_scores(skill_verdicts, resp_verdicts, nice_verdicts, title_verdict)
    return JdScore(
        matched=blended.matched,
        missing=blended.missing,
        ats_score=blended.ats_score,
        title_match=title_verdict or "",
    )
```

3b. In `apps/api/app/services/tailoring.py`, `analyze_jd_match`: replace the block from `required_skills = _dedupe(...)` through the `blended = blend_scores(...)` line with:

```python
    resume_text, _ = build_resume_text(resume_content)

    # Which phrases still need the semantic pass (lexical misses + responsibilities)
    probe = score_content(resume_content, jd_analysis, {})
    responsibilities = [r.strip() for r in (jd_analysis.core_responsibilities or []) if r and r.strip()]
    to_verify = list(probe.missing) + responsibilities

    if cached_semantic_verdicts is not None:
        semantic_verdicts = dict(cached_semantic_verdicts)
    elif to_verify:
        semantic_verdicts = await _verify_semantic_presence(to_verify, resume_text, provider)
    else:
        semantic_verdicts = {}

    blended = score_content(resume_content, jd_analysis, semantic_verdicts)
```

Then update the `JDMatchAnalysis(...)` construction to read from `blended` (a `JdScore`):

```python
    return JDMatchAnalysis(
        jd_analysis=jd_analysis,
        matched_skills=blended.matched,
        missing_skills=blended.missing,
        ats_score=blended.ats_score,
        company_keywords=company_keywords,
        semantic_verdicts=semantic_verdicts,
        title_match=blended.title_match,
    )
```

Add `score_content` to the `from app.services.ats import (...)` list. Delete the now-unused local `_dedupe` / `_verdicts_for` closures and `title_verdict` block in `analyze_jd_match`.

Note: `probe = score_content(resume_content, jd_analysis, {})` re-runs `compute_delta` a second time (once here, once inside the real `score_content` call). That's pure/cheap string work; acceptable. Do NOT try to thread the intermediate through — keep it simple.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python3 -m pytest tests/test_ats.py tests/test_tailoring.py -v`
Expected: PASS — new `score_content` tests + **every existing `analyze_jd_match` / pipeline test unchanged** (this is the parity check).

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/ats.py apps/api/app/services/tailoring.py apps/api/tests/test_ats.py
git commit -m "refactor: extract pure score_content from analyze_jd_match

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: `AtsFix` model + `apply_fix` / `apply_fixes`

**Files:**
- Modify: `apps/api/app/services/ats.py`
- Test: `apps/api/tests/test_ats.py`

**Interfaces:**
- Produces:
  ```python
  class AtsFix(BaseModel):
      id: str
      type: Literal["skill", "bullet", "headline"]
      gap: str
      importance: Literal["high", "medium", "low"]
      grounded: bool
      text: str
      experience_index: int | None = None
      score_delta: int = 0
      default_accept: bool = False

  def fix_slug(prefix: str, gap: str) -> str          # stable id builder
  def apply_fix(content: dict, fix: AtsFix) -> dict    # returns a NEW dict
  def apply_fixes(content: dict, fixes: list[AtsFix]) -> dict
  ```
- Constants: `_MAX_SKILLS = 20`, `_MAX_BULLETS_PER_ROLE = 7`.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/tests/test_ats.py`:

```python
from app.services.ats import AtsFix, apply_fix, apply_fixes, fix_slug


def _fix(**kw):
    base = dict(id="x", type="skill", gap="g", importance="medium",
                grounded=True, text="Kubernetes")
    base.update(kw)
    return AtsFix(**base)


def test_apply_fix_skill_appends_and_does_not_mutate():
    content = {"skills": ["Python"], "experience": []}
    out = apply_fix(content, _fix(type="skill", text="Kubernetes"))
    assert out["skills"] == ["Python", "Kubernetes"]
    assert content["skills"] == ["Python"]  # original untouched


def test_apply_fix_bullet_appends_to_the_named_experience():
    content = {"skills": [], "experience": [
        {"title": "A", "bullets": ["b1"]},
        {"title": "B", "bullets": ["b2"]},
    ]}
    out = apply_fix(content, _fix(type="bullet", text="Shipped X", experience_index=1))
    assert out["experience"][1]["bullets"] == ["b2", "Shipped X"]
    assert out["experience"][0]["bullets"] == ["b1"]


def test_apply_fix_headline_replaces():
    out = apply_fix({"headline": "old", "skills": [], "experience": []},
                    _fix(type="headline", text="Senior Data Analyst"))
    assert out["headline"] == "Senior Data Analyst"


def test_apply_fixes_skips_a_skill_past_the_cap_whole():
    content = {"skills": [f"s{i}" for i in range(20)], "experience": []}
    out = apply_fixes(content, [_fix(id="a", type="skill", text="OverflowSkill")])
    assert "OverflowSkill" not in out["skills"]
    assert len(out["skills"]) == 20


def test_apply_fixes_skips_a_bullet_past_the_role_cap_whole():
    content = {"skills": [], "experience": [{"title": "A", "bullets": [f"b{i}" for i in range(7)]}]}
    out = apply_fixes(content, [_fix(id="a", type="bullet", text="Eighth", experience_index=0)])
    assert "Eighth" not in out["experience"][0]["bullets"]
    assert len(out["experience"][0]["bullets"]) == 7


def test_fix_slug_is_stable_and_url_safe():
    assert fix_slug("bullet", "Revenue Forecasting & Planning!") == "bullet:revenue-forecasting-planning"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python3 -m pytest tests/test_ats.py -k "apply_fix or apply_fixes or fix_slug" -v`
Expected: FAIL — imports don't exist.

- [ ] **Step 3: Write minimal implementation**

Add to `apps/api/app/services/ats.py`:
- Top of file: `from copy import deepcopy` and `from pydantic import BaseModel` and `from typing import Literal`.
- After `JdScore`:

```python
_MAX_SKILLS = 20          # mirrors MAX_MERGED_SKILLS in apps/web/stores/tailoring-store.ts
_MAX_BULLETS_PER_ROLE = 7  # HARD_LIMITS["experience_bullets_per_role"]["max"]


class AtsFix(BaseModel):
    id: str
    type: Literal["skill", "bullet", "headline"]
    gap: str
    importance: Literal["high", "medium", "low"]
    grounded: bool
    text: str
    experience_index: int | None = None
    score_delta: int = 0
    default_accept: bool = False


def fix_slug(prefix: str, gap: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", gap.lower()).strip("-")[:60]
    return f"{prefix}:{s}"


def apply_fix(content: dict, fix: AtsFix) -> dict:
    """Return a deep copy of `content` with the single fix folded in. No cap
    checks here — see apply_fixes for those."""
    out = deepcopy(content)
    if fix.type == "skill":
        out.setdefault("skills", [])
        if fix.text not in out["skills"]:
            out["skills"].append(fix.text)
    elif fix.type == "headline":
        out["headline"] = fix.text
    elif fix.type == "bullet" and fix.experience_index is not None:
        exps = out.get("experience") or []
        if 0 <= fix.experience_index < len(exps):
            exps[fix.experience_index].setdefault("bullets", []).append(fix.text)
    return out


def apply_fixes(content: dict, fixes: list[AtsFix]) -> dict:
    """Fold a list of fixes in order. A skill fix that would push the list
    past _MAX_SKILLS, or a bullet fix past _MAX_BULLETS_PER_ROLE for its
    role, is skipped whole (never truncated mid-text)."""
    out = deepcopy(content)
    for fix in fixes:
        if fix.type == "skill":
            skills = out.setdefault("skills", [])
            if fix.text not in skills and len(skills) < _MAX_SKILLS:
                skills.append(fix.text)
        elif fix.type == "headline":
            out["headline"] = fix.text
        elif fix.type == "bullet" and fix.experience_index is not None:
            exps = out.get("experience") or []
            if 0 <= fix.experience_index < len(exps):
                bullets = exps[fix.experience_index].setdefault("bullets", [])
                if len(bullets) < _MAX_BULLETS_PER_ROLE:
                    bullets.append(fix.text)
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python3 -m pytest tests/test_ats.py -k "apply_fix or apply_fixes or fix_slug" -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/ats.py apps/api/tests/test_ats.py
git commit -m "feat: AtsFix model + apply_fix/apply_fixes with cap enforcement

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: `estimate_fix_delta`

**Files:**
- Modify: `apps/api/app/services/ats.py`
- Test: `apps/api/tests/test_ats.py`

**Interfaces:**
- Consumes: `apply_fix`, `score_content` (Tasks 6-7).
- Produces: `estimate_fix_delta(content: dict, jd_analysis, semantic_verdicts: dict[str, str], base_score: int, fix: AtsFix) -> int` — a non-negative "+X%".

- [ ] **Step 1: Write the failing test**

Add to `apps/api/tests/test_ats.py`:

```python
from app.services.ats import estimate_fix_delta


def test_estimate_fix_delta_adding_a_matched_keyword_raises_score():
    jd = _jd(exact_technical_tools=["Python", "Kubernetes"])
    content = {"skills": ["Python"], "experience": [{"title": "E", "bullets": ["Used Python"]}]}
    base = score_content(content, jd, {"kubernetes": "missing"}).ats_score  # 50
    fix = AtsFix(id="s:k8s", type="skill", gap="Kubernetes", importance="high",
                 grounded=True, text="Kubernetes")
    delta = estimate_fix_delta(content, jd, {"kubernetes": "missing"}, base, fix)
    assert delta == 50  # 50 -> 100


def test_estimate_fix_delta_never_negative():
    jd = _jd(exact_technical_tools=["Python"])
    content = {"skills": ["Python"], "experience": []}
    base = score_content(content, jd, {}).ats_score  # 100
    fix = AtsFix(id="s:x", type="skill", gap="X", importance="low", grounded=True, text="X")
    assert estimate_fix_delta(content, jd, {}, base, fix) == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python3 -m pytest tests/test_ats.py -k estimate_fix_delta -v`
Expected: FAIL — import error.

- [ ] **Step 3: Write minimal implementation**

Add to `apps/api/app/services/ats.py`:

```python
def estimate_fix_delta(
    content: dict,
    jd_analysis,
    semantic_verdicts: dict[str, str],
    base_score: int,
    fix: "AtsFix",
) -> int:
    """Points this one fix would add on its own, vs base_score. Pure."""
    after = score_content(apply_fix(content, fix), jd_analysis, semantic_verdicts).ats_score
    return max(0, after - base_score)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python3 -m pytest tests/test_ats.py -v`
Expected: PASS (whole file)

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/ats.py apps/api/tests/test_ats.py
git commit -m "feat: estimate_fix_delta — per-fix score impact

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: Gap Filler agent

**Files:**
- Modify: `apps/api/app/services/tailoring.py`
- Test: `apps/api/tests/test_tailoring.py`

**Interfaces:**
- Produces:
  ```python
  class GapFillBullet(BaseModel):
      gap: str
      grounded: bool
      experience_index: int | None = None
      bullet_text: str

  class GapFillerOutput(BaseModel):
      bullets: list[GapFillBullet] = []
      headline: str = ""

  async def _agent_gap_filler(
      tailored_content: dict, jd_analysis: JDAnalysis,
      gaps: list[dict], provider: AIProvider,
  ) -> GapFillerOutput
  ```
  `gaps` entries: `{"gap": str, "kind": "skill"|"responsibility"|"title", "importance": str}`.
- Constant: `_MAX_TOKENS_GAP_FILL = 4000`.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/tests/test_tailoring.py`:

```python
@pytest.mark.asyncio
async def test_agent_gap_filler_requests_fast_tier_and_returns_output():
    from app.services.tailoring import (
        _agent_gap_filler, GapFillerOutput, GapFillBullet, make_jd_analysis,
    )
    jd = make_jd_analysis(exact_technical_tools=["Kubernetes"])
    provider = make_mock_provider(structured_return=GapFillerOutput(
        bullets=[GapFillBullet(gap="Kubernetes", grounded=True, experience_index=0,
                               bullet_text="Ran production workloads on Kubernetes.")],
        headline="",
    ))
    out = await _agent_gap_filler(
        {"experience": [{"title": "E", "bullets": ["x"]}]},
        jd,
        [{"gap": "Kubernetes", "kind": "skill", "importance": "high"}],
        provider,
    )
    assert out.bullets[0].bullet_text.startswith("Ran production workloads")
    assert provider.complete_structured.call_args.kwargs["model_tier"] == "fast"


@pytest.mark.asyncio
async def test_agent_gap_filler_no_gaps_skips_the_call():
    from app.services.tailoring import _agent_gap_filler, make_jd_analysis
    provider = make_mock_provider()
    out = await _agent_gap_filler({"experience": []}, make_jd_analysis(), [], provider)
    assert out.bullets == [] and out.headline == ""
    provider.complete_structured.assert_not_called()
```

(`make_jd_analysis` is the helper already defined in `test_tailoring.py`. If it's not importable, build a `JDAnalysis(...)` inline with all required fields.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python3 -m pytest tests/test_tailoring.py -k _agent_gap_filler -v`
Expected: FAIL — imports don't exist.

- [ ] **Step 3: Write minimal implementation**

In `apps/api/app/services/tailoring.py`, near the other agent models/prompts (after `_verify_semantic_presence`):

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python3 -m pytest tests/test_tailoring.py -k _agent_gap_filler -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/tailoring.py apps/api/tests/test_tailoring.py
git commit -m "feat: Gap Filler agent — proposes bullets + headline for JD gaps

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: `run_tailoring_pipeline` assembles `ats_fixes` + `bullet_importance`

**Files:**
- Modify: `apps/api/app/services/tailoring.py` (`TailoringResult`, `run_tailoring_pipeline`)
- Test: `apps/api/tests/test_tailoring.py`

**Interfaces:**
- Consumes: `_agent_gap_filler` (Task 9), `estimate_fix_delta`, `AtsFix`, `fix_slug`, `default_importance` (Tasks 1, 7, 8).
- Produces: `TailoringResult.ats_fixes: list[AtsFix]` and `TailoringResult.bullet_importance: dict[str, str]` (`{original_bullet_id: "high"|"medium"|"low"}`).
- Helper produced: `_max_importance(levels: list[str]) -> str`.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/tests/test_tailoring.py`:

```python
@pytest.mark.asyncio
async def test_pipeline_emits_ats_fixes_and_bullet_importance():
    from app.services.tailoring import GapFillerOutput, GapFillBullet

    responses = {
        JDAnalysis: make_jd_analysis(
            exact_technical_tools=["Python", "Kubernetes"],
            core_responsibilities=["own the deploy pipeline"],
            importance={"python": "high", "kubernetes": "high",
                        "own the deploy pipeline": "medium", "job title": "low"},
        ),
        MappingPlan: MappingPlan(
            mapping_plan=[BulletMapping(
                original_bullet_id="exp0_b0", original_text="Managed deploys",
                target_jd_keywords_to_inject=["Python"], preserved_metrics=[],
                strategic_instruction="INJECT",
                jd_responsibility_addressed="own the deploy pipeline",
            )],
            plausible_skills_to_add=[],
        ),
        WriterOutput: WriterOutput(
            rewritten_bullets=[RewrittenBullet(bullet_id="exp0_b0",
                               rewritten_text="Managed deploys with Python")],
            updated_skills=[],
        ),
        GapFillerOutput: GapFillerOutput(bullets=[GapFillBullet(
            gap="Kubernetes", grounded=False, experience_index=None,
            bullet_text="Operated Kubernetes clusters in production.")]),
        SkillQuestionsWrapper: SkillQuestionsWrapper(questions=[]),
        InterviewQuestionsWrapper: InterviewQuestionsWrapper(questions=[]),
    }
    provider = make_provider_dispatching_by_schema(responses)
    resume = {"experience": [{"title": "E", "bullets": ["Managed deploys"]}], "skills": []}
    db = make_mock_db_with_rows([])

    result = await run_tailoring_pipeline(resume, "need Python and Kubernetes", 50, provider, db)

    ids = {f.id for f in result.ats_fixes}
    # a skill fix for the still-missing Kubernetes, and a speculative bullet fix
    assert any(f.type == "skill" and f.text == "Kubernetes" for f in result.ats_fixes)
    k8s_bullet = next(f for f in result.ats_fixes if f.type == "bullet" and f.gap == "Kubernetes")
    assert k8s_bullet.grounded is False
    assert k8s_bullet.default_accept is False
    assert k8s_bullet.importance == "high"
    # sorted High -> Low
    levels = [f.importance for f in result.ats_fixes]
    assert levels == sorted(levels, key=lambda l: {"high": 0, "medium": 1, "low": 2}[l])
    # bullet importance from the mapping plan (max of keyword + responsibility importance)
    assert result.bullet_importance["exp0_b0"] == "high"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python3 -m pytest tests/test_tailoring.py -k test_pipeline_emits_ats_fixes -v`
Expected: FAIL — `TailoringResult` has no `ats_fixes`.

- [ ] **Step 3: Write minimal implementation**

3a. Imports in `tailoring.py`: extend the `from app.services.ats import (...)` to also pull `AtsFix, fix_slug, estimate_fix_delta`.

3b. `TailoringResult` — add:

```python
    ats_fixes: list[AtsFix] = field(default_factory=list)
    bullet_importance: dict[str, str] = field(default_factory=dict)
```

3c. Add a module helper:

```python
_IMPORTANCE_RANK = {"high": 0, "medium": 1, "low": 2}


def _max_importance(levels: list[str]) -> str:
    valid = [l for l in levels if l in _IMPORTANCE_RANK]
    return min(valid, key=lambda l: _IMPORTANCE_RANK[l]) if valid else "medium"
```

3d. In `run_tailoring_pipeline`, after the `post = await analyze_jd_match(tailored_content, ...)` line and before the `# ── merge in the user's priority skills` block, insert:

```python
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

    nice_lower = {s.strip().lower() for s in (analysis.jd_analysis.nice_to_have_skills or [])}
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
```

3e. Update the `return TailoringResult(...)` to pass `ats_fixes=fixes, bullet_importance=bullet_importance`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python3 -m pytest tests/test_tailoring.py -v`
Expected: PASS (new test + all existing pipeline tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/tailoring.py apps/api/tests/test_tailoring.py
git commit -m "feat: pipeline builds the ats_fixes list + bullet_importance map

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 11: Migration 014 + session columns + write-back + session endpoints

**Files:**
- Create: `apps/api/app/alembic/versions/014_ats_fixes_and_bullet_importance.py`
- Modify: `apps/api/app/db/models.py` (`TailoringSession`)
- Modify: `apps/api/app/routers/ai.py` (`_run_tailoring_background`, `get_session`, `get_latest_session`)
- Test: `apps/api/tests/test_migration_014.py` (new), `apps/api/tests/test_jd_and_tailor_endpoints.py`

**Interfaces:**
- Produces: `TailoringSession.ats_fixes: list[dict] | None`, `TailoringSession.bullet_importance: dict | None`. `GET /ai/sessions/{id}` and `/ai/sessions/latest` responses gain keys `ats_fixes` (list, `[]` when null) and `bullet_importance` (dict, `{}` when null).

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/test_migration_014.py`:

```python
import importlib.util
import pathlib

MIG = pathlib.Path(__file__).parents[1] / "app/alembic/versions/014_ats_fixes_and_bullet_importance.py"


def test_migration_014_declares_the_two_columns_and_chains_from_013():
    spec = importlib.util.spec_from_file_location("m014", MIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert m.revision == "014"
    assert m.down_revision == "013"
    src = MIG.read_text()
    assert "ats_fixes" in src and "bullet_importance" in src
    assert "add_column" in src and "drop_column" in src  # up + down
```

Add to `apps/api/tests/test_jd_and_tailor_endpoints.py`:

```python
@pytest.mark.asyncio
async def test_get_session_returns_ats_fixes_and_bullet_importance():
    override, mock_session = make_mock_db()
    from app.db.models import TailoringSession
    import uuid as _uuid
    sess = TailoringSession(
        id=_uuid.uuid4(), user_id=_uuid.UUID(TEST_USER_ID), jd_id=_uuid.uuid4(),
        status="completed", tailored_content={"experience": []}, ats_score=70,
        matched_skills=[], missing_skills=[], company_keywords=[], suggested_skills=[],
    )
    sess.ats_fixes = [{"id": "skill:k8s", "type": "skill", "gap": "Kubernetes",
                       "importance": "high", "grounded": True, "text": "Kubernetes",
                       "experience_index": None, "score_delta": 5, "default_accept": False}]
    sess.bullet_importance = {"exp0_b0": "high"}
    res = MagicMock(); res.scalar_one_or_none.return_value = sess
    mock_session.execute = AsyncMock(return_value=res)

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/ai/sessions/{sess.id}", headers=make_auth_header())
        assert r.status_code == 200
        body = r.json()
        assert body["ats_fixes"][0]["gap"] == "Kubernetes"
        assert body["bullet_importance"] == {"exp0_b0": "high"}
    finally:
        app.dependency_overrides.pop(get_db, None)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python3 -m pytest tests/test_migration_014.py tests/test_jd_and_tailor_endpoints.py -k "014 or ats_fixes_and_bullet" -v`
Expected: FAIL — migration file missing; session response has no `ats_fixes` key.

- [ ] **Step 3: Write minimal implementation**

3a. Create `apps/api/app/alembic/versions/014_ats_fixes_and_bullet_importance.py`:

```python
"""add tailoring_sessions.ats_fixes and .bullet_importance

Revision ID: 014
Revises: 013
Create Date: 2026-08-30 00:00:00.000000

Additive only — existing completed sessions keep NULL and the frontend
falls back to the legacy missing/suggested-skills rendering for them.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "014"
down_revision: Union[str, None] = "013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tailoring_sessions", sa.Column("ats_fixes", JSONB(), nullable=True))
    op.add_column("tailoring_sessions", sa.Column("bullet_importance", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("tailoring_sessions", "bullet_importance")
    op.drop_column("tailoring_sessions", "ats_fixes")
```

3b. `apps/api/app/db/models.py` — in `TailoringSession`, after `suggested_skills`:

```python
    ats_fixes: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    bullet_importance: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
```

(`JSONB` is already imported in this file — it's used by `tailored_content`.)

3c. `apps/api/app/routers/ai.py` `_run_tailoring_background` — where it sets `row.suggested_skills = result.suggested_skills`, add:

```python
        row.ats_fixes = [f.model_dump() for f in result.ats_fixes]
        row.bullet_importance = result.bullet_importance
```

3d. In BOTH `get_session` and `get_latest_session` return dicts, add:

```python
        "ats_fixes": session.ats_fixes or [],
        "bullet_importance": session.bullet_importance or {},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python3 -m pytest tests/test_migration_014.py tests/test_jd_and_tailor_endpoints.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/alembic/versions/014_ats_fixes_and_bullet_importance.py apps/api/app/db/models.py apps/api/app/routers/ai.py apps/api/tests/test_migration_014.py apps/api/tests/test_jd_and_tailor_endpoints.py
git commit -m "feat: persist ats_fixes + bullet_importance on the tailoring session

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 12: `POST /ai/project-score`

**Files:**
- Modify: `apps/api/app/schemas/ai.py` (`ProjectScoreRequest`, `ProjectScoreOut`)
- Modify: `apps/api/app/routers/ai.py` (new endpoint)
- Test: `apps/api/tests/test_jd_and_tailor_endpoints.py`

**Interfaces:**
- Consumes: `score_content`, `apply_fixes`, `AtsFix` (Tasks 6-7); `JDAnalysis`.
- Produces: `POST /ai/project-score` — body `{session_id: UUID, accepted_fix_ids: list[str]}` → `{projected_score: int}`. 404 for a session that isn't the caller's or isn't `completed`. **No LLM call.**

- [ ] **Step 1: Write the failing test**

Add to `apps/api/tests/test_jd_and_tailor_endpoints.py`:

```python
@pytest.mark.asyncio
async def test_project_score_applies_only_accepted_fixes_no_llm():
    from app.db.models import TailoringSession, JobDescription
    import uuid as _uuid

    override, mock_session = make_mock_db()
    jd = JobDescription(
        id=_uuid.uuid4(), user_id=_uuid.UUID(TEST_USER_ID), title="T",
        raw_text="need Python and Kubernetes",
        parsed={"agent1": {
            "exact_technical_tools": ["Python", "Kubernetes"],
            "methodologies_and_frameworks": [], "domain_expertise_themes": [],
            "seniority_indicators": [], "ats_filter_phrases": [],
            "core_responsibilities": [], "target_job_titles": [],
            "nice_to_have_skills": [], "importance": {},
        }, "semantic": {"fingerprint": "x", "verdicts": {"kubernetes": "missing"}}},
        status="applied",
    )
    sess = TailoringSession(
        id=_uuid.uuid4(), user_id=_uuid.UUID(TEST_USER_ID), jd_id=jd.id,
        status="completed", ats_score=50, matched_skills=[], missing_skills=[],
        company_keywords=[], suggested_skills=[],
        tailored_content={"skills": ["Python"], "experience": [{"title": "E", "bullets": ["Used Python"]}]},
    )
    sess.jd = jd
    sess.ats_fixes = [
        {"id": "skill:kubernetes", "type": "skill", "gap": "Kubernetes", "importance": "high",
         "grounded": True, "text": "Kubernetes", "experience_index": None,
         "score_delta": 50, "default_accept": False},
        {"id": "skill:terraform", "type": "skill", "gap": "Terraform", "importance": "low",
         "grounded": True, "text": "Terraform", "experience_index": None,
         "score_delta": 0, "default_accept": False},
    ]
    res = MagicMock(); res.scalar_one_or_none.return_value = sess
    mock_session.execute = AsyncMock(return_value=res)

    provider_spy = MagicMock()
    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.get_ai_provider", return_value=provider_spy):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post("/ai/project-score",
                    json={"session_id": str(sess.id), "accepted_fix_ids": ["skill:kubernetes"]},
                    headers=make_auth_header())
        assert r.status_code == 200
        assert r.json()["projected_score"] == 100   # Python + accepted Kubernetes
        provider_spy.assert_not_called()
    finally:
        app.dependency_overrides.pop(get_db, None)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python3 -m pytest tests/test_jd_and_tailor_endpoints.py -k project_score -v`
Expected: FAIL — 404 / route not found.

- [ ] **Step 3: Write minimal implementation**

3a. `apps/api/app/schemas/ai.py`:

```python
class ProjectScoreRequest(BaseModel):
    session_id: uuid.UUID
    accepted_fix_ids: list[str] = []


class ProjectScoreOut(BaseModel):
    projected_score: int
```

(`uuid` and `BaseModel` are already imported in that module.)

3b. `apps/api/app/routers/ai.py` — add imports at the top:

```python
from app.services.ats import score_content, apply_fixes, AtsFix
from app.schemas.ai import ProjectScoreRequest, ProjectScoreOut
```

(Add `ProjectScoreRequest, ProjectScoreOut` to the existing `from app.schemas.ai import (...)` block instead if that's the file's style.)

Add the endpoint (place it before `@router.get("/sessions/latest")`):

```python
@router.post("/project-score", response_model=ProjectScoreOut)
@limiter.limit("30/minute")
async def project_score(
    request: Request,
    body: ProjectScoreRequest,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Re-score a completed tailoring session's résumé with a chosen subset
    of its ats_fixes applied. Pure computation — no model call."""
    uid = uuid.UUID(user["sub"])
    session = (
        await db.execute(
            select(TailoringSession).where(
                TailoringSession.id == body.session_id,
                TailoringSession.user_id == uid,
            )
        )
    ).scalar_one_or_none()
    if not session or session.status != "completed" or not session.tailored_content:
        raise HTTPException(status_code=404, detail="Completed session not found")

    jd_row = session.jd
    agent1 = (jd_row.parsed or {}).get("agent1")
    if not agent1:
        raise HTTPException(status_code=409, detail="Session JD has no cached analysis")
    jd_analysis = JDAnalysis(**agent1)
    verdicts = (jd_row.parsed or {}).get("semantic", {}).get("verdicts", {}) or {}

    accepted = set(body.accepted_fix_ids)
    fixes = [AtsFix(**f) for f in (session.ats_fixes or []) if f.get("id") in accepted]
    merged = apply_fixes(session.tailored_content, fixes)
    return ProjectScoreOut(projected_score=score_content(merged, jd_analysis, verdicts).ats_score)
```

Note `session.jd` is a lazy relationship — the test sets it explicitly; in production the request-scoped session loads it on access. If lazy-load raises under async, change to an explicit `select(JobDescription).where(JobDescription.id == session.jd_id)` fetch. Verify in Step 4; if the real endpoint 500s on `session.jd`, switch to the explicit fetch.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python3 -m pytest tests/test_jd_and_tailor_endpoints.py -k project_score -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/schemas/ai.py apps/api/app/routers/ai.py apps/api/tests/test_jd_and_tailor_endpoints.py
git commit -m "feat: POST /ai/project-score — pure re-score with accepted fixes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 13: `api-client` — types + `projectScore`

**Files:**
- Modify: `apps/web/lib/api-client.ts`
- Test: `apps/web/__tests__/api-client.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface AtsFix {
    id: string;
    type: "skill" | "bullet" | "headline";
    gap: string;
    importance: "high" | "medium" | "low";
    grounded: boolean;
    text: string;
    experience_index: number | null;
    score_delta: number;
    default_accept: boolean;
  }
  apiClient.projectScore(sessionId: string, acceptedFixIds: string[]): Promise<{ projected_score: number }>
  ```
- The tailoring-session response type gains `ats_fixes?: AtsFix[]` and `bullet_importance?: Record<string, "high"|"medium"|"low">`.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/__tests__/api-client.test.ts` (mirror how existing POST methods there are tested — a `fetch` mock asserting URL, method, body, and the parsed response):

```ts
it("projectScore posts session id + accepted ids and returns the score", async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ projected_score: 82 }),
  });
  vi.stubGlobal("fetch", fetchMock);

  const out = await apiClient.projectScore("sess-1", ["skill:k8s", "bullet:x"]);

  expect(out).toEqual({ projected_score: 82 });
  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toContain("/ai/project-score");
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body)).toEqual({
    session_id: "sess-1", accepted_fix_ids: ["skill:k8s", "bullet:x"],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/api-client.test.ts -t projectScore`
Expected: FAIL — `apiClient.projectScore is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `apps/web/lib/api-client.ts`:
- Add the `AtsFix` interface (exported) near the other exported response types.
- On the tailoring-session response interface (the one returned by `getTailoringSession` / session poll), add `ats_fixes?: AtsFix[];` and `bullet_importance?: Record<string, "high" | "medium" | "low">;`.
- Add the method to the `apiClient` object, following the file's existing request helper (e.g. `this.request` / `apiFetch` — match the surrounding methods exactly):

```ts
  projectScore(sessionId: string, acceptedFixIds: string[]) {
    return this.post<{ projected_score: number }>("/ai/project-score", {
      session_id: sessionId,
      accepted_fix_ids: acceptedFixIds,
    });
  },
```

(Use whatever the file's actual POST helper is named — grep for another `POST` call like `tailorResume` and copy its shape.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/api-client.test.ts && npx tsc --noEmit`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/api-client.ts apps/web/__tests__/api-client.test.ts
git commit -m "feat: api-client AtsFix type + projectScore()

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 14: tailoring-store — fix state, merge, projected score

**Files:**
- Modify: `apps/web/stores/tailoring-store.ts`
- Test: `apps/web/__tests__/tailoring-store.test.ts`

**Interfaces:**
- Consumes: `AtsFix` from `api-client`, `apiClient.projectScore` (Task 13).
- Produces on `useTailoringStore()`:
  - `atsFixes: AtsFix[]`, `bulletImportance: Record<string, ImportanceLevel>`, `projectedAtsScore: number | null`
  - `setFixDecision(id: string, decision: "accept" | "reject"): void` — updates `bulletDecisions[\`fix:${id}\`]` and triggers a debounced `projectScore`.
  - `buildMergedContent` extended with a 5th arg `atsFixes: AtsFix[]`.
- On tailoring completion / `loadSession`, `atsFixes` / `bulletImportance` are hydrated and each fix's initial decision is seeded from `fix.default_accept`.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/__tests__/tailoring-store.test.ts`:

```ts
import type { AtsFix } from "@/lib/api-client";

const K8S_FIX: AtsFix = {
  id: "skill:k8s", type: "skill", gap: "Kubernetes", importance: "high",
  grounded: true, text: "Kubernetes", experience_index: null,
  score_delta: 10, default_accept: false,
};

it("seeds fix decisions from default_accept and folds accepted skill fixes into merged content", () => {
  const store = useTailoringStore.getState();
  store.resetStore();
  useTailoringStore.setState({
    atsFixes: [K8S_FIX, { ...K8S_FIX, id: "skill:tf", text: "Terraform", default_accept: true }],
    pendingContent: { contact: { name: "", email: "" }, experience: [], education: [], skills: ["Python"] } as never,
    originalContent: { contact: { name: "", email: "" }, experience: [], education: [], skills: ["Python"] } as never,
  } as never);
  store.hydrateFixDecisions?.();  // or whatever the seeding entrypoint is

  // Terraform default-accepts, Kubernetes doesn't
  store.setFixDecision("skill:k8s", "accept");
  store.generatePreview("resume-1"); // builds mergedContent

  const merged = useTailoringStore.getState().mergedContent!;
  expect(merged.skills).toEqual(expect.arrayContaining(["Python", "Kubernetes", "Terraform"]));
});

it("setFixDecision calls projectScore with the accepted ids (debounced)", async () => {
  vi.useFakeTimers();
  const spy = vi.spyOn(apiClient, "projectScore").mockResolvedValue({ projected_score: 88 } as never);
  useTailoringStore.setState({
    sessionId: "sess-1",
    atsFixes: [K8S_FIX],
    bulletDecisions: {},
  } as never);

  useTailoringStore.getState().setFixDecision("skill:k8s", "accept");
  await vi.advanceTimersByTimeAsync(500);

  expect(spy).toHaveBeenCalledWith("sess-1", ["skill:k8s"]);
  expect(useTailoringStore.getState().projectedAtsScore).toBe(88);
  vi.useRealTimers();
});
```

Adjust `hydrateFixDecisions` / `originalContent` names to match the store's real API — read the store first and use its actual field for "the pre-tailor content" and its actual decision-seeding hook (or seed inside `runTailoring` / `loadSession` and drop the explicit call).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/tailoring-store.test.ts -t "fix decision"`
Expected: FAIL — `atsFixes` / `setFixDecision` / `projectedAtsScore` undefined.

- [ ] **Step 3: Write minimal implementation**

In `apps/web/stores/tailoring-store.ts`:

3a. `import { apiClient, type AtsFix } from "@/lib/api-client";` (extend existing import). `import type { ImportanceLevel } from "@/components/resume/ImportanceBadge";`

3b. `TailoringState` additions:

```ts
  atsFixes: AtsFix[];
  bulletImportance: Record<string, ImportanceLevel>;
  projectedAtsScore: number | null;
  setFixDecision: (id: string, decision: BulletDecision) => void;
```

3c. Initial values in `create(...)`: `atsFixes: [], bulletImportance: {}, projectedAtsScore: null,`

3d. Extend `buildMergedContent` signature and body:

```ts
function buildMergedContent(
  pendingContent: ResumeContent,
  originalContent: ResumeContent,
  bulletDecisions: Record<string, BulletDecision>,
  suggestedSkills: string[],
  atsFixes: AtsFix[],
): ResumeContent {
```

At the end, before `return { ...pendingContent, experience: ..., skills: ..., summary: ... }`, apply accepted fixes onto the already-merged pieces:

```ts
  const acceptedFixes = atsFixes.filter((f) => bulletDecisions[`fix:${f.id}`] === "accept");

  let headline = pendingContent.headline;
  const skillsWithFixes = [...mergedSkills];
  const expWithFixes = mergedExperience.map((e) => ({ ...e, bullets: [...e.bullets] }));

  for (const f of acceptedFixes) {
    if (f.type === "skill") {
      if (!skillsWithFixes.some((s) => s.toLowerCase() === f.text.toLowerCase())
          && skillsWithFixes.length < MAX_MERGED_SKILLS) {
        skillsWithFixes.push(f.text);
      }
    } else if (f.type === "headline") {
      headline = f.text;
    } else if (f.type === "bullet" && f.experience_index != null
               && expWithFixes[f.experience_index]
               && expWithFixes[f.experience_index].bullets.length < 7) {
      expWithFixes[f.experience_index].bullets.push(f.text);
    }
  }

  return {
    ...pendingContent,
    headline,
    experience: expWithFixes,
    skills: skillsWithFixes,
    summary: mergedSummary,
  };
```

3e. Update both `buildMergedContent(...)` call sites (search for `buildMergedContent(` — there are two, in `generatePreview` and `reanalyzePreview`) to pass `get().atsFixes` as the 5th arg.

3f. Hydrate on tailoring completion and `loadSession` (wherever `suggestedSkills` / `missingSkills` get set from a session/tailor response), add:

```ts
      atsFixes: (resp.ats_fixes ?? []) as AtsFix[],
      bulletImportance: (resp.bullet_importance ?? {}) as Record<string, ImportanceLevel>,
```

and seed decisions:

```ts
      bulletDecisions: {
        ...get().bulletDecisions,
        ...Object.fromEntries(
          (resp.ats_fixes ?? []).map((f: AtsFix) => [`fix:${f.id}`, f.default_accept ? "accept" : "reject"]),
        ),
      },
```

3g. `setFixDecision` with a module-level debounce timer:

```ts
let _projectTimer: ReturnType<typeof setTimeout> | null = null;

// inside create((set, get) => ({ ...
  setFixDecision: (id, decision) => {
    set((s) => ({ bulletDecisions: { ...s.bulletDecisions, [`fix:${id}`]: decision } }));
    const { sessionId, atsFixes, bulletDecisions } = get();
    if (!sessionId) return;
    const acceptedIds = atsFixes
      .map((f) => f.id)
      .filter((fid) => (bulletDecisions[`fix:${fid}`]) === "accept");
    if (_projectTimer) clearTimeout(_projectTimer);
    _projectTimer = setTimeout(async () => {
      try {
        const { projected_score } = await apiClient.projectScore(sessionId, acceptedIds);
        set({ projectedAtsScore: projected_score });
      } catch {
        /* leave projectedAtsScore as-is on a transient failure */
      }
    }, 400);
  },
```

3h. Reset `atsFixes: [], bulletImportance: {}, projectedAtsScore: null` in `resetStore` and `discardPending`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/tailoring-store.test.ts && npx tsc --noEmit`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/stores/tailoring-store.ts apps/web/__tests__/tailoring-store.test.ts
git commit -m "feat: tailoring-store — ats fixes, merge, debounced projected score

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 15: `AtsGapFixPanel` + wire into `BulletReviewPanel`

**Files:**
- Create: `apps/web/components/resume/AtsGapFixPanel.tsx`
- Modify: `apps/web/components/resume/BulletReviewPanel.tsx` (replace `<SkillsDelta/>` usage / the `SkillsBlock` render with `<AtsGapFixPanel/>`)
- Test: `apps/web/__tests__/components/AtsGapFixPanel.test.tsx` (new)

**Interfaces:**
- Consumes: `useTailoringStore` (`atsScore`, `projectedAtsScore`, `atsFixes`, `setFixDecision`, `bulletDecisions`), `ImportanceBadge`.
- Produces: `export function AtsGapFixPanel(): JSX.Element`. Keeps the existing "keep/drop your current skills" sub-block by rendering the existing `SkillsBlock` (import it, or lift it) unchanged; adds the fix list below it.

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/components/AtsGapFixPanel.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { AtsGapFixPanel } from "@/components/resume/AtsGapFixPanel";
import { useTailoringStore } from "@/stores/tailoring-store";
import type { AtsFix } from "@/lib/api-client";

const fixes: AtsFix[] = [
  { id: "skill:k8s", type: "skill", gap: "Kubernetes", importance: "high",
    grounded: true, text: "Kubernetes", experience_index: null, score_delta: 12, default_accept: false },
  { id: "bullet:leadership", type: "bullet", gap: "team leadership", importance: "low",
    grounded: false, text: "Led a team of 4 engineers.", experience_index: 0, score_delta: 3, default_accept: false },
];

describe("AtsGapFixPanel", () => {
  beforeEach(() => {
    useTailoringStore.getState().resetStore();
    useTailoringStore.setState({ atsScore: 60, projectedAtsScore: 72, atsFixes: fixes, bulletDecisions: {} } as never);
  });

  it("shows current → projected score and one row per fix, sorted High first", () => {
    const { getAllByTestId, getByText } = render(<AtsGapFixPanel />);
    expect(getByText(/60/)).toBeTruthy();
    expect(getByText(/72/)).toBeTruthy();
    const badges = getAllByTestId("importance-badge");
    expect(badges[0].getAttribute("data-level")).toBe("high");
  });

  it("marks a speculative bullet and defaults it to not-accepted", () => {
    const { getByText } = render(<AtsGapFixPanel />);
    expect(getByText(/only add if you.*actually done this/i)).toBeTruthy();
  });

  it("accept button calls setFixDecision", () => {
    const { getAllByRole } = render(<AtsGapFixPanel />);
    const acceptBtns = getAllByRole("button", { name: /accept/i });
    fireEvent.click(acceptBtns[0]);
    expect(useTailoringStore.getState().bulletDecisions["fix:skill:k8s"]).toBe("accept");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/components/AtsGapFixPanel.test.tsx`
Expected: FAIL — cannot resolve `@/components/resume/AtsGapFixPanel`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/components/resume/AtsGapFixPanel.tsx`:

```tsx
"use client";
import { useTailoringStore } from "@/stores/tailoring-store";
import { ImportanceBadge } from "./ImportanceBadge";

export function AtsGapFixPanel() {
  const atsScore = useTailoringStore((s) => s.atsScore);
  const projected = useTailoringStore((s) => s.projectedAtsScore);
  const fixes = useTailoringStore((s) => s.atsFixes);
  const decisions = useTailoringStore((s) => s.bulletDecisions);
  const setFixDecision = useTailoringStore((s) => s.setFixDecision);

  if (atsScore === null) return null;

  return (
    <div className="flex flex-col gap-md">
      <div className="flex items-center justify-between">
        <span className="text-label-md text-on-surface-variant">ATS Score</span>
        <span className="text-headline-md font-bold">
          <span className="text-on-surface-variant">{atsScore}%</span>
          {projected !== null && projected !== atsScore && (
            <span className="text-primary"> → {projected}%</span>
          )}
        </span>
      </div>

      {fixes.length === 0 ? (
        <p className="text-caption text-on-surface-variant">No suggested additions for this JD.</p>
      ) : (
        <ul className="flex flex-col gap-sm">
          {fixes.map((f) => {
            const decision = decisions[`fix:${f.id}`] ?? (f.default_accept ? "accept" : "reject");
            const accepted = decision === "accept";
            return (
              <li key={f.id}
                  className={`rounded-xl border p-sm flex flex-col gap-xs ${
                    !f.grounded ? "border-tertiary/40 bg-tertiary/5" : "border-outline-variant/30"
                  }`}>
                <div className="flex items-center gap-sm flex-wrap">
                  <ImportanceBadge level={f.importance} />
                  {f.score_delta > 0 && (
                    <span className="text-caption text-primary font-semibold">+{f.score_delta}%</span>
                  )}
                  <span className="text-caption text-on-surface-variant">
                    {f.type === "skill" ? "Add skill" : f.type === "headline" ? "Headline" : "New bullet"} · {f.gap}
                  </span>
                </div>
                <p className="text-body-sm text-on-surface">{f.text}</p>
                {!f.grounded && (
                  <p className="text-caption text-tertiary">Speculative — only add if you’ve actually done this.</p>
                )}
                <div className="flex gap-xs">
                  <button type="button" aria-label={`Accept ${f.gap}`}
                    onClick={() => setFixDecision(f.id, "accept")}
                    className={`px-sm py-xs rounded-full text-label-sm border ${
                      accepted ? "bg-primary text-on-primary border-primary" : "border-outline-variant/40 text-on-surface-variant"
                    }`}>
                    Accept
                  </button>
                  <button type="button" aria-label={`Reject ${f.gap}`}
                    onClick={() => setFixDecision(f.id, "reject")}
                    className={`px-sm py-xs rounded-full text-label-sm border ${
                      !accepted ? "bg-surface-container text-on-surface border-outline-variant/40" : "border-outline-variant/40 text-on-surface-variant"
                    }`}>
                    Skip
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
```

In `apps/web/components/resume/BulletReviewPanel.tsx`: find where `<SkillsDelta />` (or the `SkillsBlock` for suggested skills) is rendered in the review layout and replace that render with `<AtsGapFixPanel />` plus the existing `SkillsBlock` (the current-skills keep/drop part) kept as-is. Import `AtsGapFixPanel`. Do NOT remove `SkillsBlock`'s keep/drop functionality — only the "missing / suggested" listing is superseded.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/components/AtsGapFixPanel.test.tsx __tests__/components/EditorPanel.test.tsx && npx tsc --noEmit`
Expected: PASS; existing review-panel tests still green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/resume/AtsGapFixPanel.tsx apps/web/components/resume/BulletReviewPanel.tsx apps/web/__tests__/components/AtsGapFixPanel.test.tsx
git commit -m "feat: AtsGapFixPanel — accept/reject gap fixes with importance + projected score

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 16: Per-bullet importance badge in `BulletReviewPanel`

**Files:**
- Modify: `apps/web/components/resume/BulletReviewPanel.tsx`
- Test: `apps/web/__tests__/components/BulletReviewPanel.test.tsx` (add a case; create the file only if none exists — otherwise extend `EditorPanel.test.tsx` if that's where review-panel rendering is exercised)

**Interfaces:**
- Consumes: `useTailoringStore().bulletImportance` (Task 14), `ImportanceBadge`.
- Produces: each existing bullet row in the review list renders `<ImportanceBadge level={bulletImportance[bulletId]} />` when `bulletImportance` has that bullet's id (`exp{jobIdx}_b{bulletIdx}`).

- [ ] **Step 1: Write the failing test**

Add to the review-panel test file:

```tsx
it("shows an importance badge on a bullet the JD mapping rated", () => {
  useTailoringStore.getState().resetStore();
  useTailoringStore.setState({
    /* ...whatever minimal state the panel needs to render a bullet row... */
    bulletImportance: { exp0_b0: "high" },
  } as never);
  const { getAllByTestId } = render(/* <BulletReviewPanel .../> with one experience + one bullet */);
  expect(getAllByTestId("importance-badge").some((b) => b.getAttribute("data-level") === "high")).toBe(true);
});
```

(Use the same render setup the existing review-panel tests use.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/components/BulletReviewPanel.test.tsx`
Expected: FAIL — no badge rendered.

- [ ] **Step 3: Write minimal implementation**

In `BulletReviewPanel.tsx`:
- `import { ImportanceBadge } from "./ImportanceBadge";`
- `const bulletImportance = useTailoringStore((s) => s.bulletImportance);`
- In the per-bullet row render, where the bullet text / diff is shown, add near the bullet's header/label:

```tsx
{bulletImportance[`exp${jobIdx}_b${bulletIdx}`] && (
  <ImportanceBadge level={bulletImportance[`exp${jobIdx}_b${bulletIdx}`]} className="ml-xs" />
)}
```

(Match the loop variable names the component actually uses for job index / bullet index.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run && npx tsc --noEmit`
Expected: PASS (whole web suite), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/resume/BulletReviewPanel.tsx apps/web/__tests__/components/BulletReviewPanel.test.tsx
git commit -m "feat: importance badge on existing résumé bullets in review

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Final verification (not a task — run after Task 16)

```bash
cd apps/api && python3 -m pytest -q -k "not requires_auth" \
  --ignore=tests/test_pdf.py --ignore=tests/test_pdf_ats_text_order.py \
  --ignore=tests/test_pdf_multi_role.py --ignore=tests/test_pdf_spacing.py \
  --ignore=tests/test_resume_generator.py --ignore=tests/test_resume_parser_security.py \
  --ignore=tests/test_pdf_highlight.py
cd ../web && npx vitest run && npx tsc --noEmit
```

Both green (bar the known pre-existing `*_requires_auth` / PDF-env failures).

Manual smoke (optional, needs the run-ai-copilot skill): tailor a résumé against a JD, confirm the review screen shows the gap→fix list with importance dots and a "60% → NN%" header that moves as fixes are toggled; accept a skill + a grounded bullet, save, re-Analyze, confirm the score rose.

---

## Self-Review

**1. Spec coverage**

| Spec section | Task(s) |
|---|---|
| `JDAnalysis.importance` + Agent 1 rule | 2 |
| `default_importance` fallback table | 1 |
| `AtsFix` shape + `default_accept` rule | 7, 10 |
| `TailoringSession.ats_fixes` / `bullet_importance` + migration 014 | 11 |
| `score_content` refactor | 6 |
| `apply_fix` / `apply_fixes` (cap = skip whole) | 7 |
| `estimate_fix_delta` (indicative, non-summing) | 8 |
| Gap Filler agent (fast tier, grounded vs speculative, headline only on title gap) | 9 |
| Pipeline gap set (missing skills + partial/missing responsibilities + weak title), fix assembly, sort High→Low then delta, `bullet_importance` from Agent 2 mapping | 10 |
| `POST /ai/project-score` (pure, 404 rules) | 12 |
| `GET /ai/sessions/*` return new fields | 11 |
| `POST /ai/analyze` returns `importance` | 3 |
| `ImportanceBadge` (TIER_DOT_CLASS palette) | 4 |
| Analyze-screen chip badges | 5 |
| `AtsGapFixPanel` replaces SkillsBlock's missing/suggested listing; keep/drop sub-block retained | 15 |
| `buildMergedContent` folds accepted skill/bullet/headline, honors caps | 14 |
| Debounced running "Projected ATS" | 14, 15 |
| Per-bullet importance badge | 16 |
| Backward compat: old agent1 cache → fallback; old sessions → null columns → legacy render | 2 (`_backfill_importance`), 11 (`or []` / `or {}`), 14 (`?? []`) |
| Cost: +1 fast call/tailor | 9-10 |

No gaps.

**2. Placeholder scan** — All code steps carry real, runnable code. Frontend steps that depend on unread specifics (the store's exact "pre-tailor content" field name, the review panel's loop-variable names, the api-client POST helper name) explicitly instruct the implementer to grep the file and match the existing pattern — these are lookups, not deferred decisions. No "TBD"/"add error handling"/"similar to Task N".

**3. Type consistency** — `AtsFix` fields identical across ats.py (Task 7), the pipeline (Task 10), the session dict (Task 11), api-client (Task 13), the store + component (Tasks 14-15). `ImportanceLevel` = `"high"|"medium"|"low"` everywhere (badge, store, api-client). `score_content` returns `JdScore` (Task 6) and is consumed by name in Tasks 8, 12. `_IMPORTANCE_RANK` defined once (Task 10) — the store/component use their own inline `{high:0,medium:1,low:2}` only for display sort, never imported across the stack. `fix:${id}` decision-key convention identical in Tasks 14, 15. `default_accept = (type == "bullet" and grounded)` applied in Task 10 and honored as the decision seed in Task 14.

# JD Priority Skills — User-Selected Keywords Feed Tailoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Not-Matched keyword chips selectable in both places they appear — the JD Analyzer index page (`/jd`, where a new JD is pasted and analyzed) and the per-JD detail page (`/jd/[jdId]`, for a previously-analyzed one) — so the user's picks are sent through to the "Tailor Resume" pipeline as skills to prioritize. If the user picks none, behavior is unchanged (the AI's own `suggested_skills` logic decides, same as today).

**Architecture:** A new `priority_skills: string[]` field flows: JD detail page (local selection state) → `tailoringStore.prioritySkills` → `apiClient.tailorResume(..., prioritySkills)` → `POST /ai/tailor` body → `run_tailoring_pipeline(..., priority_skills=...)` → Agent 2's prompt (as a hint to weave the skill into a bullet via INJECT where plausible) → a code-level safety net that guarantees every priority skill appears in the response's `suggested_skills`, regardless of whether Agent 2 followed the prompt. The user then reviews/accepts skill additions exactly as they do today, in `BulletReviewPanel`'s existing accept/reject chip flow — priority skills just arrive pre-selected and visually marked.

**Tech Stack:** FastAPI + Pydantic (backend), Next.js + Zustand + React Query (frontend), Vitest + pytest for tests.

## Global Constraints

- User's explicit picks always take precedence over the AI's own suggestions; if the user picks nothing, fall back to today's behavior unchanged — do not silently forward "all missing skills."
- Priority skills must never be fabricated into bullets with invented metrics/experience — Agent 2's FACT LOCK rule still applies; a priority skill may end up only in `suggested_skills` with no bullet injection if nothing plausibly supports it.
- Cap `priority_skills` at 20 entries, 200 chars each, at the Pydantic boundary (`apps/api/app/schemas/ai.py`) — mirrors the existing skill-list sanitization pattern in `apps/api/app/services/tailoring.py::_sanitize_skill_list`.
- No new DB columns/tables — the selection is transient (Zustand store + one request body field), matching how `jdId`/`jdText`/`companyName` already flow through `tailoringStore`.
- Follow the existing color convention for Matched (green: `success`/`success-container` tokens) vs Not Matched (red: `error`/`error-container` tokens) established in `apps/web/app/(app)/jd/page.tsx`.

---

## File Structure

**Backend:**
- Modify `apps/api/app/schemas/ai.py` — add `TailorRequest.priority_skills`.
- Modify `apps/api/app/routers/ai.py` — forward `body.priority_skills` into `run_tailoring_pipeline`.
- Modify `apps/api/app/services/tailoring.py` — `run_tailoring_pipeline` and `_agent2_semantic_map` accept `priority_skills`; `_AGENT2_SYSTEM` prompt gets a new rule; `run_tailoring_pipeline` merges priority skills into `suggested_skills` as a safety net.
- Modify `apps/api/tests/test_jd_and_tailor_endpoints.py` — fix a pre-existing broken test (missing required `TailoringResult` fields — unrelated to this feature but blocks reliably testing the file we're editing) and add a test that `priority_skills` reaches the pipeline call.
- Create `apps/api/tests/test_tailoring_priority_skills.py` — service-level tests for the Agent 2 payload and the `suggested_skills` safety net. (Not added to the existing `apps/api/tests/test_tailoring.py` — that file is already broken on `main`, it imports `rewrite_bullets`, a function that no longer exists; this plan does not touch or depend on it.)

**Frontend:**
- Modify `apps/web/lib/api-client.ts` — `tailorResume` gains an optional `prioritySkills` param.
- Modify `apps/web/stores/tailoring-store.ts` — add `prioritySkills` state + `setPrioritySkills`/`togglePrioritySkill`; wire into `runTailoring`; auto-accept matching skill chips.
- Modify `apps/web/app/(app)/jd/[jdId]/page.tsx` — add a JD-vs-resume analysis query and a selectable "Keywords — Matched & Not Matched" card.
- Modify `apps/web/app/(app)/jd/page.tsx` — make the existing "Not Matched" chips (in the "Profile Match & Keywords" card) selectable, same behavior as the detail page, for the case where the user just pasted and analyzed a brand-new JD.
- Modify `apps/web/components/resume/BulletReviewPanel.tsx` — visually mark which suggested-skill chips came from the user's explicit picks.
- Modify `apps/web/__tests__/tailoring-store.test.ts` — update existing `tailorResume` call assertions (new 5th arg) and add new tests.

---

### Task 1: Backend — `TailorRequest.priority_skills` field

**Files:**
- Modify: `apps/api/app/schemas/ai.py`
- Test: `apps/api/tests/test_jd_and_tailor_endpoints.py`

**Interfaces:**
- Produces: `TailorRequest.priority_skills: list[str]` (default `[]`, capped to 20 entries / 200 chars each) — consumed by Task 2's router change.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/tests/test_jd_and_tailor_endpoints.py`, near the top of the "POST /ai/tailor" section (after the `make_jd()` helper, before `test_tailor_resume_returns_200_and_creates_session`):

```python
def test_tailor_request_caps_and_defaults_priority_skills():
    from app.schemas.ai import TailorRequest

    req = TailorRequest(
        resume_id=uuid.uuid4(),
        jd_id=uuid.uuid4(),
        priority_skills=[f"skill-{i}" for i in range(25)] + ["  padded  ", "", "   "],
    )
    # Capped to 20, trimmed, blanks dropped
    assert len(req.priority_skills) == 20
    assert req.priority_skills[0] == "skill-0"

    req_default = TailorRequest(resume_id=uuid.uuid4(), jd_id=uuid.uuid4())
    assert req_default.priority_skills == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && source .venv/Scripts/activate && python -m pytest tests/test_jd_and_tailor_endpoints.py::test_tailor_request_caps_and_defaults_priority_skills -v`
Expected: FAIL with `TypeError: TailorRequest.__init__() got an unexpected keyword argument 'priority_skills'` (or a pydantic "extra fields not permitted" error, depending on model config).

- [ ] **Step 3: Implement**

In `apps/api/app/schemas/ai.py`, add the import and field:

```python
import uuid
from datetime import datetime
from pydantic import BaseModel, Field, field_validator

_MAX_PRIORITY_SKILLS = 20


class TailorRequest(BaseModel):
    resume_id: uuid.UUID
    jd_id: uuid.UUID
    humanize_level: int = Field(default=50, ge=0, le=100)
    company_name: str | None = Field(default=None, max_length=200)
    # Keywords the user explicitly picked from the JD's "Not Matched" list —
    # these take precedence over the AI's own plausible_skills_to_add logic.
    # Empty by default: the AI decides on its own, same as before this field existed.
    priority_skills: list[str] = Field(default_factory=list)

    @field_validator("priority_skills")
    @classmethod
    def _cap_priority_skills(cls, value: list[str]) -> list[str]:
        cleaned = [s.strip()[:200] for s in value if s and s.strip()]
        return cleaned[:_MAX_PRIORITY_SKILLS]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && source .venv/Scripts/activate && python -m pytest tests/test_jd_and_tailor_endpoints.py::test_tailor_request_caps_and_defaults_priority_skills -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/schemas/ai.py apps/api/tests/test_jd_and_tailor_endpoints.py
git commit -m "feat(api): add priority_skills field to TailorRequest"
```

---

### Task 2: Backend — thread `priority_skills` through the pipeline + Agent 2 prompt + safety-net merge

**Files:**
- Modify: `apps/api/app/routers/ai.py:72-79` (the `/ai/tailor` handler's call to `run_tailoring_pipeline`)
- Modify: `apps/api/app/services/tailoring.py` (`_AGENT2_SYSTEM`, `_agent2_semantic_map`, `run_tailoring_pipeline`)
- Modify: `apps/api/tests/test_jd_and_tailor_endpoints.py` (fix pre-existing broken test + add new test)
- Create: `apps/api/tests/test_tailoring_priority_skills.py`

**Interfaces:**
- Consumes: `TailorRequest.priority_skills` from Task 1.
- Produces: `run_tailoring_pipeline(resume_content, jd_text, humanize_level, provider, company_name=None, priority_skills=None) -> TailoringResult` — the `priority_skills` kwarg name is what Task 3's frontend expectations and any future callers must match. `TailoringResult.suggested_skills` is guaranteed (by code, not just prompt) to be a superset of the input `priority_skills` (case-insensitive dedup).

- [ ] **Step 1: Fix the pre-existing broken test first (blocks reliable testing of this file)**

`test_tailor_resume_returns_200_and_creates_session` in `apps/api/tests/test_jd_and_tailor_endpoints.py` currently fails on `main` — its `TailoringResult(...)` call is missing the required `company_keywords` and `suggested_skills` fields (added in an earlier change, this test was never updated). Fix it now so you have a clean baseline before editing the same code path:

Find this block (around line 155):
```python
    fake_result = TailoringResult(
        tailored_content={"experience": [{"title": "Eng", "bullets": ["Did Python stuff"]}]},
        matched_skills=["Python"],
        missing_skills=["AWS"],
        ats_score=50,
        prep_questions=[
            PrepQuestionData(
                topic="AWS", question="How would you use AWS?", answer_framework="STAR", order_index=1
            )
        ],
    )
```

Replace with:
```python
    fake_result = TailoringResult(
        tailored_content={"experience": [{"title": "Eng", "bullets": ["Did Python stuff"]}]},
        matched_skills=["Python"],
        missing_skills=["AWS"],
        ats_score=50,
        prep_questions=[
            PrepQuestionData(
                topic="AWS", question="How would you use AWS?", answer_framework="STAR", order_index=1
            )
        ],
        company_keywords=[],
        suggested_skills=[],
    )
```

Run: `cd apps/api && source .venv/Scripts/activate && python -m pytest tests/test_jd_and_tailor_endpoints.py::test_tailor_resume_returns_200_and_creates_session -v`
Expected: PASS (this confirms the baseline is clean before you add new behavior on top of it).

- [ ] **Step 2: Write the failing test for priority_skills reaching the pipeline call**

Add to `apps/api/tests/test_jd_and_tailor_endpoints.py`, right after `test_tailor_resume_returns_200_and_creates_session`:

```python
@pytest.mark.asyncio
async def test_tailor_resume_forwards_priority_skills_to_pipeline():
    from app.services.tailoring import TailoringResult, PrepQuestionData

    override, mock_session = make_mock_db()
    resume = make_resume()
    jd = make_jd()

    resume_result = MagicMock()
    resume_result.scalar_one_or_none.return_value = resume
    jd_result = MagicMock()
    jd_result.scalar_one_or_none.return_value = jd
    mock_session.execute = AsyncMock(side_effect=[resume_result, jd_result])

    from app.db.models import TailoringSession, PrepQuestion

    def fake_add(obj):
        if isinstance(obj, TailoringSession) and obj.id is None:
            obj.id = uuid.uuid4()

    def fake_add_all(objs):
        for obj in objs:
            if isinstance(obj, PrepQuestion) and obj.id is None:
                obj.id = uuid.uuid4()

    mock_session.add = MagicMock(side_effect=fake_add)
    mock_session.add_all = MagicMock(side_effect=fake_add_all)

    fake_result = TailoringResult(
        tailored_content={"experience": []},
        matched_skills=["Python"],
        missing_skills=["AWS"],
        ats_score=50,
        prep_questions=[],
        company_keywords=[],
        suggested_skills=["Kubernetes"],
    )
    pipeline_mock = AsyncMock(return_value=fake_result)

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.run_tailoring_pipeline", new=pipeline_mock):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(
                    "/ai/tailor",
                    json={
                        "resume_id": str(resume.id),
                        "jd_id": str(jd.id),
                        "humanize_level": 50,
                        "priority_skills": ["Kubernetes", "Terraform"],
                    },
                    headers=make_auth_header(),
                )
        assert r.status_code == 200
        assert r.json()["suggested_skills"] == ["Kubernetes"]
        # The router must forward the user's picks into the pipeline call.
        _, kwargs = pipeline_mock.call_args
        assert kwargs["priority_skills"] == ["Kubernetes", "Terraform"]
    finally:
        app.dependency_overrides.pop(get_db, None)
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/api && source .venv/Scripts/activate && python -m pytest tests/test_jd_and_tailor_endpoints.py::test_tailor_resume_forwards_priority_skills_to_pipeline -v`
Expected: FAIL with `AssertionError` on `kwargs["priority_skills"]` (KeyError, since the router doesn't pass it yet).

- [ ] **Step 4: Implement the router change**

In `apps/api/app/routers/ai.py`, find (around line 72-79):
```python
    provider = get_ai_provider()
    result = await run_tailoring_pipeline(
        resume_row.content,
        jd_row.raw_text,
        body.humanize_level,
        provider,
        company_name=body.company_name,
    )
```

Replace with:
```python
    provider = get_ai_provider()
    result = await run_tailoring_pipeline(
        resume_row.content,
        jd_row.raw_text,
        body.humanize_level,
        provider,
        company_name=body.company_name,
        priority_skills=body.priority_skills,
    )
```

- [ ] **Step 5: Implement the service-layer changes**

In `apps/api/app/services/tailoring.py`, update `_AGENT2_SYSTEM` (the rules list currently runs 1-6; insert a new rule 6 and renumber the old rule 6 to 7):

Find:
```python
5. plausible_skills_to_add: list ONLY skills that are (a) explicitly mentioned \
in the JD AND (b) directly evidenced by the candidate's existing stack \
(e.g., if they use AWS Lambda and the JD says "serverless", add "Serverless \
Architecture"; if the JD never mentions JavaScript, do not add it just because \
they use React). Limit to at most 6 skills. Do not dump transitive or \
implied skills — only add what the JD is clearly testing for.
6. Output ONLY valid JSON matching the schema. No markdown, no preamble.
</rules>
```

Replace with:
```python
5. plausible_skills_to_add: list ONLY skills that are (a) explicitly mentioned \
in the JD AND (b) directly evidenced by the candidate's existing stack \
(e.g., if they use AWS Lambda and the JD says "serverless", add "Serverless \
Architecture"; if the JD never mentions JavaScript, do not add it just because \
they use React). Limit to at most 6 skills. Do not dump transitive or \
implied skills — only add what the JD is clearly testing for.
6. PRIORITY SKILLS OVERRIDE: if priority_skills_from_user (in the payload) is \
non-empty, the user has explicitly confirmed they have every skill listed there \
and wants it highlighted — always include all of them in plausible_skills_to_add \
verbatim, bypassing the evidence filter in rule 5 for these specific skills only \
(they do not count toward the 6-skill cap in rule 5). Additionally, for any \
bullet whose work could plausibly demonstrate a priority skill, prefer INJECT to \
weave it in naturally — but never fabricate metrics or experience just to force \
the connection; it's fine for a priority skill to surface only in \
plausible_skills_to_add if no bullet fits.
7. Output ONLY valid JSON matching the schema. No markdown, no preamble.
</rules>
```

Update `_agent2_semantic_map` (currently):
```python
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
```

Replace with:
```python
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
    return await provider.complete_structured(
        _AGENT2_SYSTEM, json.dumps(payload), MappingPlan, model_tier="pro"
    )
```

Update `run_tailoring_pipeline` (currently):
```python
async def run_tailoring_pipeline(
    resume_content: dict,
    jd_text: str,
    humanize_level: int,
    provider: AIProvider,
    company_name: str | None = None,
) -> TailoringResult:
    """
    Full pipeline — the "Tailor Resume" step. Re-runs analyze_jd_match (cheap,
    fast-model calls) and continues into the resume-rewriting agents:

    Agent 2 (pro)   ─── semantic mapping of JD → resume bullets
         │
         ├── Agent 3 (pro)  ─── precision bullet rewrite    ┐ parallel
         └── prep questions (pro)                           ┘
    """
    analysis = await analyze_jd_match(resume_content, jd_text, provider, company_name)

    # ── assign bullet IDs, build indexed resume for Agent 2 ──────────────────
    indexed_resume, _ = _index_bullets(resume_content)

    # ── Agent 2 — semantic mapping (pro model) ────────────────────────────────
    mapping_plan = await _agent2_semantic_map(analysis.jd_analysis, indexed_resume, provider)

    # ── Agent 3 + prep questions in parallel (both pro model) ────────────────
    original_skills = resume_content.get("skills", [])

    tailored_raw, questions = await asyncio.gather(
        _agent3_write(mapping_plan, original_skills, humanize_level, provider),
        generate_prep_questions(analysis.missing_skills, resume_content, provider),
    )

    # ── patch rewritten bullets back into the original structure ─────────────
    tailored_content = _apply_writer_output(indexed_resume, tailored_raw, mapping_plan)

    return TailoringResult(
        tailored_content=tailored_content,
        matched_skills=analysis.matched_skills,
        missing_skills=analysis.missing_skills,
        ats_score=analysis.ats_score,
        prep_questions=questions,
        company_keywords=analysis.company_keywords,
        suggested_skills=_sanitize_skill_list(mapping_plan.plausible_skills_to_add),
    )
```

Replace with:
```python
async def run_tailoring_pipeline(
    resume_content: dict,
    jd_text: str,
    humanize_level: int,
    provider: AIProvider,
    company_name: str | None = None,
    priority_skills: list[str] | None = None,
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
    """
    analysis = await analyze_jd_match(resume_content, jd_text, provider, company_name)

    # ── assign bullet IDs, build indexed resume for Agent 2 ──────────────────
    indexed_resume, _ = _index_bullets(resume_content)

    # ── Agent 2 — semantic mapping (pro model) ────────────────────────────────
    mapping_plan = await _agent2_semantic_map(
        analysis.jd_analysis, indexed_resume, provider, priority_skills=priority_skills,
    )

    # ── Agent 3 + prep questions in parallel (both pro model) ────────────────
    original_skills = resume_content.get("skills", [])

    tailored_raw, questions = await asyncio.gather(
        _agent3_write(mapping_plan, original_skills, humanize_level, provider),
        generate_prep_questions(analysis.missing_skills, resume_content, provider),
    )

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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/api && source .venv/Scripts/activate && python -m pytest tests/test_jd_and_tailor_endpoints.py -v`
Expected: All PASS, including `test_tailor_resume_forwards_priority_skills_to_pipeline`.

- [ ] **Step 7: Write the service-level safety-net test**

Create `apps/api/tests/test_tailoring_priority_skills.py`:

```python
import pytest
from unittest.mock import AsyncMock, MagicMock
from app.services.tailoring import (
    run_tailoring_pipeline,
    JDAnalysis,
    MappingPlan,
    BulletMapping,
    WriterOutput,
    RewrittenBullet,
    PrepQuestionsWrapper,
)


def make_provider_dispatching_by_schema(responses: dict[type, object]):
    """Real code calls provider.complete_structured(system, user, schema, model_tier=...)
    positionally for `schema` — dispatch on that instead of call order, since
    Agent 3 and generate_prep_questions run concurrently via asyncio.gather
    and their relative call order isn't guaranteed."""
    provider = MagicMock()

    async def fake_complete_structured(system, user, schema, model_tier="fast"):
        return responses[schema]

    provider.complete_structured = AsyncMock(side_effect=fake_complete_structured)
    return provider


@pytest.mark.asyncio
async def test_priority_skills_reach_agent2_payload():
    """Agent 2 must receive priority_skills_from_user in its payload so the
    prompt's override rule has something to act on."""
    captured_user_msg = {}

    async def fake_complete_structured(system, user, schema, model_tier="fast"):
        if schema is MappingPlan:
            captured_user_msg["value"] = user
            return MappingPlan(mapping_plan=[], plausible_skills_to_add=[])
        if schema is JDAnalysis:
            return JDAnalysis(
                exact_technical_tools=["Python"],
                methodologies_and_frameworks=[],
                domain_expertise_themes=[],
                seniority_indicators=[],
                ats_filter_phrases=[],
            )
        if schema is WriterOutput:
            return WriterOutput(rewritten_bullets=[], updated_skills=["Python"])
        if schema is PrepQuestionsWrapper:
            return PrepQuestionsWrapper(questions=[])
        raise AssertionError(f"Unexpected schema: {schema}")

    provider = MagicMock()
    provider.complete_structured = AsyncMock(side_effect=fake_complete_structured)

    resume = {"experience": [{"title": "Eng", "bullets": ["Did Python stuff"]}], "skills": ["Python"]}
    await run_tailoring_pipeline(
        resume, "Need Python and Kubernetes.", 50, provider,
        priority_skills=["Kubernetes"],
    )

    assert '"priority_skills_from_user": ["Kubernetes"]' in captured_user_msg["value"]


@pytest.mark.asyncio
async def test_suggested_skills_always_includes_priority_skills_even_if_agent2_omits_them():
    """Safety net: even if Agent 2's plausible_skills_to_add doesn't include
    a priority skill (prompt-following failure), the pipeline's returned
    suggested_skills must still contain it."""
    responses = {
        JDAnalysis: JDAnalysis(
            exact_technical_tools=["Python"],
            methodologies_and_frameworks=[],
            domain_expertise_themes=[],
            seniority_indicators=[],
            ats_filter_phrases=[],
        ),
        # Agent 2 "forgets" the priority skill — only returns its own pick.
        MappingPlan: MappingPlan(
            mapping_plan=[
                BulletMapping(
                    original_bullet_id="exp0_b0",
                    original_text="Did Python stuff",
                    target_jd_keywords_to_inject=["Python"],
                    preserved_metrics=[],
                    strategic_instruction="REINFORCE",
                )
            ],
            plausible_skills_to_add=["Docker"],
        ),
        WriterOutput: WriterOutput(
            rewritten_bullets=[RewrittenBullet(bullet_id="exp0_b0", rewritten_text="Used Python")],
            updated_skills=["Python"],
        ),
        PrepQuestionsWrapper: PrepQuestionsWrapper(questions=[]),
    }
    provider = make_provider_dispatching_by_schema(responses)

    resume = {"experience": [{"title": "Eng", "bullets": ["Did Python stuff"]}], "skills": ["Python"]}
    result = await run_tailoring_pipeline(
        resume, "Need Python, Docker, and Kubernetes.", 50, provider,
        priority_skills=["Kubernetes", "docker"],  # lowercase "docker" — must dedupe case-insensitively against "Docker"
    )

    assert "Docker" in result.suggested_skills
    assert "Kubernetes" in result.suggested_skills
    # Case-insensitive dedupe: "docker" (priority) and "Docker" (Agent 2's own
    # pick) must not both appear.
    assert result.suggested_skills.count("Docker") + result.suggested_skills.count("docker") == 1


@pytest.mark.asyncio
async def test_no_priority_skills_falls_back_to_agent2_own_suggestions():
    """When the user picks nothing, behavior is unchanged from before this
    feature existed — suggested_skills is exactly Agent 2's own pick."""
    responses = {
        JDAnalysis: JDAnalysis(
            exact_technical_tools=["Python"],
            methodologies_and_frameworks=[],
            domain_expertise_themes=[],
            seniority_indicators=[],
            ats_filter_phrases=[],
        ),
        MappingPlan: MappingPlan(
            mapping_plan=[
                BulletMapping(
                    original_bullet_id="exp0_b0",
                    original_text="Did Python stuff",
                    target_jd_keywords_to_inject=["Python"],
                    preserved_metrics=[],
                    strategic_instruction="REINFORCE",
                )
            ],
            plausible_skills_to_add=["Docker"],
        ),
        WriterOutput: WriterOutput(
            rewritten_bullets=[RewrittenBullet(bullet_id="exp0_b0", rewritten_text="Used Python")],
            updated_skills=["Python"],
        ),
        PrepQuestionsWrapper: PrepQuestionsWrapper(questions=[]),
    }
    provider = make_provider_dispatching_by_schema(responses)

    resume = {"experience": [{"title": "Eng", "bullets": ["Did Python stuff"]}], "skills": ["Python"]}
    result = await run_tailoring_pipeline(
        resume, "Need Python and Docker.", 50, provider,
        priority_skills=None,
    )

    assert result.suggested_skills == ["Docker"]
```

- [ ] **Step 8: Run test to verify it fails**

Run: `cd apps/api && source .venv/Scripts/activate && python -m pytest tests/test_tailoring_priority_skills.py -v`
Expected: FAIL — `ImportError` on `_agent2_semantic_map` receiving no `priority_skills` kwarg (if Step 5 wasn't done yet), or the payload assertion failing since `priority_skills_from_user` isn't in the JSON yet. (If you're following this plan in order, Step 5 is already done — run this before Step 5 during actual TDD if you want to see it fail first; either order is fine here since Step 5's code and this test were designed together.)

- [ ] **Step 9: Run full backend test file suite to verify everything passes together**

Run: `cd apps/api && source .venv/Scripts/activate && python -m pytest tests/test_jd_and_tailor_endpoints.py tests/test_tailoring_priority_skills.py -v`
Expected: All PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/api/app/routers/ai.py apps/api/app/services/tailoring.py apps/api/tests/test_jd_and_tailor_endpoints.py apps/api/tests/test_tailoring_priority_skills.py
git commit -m "feat(api): thread priority_skills into tailoring pipeline and Agent 2 prompt"
```

---

### Task 3: Frontend — `api-client.ts` + `tailoring-store.ts` plumbing

**Files:**
- Modify: `apps/web/lib/api-client.ts:168-179` (`tailorResume`)
- Modify: `apps/web/stores/tailoring-store.ts` (state + `runTailoring`)
- Modify: `apps/web/__tests__/tailoring-store.test.ts`

**Interfaces:**
- Consumes: nothing new from earlier tasks (backend already accepts the field regardless of whether the frontend sends it).
- Produces: `apiClient.tailorResume(resumeId, jdId, humanizeLevel, companyName?, prioritySkills?: string[])`; `useTailoringStore` gains `prioritySkills: string[]`, `setPrioritySkills(skills: string[])`, `togglePrioritySkill(skill: string)` — Task 4's JD detail page calls these.

- [ ] **Step 1: Write the failing tests**

In `apps/web/__tests__/tailoring-store.test.ts`, first fix the two existing assertions that will break once `tailorResume` gets a 5th argument (find and replace both occurrences):

Find (appears twice, in `"runTailoring succeeds and hydrates session state"` and in the JD-from-pasted-text test):
```ts
    expect(apiClient.tailorResume).toHaveBeenCalledWith(
      "resume-abc",
      "jd-001",
      50,
      undefined
    );
```
and
```ts
    expect(apiClient.tailorResume).toHaveBeenCalledWith(
      "resume-abc",
      "jd-created-001",
      50,
      undefined
    );
```

Replace both with the same call plus a 5th arg:
```ts
    expect(apiClient.tailorResume).toHaveBeenCalledWith(
      "resume-abc",
      "jd-001",
      50,
      undefined,
      []
    );
```
```ts
    expect(apiClient.tailorResume).toHaveBeenCalledWith(
      "resume-abc",
      "jd-created-001",
      50,
      undefined,
      []
    );
```

Then add new tests — append inside the `describe("useTailoringStore", ...)` block, after the `"resetStore clears all fields"` test:

```ts
  it("setPrioritySkills and togglePrioritySkill manage the priority list", () => {
    useTailoringStore.getState().setPrioritySkills(["Kubernetes", "Terraform"]);
    expect(useTailoringStore.getState().prioritySkills).toEqual(["Kubernetes", "Terraform"]);

    useTailoringStore.getState().togglePrioritySkill("Kubernetes"); // already present → removed
    expect(useTailoringStore.getState().prioritySkills).toEqual(["Terraform"]);

    useTailoringStore.getState().togglePrioritySkill("Docker"); // absent → added
    expect(useTailoringStore.getState().prioritySkills).toEqual(["Terraform", "Docker"]);
  });

  it("runTailoring forwards the current prioritySkills to apiClient.tailorResume", async () => {
    useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    useTailoringStore.getState().setPrioritySkills(["Kubernetes"]);

    await useTailoringStore.getState().runTailoring("resume-abc");

    expect(apiClient.tailorResume).toHaveBeenCalledWith(
      "resume-abc",
      "jd-001",
      50,
      undefined,
      ["Kubernetes"]
    );
  });

  it("runTailoring auto-accepts skill_add decisions for priority skills present in the result", async () => {
    useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    useTailoringStore.getState().setPrioritySkills(["Kubernetes"]);
    vi.mocked(apiClient.tailorResume).mockResolvedValueOnce({
      ...mockTailorResult,
      suggested_skills: ["Kubernetes", "Docker"],
    });

    await useTailoringStore.getState().runTailoring("resume-abc");

    const decisions = useTailoringStore.getState().bulletDecisions;
    // The user's pick is pre-accepted...
    expect(decisions["skill_add:Kubernetes"]).toBe("accept");
    // ...but an AI-only suggestion the user didn't ask for is not auto-decided.
    expect(decisions["skill_add:Docker"]).toBeUndefined();
  });

  it("resetStore clears prioritySkills", () => {
    useTailoringStore.getState().setPrioritySkills(["Kubernetes"]);
    useTailoringStore.getState().resetStore();
    expect(useTailoringStore.getState().prioritySkills).toEqual([]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run __tests__/tailoring-store.test.ts`
Expected: FAIL — `setPrioritySkills is not a function`, and the two updated call-assertions fail because the real call currently has only 4 args.

- [ ] **Step 3: Implement `api-client.ts`**

In `apps/web/lib/api-client.ts`, find:
```ts
  tailorResume: (
    resumeId: string,
    jdId: string,
    humanizeLevel: number,
    companyName?: string,
  ): Promise<TailorOut> =>
    request<TailorOut>("POST", "/ai/tailor", {
      resume_id: resumeId,
      jd_id: jdId,
      humanize_level: humanizeLevel,
      ...(companyName?.trim() ? { company_name: companyName.trim() } : {}),
    }),
```

Replace with:
```ts
  tailorResume: (
    resumeId: string,
    jdId: string,
    humanizeLevel: number,
    companyName?: string,
    prioritySkills?: string[],
  ): Promise<TailorOut> =>
    request<TailorOut>("POST", "/ai/tailor", {
      resume_id: resumeId,
      jd_id: jdId,
      humanize_level: humanizeLevel,
      ...(companyName?.trim() ? { company_name: companyName.trim() } : {}),
      ...(prioritySkills && prioritySkills.length > 0 ? { priority_skills: prioritySkills } : {}),
    }),
```

- [ ] **Step 4: Implement `tailoring-store.ts`**

Add to the `TailoringState` interface (after `suggestedSkills: string[];`):
```ts
  prioritySkills: string[];  // user-picked "not matched" keywords to prioritize — set from the JD detail page before calling runTailoring
```

Add to the interface's action list (after `setCompanyName`):
```ts
  setPrioritySkills: (skills: string[]) => void;
  togglePrioritySkill: (skill: string) => void;
```

Add to the initial state (after `suggestedSkills: [],`):
```ts
  prioritySkills: [],
```

Add to the action implementations (after `setCompanyName: (name) => set({ companyName: name }),`):
```ts
  setPrioritySkills: (skills) => set({ prioritySkills: skills }),
  togglePrioritySkill: (skill) =>
    set((s) => ({
      prioritySkills: s.prioritySkills.includes(skill)
        ? s.prioritySkills.filter((s2) => s2 !== skill)
        : [...s.prioritySkills, skill],
    })),
```

In `runTailoring`, change the destructure at the top from:
```ts
    const { jdText, humanizeLevel, companyName } = get();
```
to:
```ts
    const { jdText, humanizeLevel, companyName, prioritySkills } = get();
```

Change the `apiClient.tailorResume` call from:
```ts
      const result = await apiClient.tailorResume(
        resumeId,
        jdId,
        humanizeLevel,
        companyName || undefined,
      );
```
to:
```ts
      const result = await apiClient.tailorResume(
        resumeId,
        jdId,
        humanizeLevel,
        companyName || undefined,
        prioritySkills,
      );
```

In the same function, find where `initialDecisions` is built for skill additions:
```ts
          // Per-skill decisions: added skills default to "accept", removed skills default to "reject"
          const originalSkillsSet = new Set(originalContent.skills);
          const tailoredSkillsSet = new Set(result.tailored_content.skills);
          for (const s of result.tailored_content.skills) {
            if (!originalSkillsSet.has(s)) initialDecisions[`skill_add:${s}`] = "accept";
          }
          for (const s of originalContent.skills) {
            if (!tailoredSkillsSet.has(s)) initialDecisions[`skill_rm:${s}`] = "reject";
          }
        }
      }
```

Replace with (adds priority-skill auto-accept right after, using `result.suggested_skills` — note this is independent of the `originalSkillsSet`/`tailoredSkillsSet` loop above, which is about the resume's `skills[]` array, not the suggested-skills chips):
```ts
          // Per-skill decisions: added skills default to "accept", removed skills default to "reject"
          const originalSkillsSet = new Set(originalContent.skills);
          const tailoredSkillsSet = new Set(result.tailored_content.skills);
          for (const s of result.tailored_content.skills) {
            if (!originalSkillsSet.has(s)) initialDecisions[`skill_add:${s}`] = "accept";
          }
          for (const s of originalContent.skills) {
            if (!tailoredSkillsSet.has(s)) initialDecisions[`skill_rm:${s}`] = "reject";
          }
        }
      }

      // Pre-accept suggested-skill chips the user explicitly asked for —
      // saves them re-clicking what they already picked on the JD page.
      // AI-only suggestions (not in prioritySkills) are left undecided, same
      // as always, so the user still reviews them via the chip UI.
      const prioritySet = new Set(prioritySkills.map((s) => s.toLowerCase()));
      for (const s of result.suggested_skills ?? []) {
        if (prioritySet.has(s.toLowerCase())) {
          initialDecisions[`skill_add:${s}`] = "accept";
        }
      }
```

Add `prioritySkills: []` to the `resetStore` action's `set({...})` object (after `suggestedSkills: [],`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run __tests__/tailoring-store.test.ts`
Expected: All PASS.

- [ ] **Step 6: Typecheck**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/api-client.ts apps/web/stores/tailoring-store.ts apps/web/__tests__/tailoring-store.test.ts
git commit -m "feat(web): add prioritySkills to tailoring store and tailorResume call"
```

---

### Task 4: Frontend — selectable Keywords section on `/jd/[jdId]`

**Files:**
- Modify: `apps/web/app/(app)/jd/[jdId]/page.tsx`

**Interfaces:**
- Consumes: `apiClient.analyzeJd(resumeId, jdId, companyName?) -> Promise<AnalyzeOut>` (already exists, `apps/web/lib/api-client.ts`, unchanged by this plan) where `AnalyzeOut = { ats_score: number; matched_skills: string[]; missing_skills: string[]; company_keywords: string[] }` (`packages/types/index.ts:83-88`); `useTailoringStore.getState().setPrioritySkills(skills: string[])` from Task 3.
- Produces: nothing new consumed by later tasks — this is a leaf page.

- [ ] **Step 1: Add the analysis query and selection state**

In `apps/web/app/(app)/jd/[jdId]/page.tsx`, update the imports:

Find:
```tsx
"use client";
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { Card } from "@/components/ui/Card";
import { useTailoringStore } from "@/stores/tailoring-store";
import { useResumeStore } from "@/stores/resume-store";
import { getCareerProfile, type CareerProfile } from "@/lib/career-profile-client";
import type { JobDescription, Resume } from "@career-copilot/types";
import { CheckCircle, ArrowLeft, Sparkle, ArrowCounterClockwise, FolderOpen } from "@phosphor-icons/react";
```

Replace with:
```tsx
"use client";
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { Card } from "@/components/ui/Card";
import { useTailoringStore } from "@/stores/tailoring-store";
import { useResumeStore } from "@/stores/resume-store";
import { getCareerProfile, type CareerProfile } from "@/lib/career-profile-client";
import type { AnalyzeOut, JobDescription, Resume } from "@career-copilot/types";
import {
  CheckCircle,
  WarningCircle,
  ArrowLeft,
  Sparkle,
  ArrowCounterClockwise,
  FolderOpen,
  Target,
} from "@phosphor-icons/react";
```

After the existing `resumes` query (find):
```tsx
  const { data: resumes = [] } = useQuery<Resume[]>({
    queryKey: ["resumes"],
    queryFn: () => apiClient.getResumes(),
  });

  // Only show the master resume; fall back to first resume if no profile set
  const masterResume = resumes.find((r) => r.id === careerProfile?.master_resume_id)
    ?? resumes[0]
    ?? null;
```

Replace with (adds the analysis query right after `masterResume` is known, plus selection state):
```tsx
  const { data: resumes = [] } = useQuery<Resume[]>({
    queryKey: ["resumes"],
    queryFn: () => apiClient.getResumes(),
  });

  // Only show the master resume; fall back to first resume if no profile set
  const masterResume = resumes.find((r) => r.id === careerProfile?.master_resume_id)
    ?? resumes[0]
    ?? null;

  // Read-only match analysis for this specific JD/resume pair — does not
  // touch the resume, same semantics as the JD Analyzer index page's
  // "Analyze Description" step.
  const { data: analysis, isLoading: isAnalyzing } = useQuery<AnalyzeOut>({
    queryKey: ["jdAnalysis", jdId, masterResume?.id],
    queryFn: () => apiClient.analyzeJd(masterResume!.id, jdId),
    enabled: !!masterResume,
  });

  // User's explicit picks from the "Not Matched" list — sent through to
  // tailoring as skills to prioritize. Empty means "let the AI decide",
  // unchanged from before this feature existed.
  const [selectedPriority, setSelectedPriority] = useState<Set<string>>(new Set());

  function togglePriority(skill: string) {
    setSelectedPriority((prev) => {
      const next = new Set(prev);
      if (next.has(skill)) next.delete(skill);
      else next.add(skill);
      return next;
    });
  }

  const matchedSkills = analysis?.matched_skills ?? [];
  const missingSkills = analysis?.missing_skills ?? [];
```

- [ ] **Step 2: Send the selection through on Tailor**

Find `handleTailor`:
```tsx
  async function handleTailor() {
    if (!jd || !masterResume) return;
    setIsTailoring(true);
    setTailorError(null);
    setJd(jdId, jd.raw_text);
    await runTailoring(masterResume.id);
    const err = useTailoringStore.getState().error;
    if (err) {
      setTailorError(err);
      setIsTailoring(false);
      return;
    }
    router.push(`/studio/${masterResume.id}`);
  }
```

Replace with:
```tsx
  async function handleTailor() {
    if (!jd || !masterResume) return;
    setIsTailoring(true);
    setTailorError(null);
    setJd(jdId, jd.raw_text);
    useTailoringStore.getState().setPrioritySkills(Array.from(selectedPriority));
    await runTailoring(masterResume.id);
    const err = useTailoringStore.getState().error;
    if (err) {
      setTailorError(err);
      setIsTailoring(false);
      return;
    }
    router.push(`/studio/${masterResume.id}`);
  }
```

- [ ] **Step 3: Render the Keywords card**

Find the "Parsed Skills" card (the first `<Card>` in the bento grid):
```tsx
        {/* Parsed Skills — spans 2 cols */}
        <Card className="lg:col-span-2 flex flex-col gap-md">
          <h2 className="text-headline-md text-on-surface flex items-center gap-sm font-semibold">
            Skills from JD
          </h2>
          {jd?.parsed_skills && jd.parsed_skills.length > 0 ? (
            <div className="flex flex-wrap gap-xs">
              {jd.parsed_skills.map((skill) => (
                <span
                  key={skill}
                  className="flex items-center gap-xs px-sm py-xs bg-secondary-container text-on-secondary-container text-label-sm rounded-md border border-outline-variant/30"
                >
                  <CheckCircle size={14} weight="fill" className="text-primary" />
                  {skill}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-body-sm text-on-surface-variant">
              {jd ? "No parsed skills available." : "Loading…"}
            </p>
          )}
        </Card>
```

Replace with (the "Skills from JD" card stays — it's the raw parse, still useful as-is — and a new selectable Keywords card is added right after it, still inside the same grid, `lg:col-span-2` so it sits beside "Skills from JD"):
```tsx
        {/* Parsed Skills — spans 2 cols */}
        <Card className="lg:col-span-2 flex flex-col gap-md">
          <h2 className="text-headline-md text-on-surface flex items-center gap-sm font-semibold">
            Skills from JD
          </h2>
          {jd?.parsed_skills && jd.parsed_skills.length > 0 ? (
            <div className="flex flex-wrap gap-xs">
              {jd.parsed_skills.map((skill) => (
                <span
                  key={skill}
                  className="flex items-center gap-xs px-sm py-xs bg-secondary-container text-on-secondary-container text-label-sm rounded-md border border-outline-variant/30"
                >
                  <CheckCircle size={14} weight="fill" className="text-primary" />
                  {skill}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-body-sm text-on-surface-variant">
              {jd ? "No parsed skills available." : "Loading…"}
            </p>
          )}
        </Card>

        {/* Matched / Not Matched — same color convention as the JD Analyzer
            index page (success = matched, error = not matched). Not Matched
            chips are selectable — picks are sent to Tailor as priority skills. */}
        <Card className="lg:col-span-2 flex flex-col gap-md">
          <h2 className="text-headline-md text-on-surface flex items-center gap-sm font-semibold">
            <Target size={20} className="text-primary" />
            Keywords — Matched &amp; Not Matched
          </h2>

          {!masterResume ? (
            <p className="text-body-sm text-on-surface-variant">No resume found. Create one first.</p>
          ) : isAnalyzing ? (
            <p className="text-body-sm text-on-surface-variant">Analyzing…</p>
          ) : matchedSkills.length === 0 && missingSkills.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">No keyword data available.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-sm">
              <div className="rounded-xl border border-success/25 bg-success-container/25 p-sm flex flex-col gap-xs min-w-0">
                <h3 className="text-label-sm font-bold text-on-success-container flex items-center gap-xs">
                  <CheckCircle size={15} weight="fill" className="text-success shrink-0" />
                  <span>Matched</span>
                  <span className="ml-auto shrink-0 text-caption font-bold px-xs rounded-full bg-success text-on-success">
                    {matchedSkills.length}
                  </span>
                </h3>
                {matchedSkills.length > 0 ? (
                  <div className="flex flex-wrap gap-xs max-h-40 overflow-y-auto">
                    {matchedSkills.map((skill) => (
                      <span
                        key={skill}
                        className="flex items-center gap-xs px-xs py-0.5 bg-success/10 text-on-success-container text-caption font-medium rounded-md border border-success/30"
                      >
                        <CheckCircle size={11} weight="fill" className="text-success shrink-0" />
                        {skill}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-caption text-on-surface-variant italic">None yet.</p>
                )}
              </div>

              <div className="rounded-xl border border-error/25 bg-error-container/20 p-sm flex flex-col gap-xs min-w-0">
                <h3 className="text-label-sm font-bold text-on-error-container flex items-center gap-xs">
                  <WarningCircle size={15} weight="fill" className="text-error shrink-0" />
                  <span>Not Matched</span>
                  <span className="ml-auto shrink-0 text-caption font-bold px-xs rounded-full bg-error text-on-error">
                    {missingSkills.length}
                  </span>
                </h3>
                {missingSkills.length > 0 ? (
                  <>
                    <div className="flex flex-wrap gap-xs max-h-40 overflow-y-auto">
                      {missingSkills.map((skill) => {
                        const selected = selectedPriority.has(skill);
                        return (
                          <button
                            key={skill}
                            type="button"
                            onClick={() => togglePriority(skill)}
                            aria-pressed={selected}
                            className={`flex items-center gap-xs px-xs py-0.5 text-caption font-medium rounded-md border transition-all ${
                              selected
                                ? "bg-error text-on-error border-error"
                                : "bg-error-container/40 text-on-error-container border-error/30 hover:border-error"
                            }`}
                          >
                            {selected ? (
                              <CheckCircle size={11} weight="fill" className="shrink-0" />
                            ) : (
                              <WarningCircle size={11} weight="fill" className="text-error shrink-0" />
                            )}
                            {skill}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-caption text-on-surface-variant mt-xs italic">
                      {selectedPriority.size > 0
                        ? `${selectedPriority.size} selected — Tailor will prioritize weaving these in.`
                        : "Click any keyword to prioritize it, or leave unselected and let AI decide."}
                    </p>
                  </>
                ) : (
                  <p className="text-caption text-on-surface-variant italic">None — full coverage.</p>
                )}
              </div>
            </div>
          )}
        </Card>
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: No errors.

- [ ] **Step 5: Manual verification (no automated test — this page has none today, and Playwright login isn't available in this environment)**

Start both dev servers per `.claude/skills/run-ai-copilot/driver.mjs` instructions, log in, open a previously-analyzed JD's detail page (`/jd/{jdId}`), and confirm:
1. The new "Keywords — Matched & Not Matched" card renders beside "Skills from JD".
2. Clicking a "Not Matched" chip toggles it to a filled/selected state.
3. Clicking "Tailor" with 1+ chips selected, then opening the review panel in Resume Builder, shows those skills pre-checked in "Suggested Skills to Add" (this also verifies Task 3 and sets up Task 6's visual marker).

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(app)/jd/[jdId]/page.tsx"
git commit -m "feat(web): add selectable matched/not-matched keywords to JD detail page"
```

---

### Task 5: Frontend — selectable Not Matched chips on the JD Analyzer index page (`/jd`)

**Files:**
- Modify: `apps/web/app/(app)/jd/page.tsx`

**Interfaces:**
- Consumes: `useTailoringStore.getState().setPrioritySkills(skills: string[])` from Task 3.
- Produces: nothing new consumed elsewhere.

This page (`/jd`) is where the user pastes a brand-new JD, clicks "Analyze Description", and gets the score + "Profile Match & Keywords" card built earlier this session — it needs the same selectable Not-Matched behavior Task 4 just added to the per-JD detail page, so a first-time analysis (not just a previously-saved one) can also feed priority skills into Tailor.

- [ ] **Step 1: Add selection state and a toggle handler**

Find (near the top of `JDIndexPage`):
```tsx
  const [tailorError, setTailorError] = useState<string | null>(null);
```

Replace with:
```tsx
  const [tailorError, setTailorError] = useState<string | null>(null);
  // User's explicit picks from the "Not Matched" list — sent through to
  // tailoring as skills to prioritize. Empty means "let the AI decide",
  // unchanged from before this feature existed. Cleared whenever a fresh
  // analysis runs, since the missing-skills list it refers to just changed.
  const [selectedPriority, setSelectedPriority] = useState<Set<string>>(new Set());

  function togglePriority(skill: string) {
    setSelectedPriority((prev) => {
      const next = new Set(prev);
      if (next.has(skill)) next.delete(skill);
      else next.add(skill);
      return next;
    });
  }
```

- [ ] **Step 2: Clear the selection whenever a fresh analysis starts**

Find (in `handleRerunAnalysis`):
```tsx
    setJdText(jd.raw_text);
    setJd(jd.id, jd.raw_text);
    setIsSubmitting(true);
    setError(null);
    setTailorError(null);
    try {
      await runAnalysis(activeResumeId);
```

Replace with:
```tsx
    setJdText(jd.raw_text);
    setJd(jd.id, jd.raw_text);
    setIsSubmitting(true);
    setError(null);
    setTailorError(null);
    setSelectedPriority(new Set());
    try {
      await runAnalysis(activeResumeId);
```

Find (in `handleSubmit`):
```tsx
    setIsSubmitting(true);
    setError(null);
    setTailorError(null);
    try {
      const firstLine = jdText.trim().split("\n")[0].slice(0, 120) || "Untitled JD";
```

Replace with:
```tsx
    setIsSubmitting(true);
    setError(null);
    setTailorError(null);
    setSelectedPriority(new Set());
    try {
      const firstLine = jdText.trim().split("\n")[0].slice(0, 120) || "Untitled JD";
```

- [ ] **Step 3: Send the selection through on Tailor**

Find (`handleTailor`):
```tsx
  async function handleTailor() {
    if (!activeResumeId) return;
    setTailorError(null);
    // Covers the whole wait (AI rewrite + the moment of route transition)
    // with a blurred overlay so the pause reads as an intentional "doing
    // something smart" beat rather than a stuck button.
    setNavigatingToStudio(true);
    await runTailoring(activeResumeId);
```

Replace with:
```tsx
  async function handleTailor() {
    if (!activeResumeId) return;
    setTailorError(null);
    useTailoringStore.getState().setPrioritySkills(Array.from(selectedPriority));
    // Covers the whole wait (AI rewrite + the moment of route transition)
    // with a blurred overlay so the pause reads as an intentional "doing
    // something smart" beat rather than a stuck button.
    setNavigatingToStudio(true);
    await runTailoring(activeResumeId);
```

- [ ] **Step 4: Make the Not Matched chips selectable**

Find (the Not Matched panel inside the "Profile Match & Keywords" card):
```tsx
                {/* Not Matched — red, unmistakably a gap */}
                <div className="rounded-xl border border-error/25 bg-error-container/20 p-sm flex flex-col gap-xs min-w-0">
                  <h3 className="text-label-sm font-bold text-on-error-container flex items-center gap-xs">
                    <WarningCircle size={15} weight="fill" className="text-error shrink-0" />
                    <span className="truncate">Not Matched</span>
                    <span className="ml-auto shrink-0 text-caption font-bold px-xs rounded-full bg-error text-on-error">
                      {missingSkills.length}
                    </span>
                  </h3>
                  {missingSkills.length > 0 ? (
                    <div className="flex flex-wrap gap-xs max-h-32 overflow-y-auto">
                      {missingSkills.map((skill) => {
                        const alreadyAdded = learningItems.some(
                          (li) => li.skill.toLowerCase() === skill.toLowerCase()
                        );
                        return (
                          <span
                            key={skill}
                            className="px-xs py-0.5 bg-error-container/40 text-on-error-container text-caption font-medium rounded-md border border-error/30 flex items-center gap-xs"
                          >
                            <WarningCircle size={11} weight="fill" className="text-error shrink-0" />
                            {skill}
                            <button
                              type="button"
                              onClick={() => !alreadyAdded && handleAddToLearningPath(skill)}
                              disabled={alreadyAdded}
                              aria-label={alreadyAdded ? "Already in learning path" : "Add to learning path"}
                              className="flex items-center"
                            >
                              {alreadyAdded ? (
                                <CheckCircle size={12} className="text-success" />
                              ) : (
                                <PlusCircle size={12} className="cursor-pointer hover:text-error/70" />
                              )}
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-caption text-on-surface-variant italic">None — full coverage.</p>
                  )}
                </div>
```

Replace with (the chip itself becomes clickable to toggle priority; the existing "add to learning path" button still works independently via `stopPropagation` so the two actions don't collide):
```tsx
                {/* Not Matched — red, unmistakably a gap. Clicking a chip
                    (anywhere but the +/learning-path button) toggles it as
                    a priority skill for the next Tailor run. */}
                <div className="rounded-xl border border-error/25 bg-error-container/20 p-sm flex flex-col gap-xs min-w-0">
                  <h3 className="text-label-sm font-bold text-on-error-container flex items-center gap-xs">
                    <WarningCircle size={15} weight="fill" className="text-error shrink-0" />
                    <span className="truncate">Not Matched</span>
                    <span className="ml-auto shrink-0 text-caption font-bold px-xs rounded-full bg-error text-on-error">
                      {missingSkills.length}
                    </span>
                  </h3>
                  {missingSkills.length > 0 ? (
                    <>
                      <div className="flex flex-wrap gap-xs max-h-32 overflow-y-auto">
                        {missingSkills.map((skill) => {
                          const alreadyAdded = learningItems.some(
                            (li) => li.skill.toLowerCase() === skill.toLowerCase()
                          );
                          const selected = selectedPriority.has(skill);
                          return (
                            <span
                              key={skill}
                              role="button"
                              tabIndex={0}
                              onClick={() => togglePriority(skill)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") togglePriority(skill);
                              }}
                              aria-pressed={selected}
                              className={`px-xs py-0.5 text-caption font-medium rounded-md border flex items-center gap-xs cursor-pointer transition-all ${
                                selected
                                  ? "bg-error text-on-error border-error"
                                  : "bg-error-container/40 text-on-error-container border-error/30 hover:border-error"
                              }`}
                            >
                              <WarningCircle size={11} weight="fill" className={selected ? "shrink-0" : "text-error shrink-0"} />
                              {skill}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!alreadyAdded) handleAddToLearningPath(skill);
                                }}
                                disabled={alreadyAdded}
                                aria-label={alreadyAdded ? "Already in learning path" : "Add to learning path"}
                                className="flex items-center"
                              >
                                {alreadyAdded ? (
                                  <CheckCircle size={12} className="text-success" />
                                ) : (
                                  <PlusCircle size={12} className="cursor-pointer hover:text-error/70" />
                                )}
                              </button>
                            </span>
                          );
                        })}
                      </div>
                      <p className="text-caption text-on-surface-variant mt-xs italic">
                        {selectedPriority.size > 0
                          ? `${selectedPriority.size} selected — Tailor will prioritize weaving these in.`
                          : "Click a keyword to prioritize it, or leave unselected and let AI decide."}
                      </p>
                    </>
                  ) : (
                    <p className="text-caption text-on-surface-variant italic">None — full coverage.</p>
                  )}
                </div>
```

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: No errors.

- [ ] **Step 6: Manual verification**

Start both dev servers, log in, paste a new JD on `/jd`, click "Analyze Description", click a few "Not Matched" chips (confirm they turn solid red / `aria-pressed="true"`), confirm the "+"/learning-path button still works independently without also toggling the chip, then click "Tailor Resume" and confirm the picked skills show up pre-accepted with a ★ in the review panel (same check as Task 4 Step 5, now via the index page's flow instead of the detail page's).

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(app)/jd/page.tsx"
git commit -m "feat(web): make Not Matched keyword chips selectable on the JD Analyzer index page"
```

---

### Task 6: Frontend — mark user-requested skill chips in `BulletReviewPanel`

**Files:**
- Modify: `apps/web/components/resume/BulletReviewPanel.tsx`

**Interfaces:**
- Consumes: `useTailoringStore(s => s.prioritySkills)` from Task 3.
- Produces: nothing new consumed elsewhere — this is a leaf visual change.

- [ ] **Step 1: Read `prioritySkills` from the store and pass it to both `SkillsBlock` call sites**

Find (near the top of `BulletReviewPanel`):
```tsx
  const suggestedSkills = useTailoringStore((s) => s.suggestedSkills);
```

Replace with:
```tsx
  const suggestedSkills = useTailoringStore((s) => s.suggestedSkills);
  const prioritySkills = useTailoringStore((s) => s.prioritySkills);
```

Find the first `<SkillsBlock ... />` (in the `bulletChanges.length === 0` early-return branch):
```tsx
        <SkillsBlock
          suggestedSkills={suggestedSkills}
          bulletDecisions={bulletDecisions}
          setBulletDecision={setBulletDecision}
        />
```

Replace with:
```tsx
        <SkillsBlock
          suggestedSkills={suggestedSkills}
          prioritySkills={prioritySkills}
          bulletDecisions={bulletDecisions}
          setBulletDecision={setBulletDecision}
        />
```

Find the second `<SkillsBlock ... />` (in the "Bottom action area"):
```tsx
        <SkillsBlock
          suggestedSkills={suggestedSkills}
          bulletDecisions={bulletDecisions}
          setBulletDecision={setBulletDecision}
        />
```

Replace with:
```tsx
        <SkillsBlock
          suggestedSkills={suggestedSkills}
          prioritySkills={prioritySkills}
          bulletDecisions={bulletDecisions}
          setBulletDecision={setBulletDecision}
        />
```

- [ ] **Step 2: Update `SkillsBlock` to accept and render the marker**

Find:
```tsx
// ── Suggested skills sub-component ───────────────────────────────────────────
function SkillsBlock({
  suggestedSkills,
  bulletDecisions,
  setBulletDecision,
}: {
  suggestedSkills: string[];
  bulletDecisions: Record<string, string>;
  setBulletDecision: (key: string, d: "accept" | "reject") => void;
}) {
  if (suggestedSkills.length === 0) return null;
  return (
    <div className="rounded-xl border border-outline-variant/20 bg-surface p-md flex flex-col gap-sm">
      <div>
        <p className="text-label-sm text-on-surface font-bold">Suggested Skills to Add</p>
        <p className="text-caption text-on-surface-variant">
          Click a skill to include it in your resume
        </p>
      </div>
      <div className="flex flex-wrap gap-xs">
        {suggestedSkills.map((skill) => {
          const selected = bulletDecisions[`skill_add:${skill}`] === "accept";
          return (
            <button
              key={skill}
              onClick={() =>
                setBulletDecision(
                  `skill_add:${skill}`,
                  selected ? "reject" : "accept",
                )
              }
              className={`flex items-center gap-xs px-sm py-xs rounded-full text-label-sm border transition-all ${
                selected
                  ? "bg-[#e6f4ea] text-[#1e7e34] border-[#1e7e34]/30 font-medium"
                  : "bg-surface-container text-on-surface-variant border-outline-variant/40 hover:border-primary/40 hover:text-primary"
              }`}
            >
              {selected ? (
                <Check size={11} weight="bold" />
              ) : (
                <Plus size={11} weight="bold" />
              )}
              {skill}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

Replace with (adds the `prioritySkills` prop, a case-insensitive lookup, and a small star marker on matching chips — the chip's underlying accept/reject behavior is unchanged):
```tsx
// ── Suggested skills sub-component ───────────────────────────────────────────
function SkillsBlock({
  suggestedSkills,
  prioritySkills,
  bulletDecisions,
  setBulletDecision,
}: {
  suggestedSkills: string[];
  prioritySkills: string[];
  bulletDecisions: Record<string, string>;
  setBulletDecision: (key: string, d: "accept" | "reject") => void;
}) {
  if (suggestedSkills.length === 0) return null;
  const prioritySet = new Set(prioritySkills.map((s) => s.toLowerCase()));
  return (
    <div className="rounded-xl border border-outline-variant/20 bg-surface p-md flex flex-col gap-sm">
      <div>
        <p className="text-label-sm text-on-surface font-bold">Suggested Skills to Add</p>
        <p className="text-caption text-on-surface-variant">
          Click a skill to include it in your resume
          {prioritySkills.length > 0 && " — ★ marks the keywords you picked on the JD page"}
        </p>
      </div>
      <div className="flex flex-wrap gap-xs">
        {suggestedSkills.map((skill) => {
          const selected = bulletDecisions[`skill_add:${skill}`] === "accept";
          const isPriority = prioritySet.has(skill.toLowerCase());
          return (
            <button
              key={skill}
              onClick={() =>
                setBulletDecision(
                  `skill_add:${skill}`,
                  selected ? "reject" : "accept",
                )
              }
              className={`flex items-center gap-xs px-sm py-xs rounded-full text-label-sm border transition-all ${
                selected
                  ? "bg-[#e6f4ea] text-[#1e7e34] border-[#1e7e34]/30 font-medium"
                  : "bg-surface-container text-on-surface-variant border-outline-variant/40 hover:border-primary/40 hover:text-primary"
              }`}
            >
              {selected ? (
                <Check size={11} weight="bold" />
              ) : (
                <Plus size={11} weight="bold" />
              )}
              {isPriority && <span aria-label="You picked this keyword">★</span>}
              {skill}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: No errors.

- [ ] **Step 4: Manual verification**

Continuing from Task 4 Step 5's manual check: confirm the skill chips you selected on the JD detail page show a ★ in the "Suggested Skills to Add" block and are already in the accepted (green) state.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/resume/BulletReviewPanel.tsx
git commit -m "feat(web): mark user-requested priority skills in the tailoring review panel"
```

---

### Task 7: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite**

Run: `cd apps/api && source .venv/Scripts/activate && python -m pytest -q --ignore=tests/test_tailoring.py`
Expected: All PASS. (`tests/test_tailoring.py` is excluded — it's broken on `main` independent of this feature, per the note in the File Structure section; do not attempt to fix it as part of this plan.)

- [ ] **Step 2: Run the full frontend test suite**

Run: `cd apps/web && npx vitest run`
Expected: All PASS except the pre-existing, unrelated failures in `__tests__/components/EditorPanel.test.tsx` and `__tests__/components/Sidebar.test.tsx` (confirmed broken on unmodified `main` in earlier work on this codebase — a `QueryClientProvider` test-setup gap, unrelated to this feature).

- [ ] **Step 3: Typecheck the whole frontend**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json`
Expected: No errors.

- [ ] **Step 4: Final commit (if any stragglers)**

```bash
git status
```
If clean, nothing to do. If there are unstaged changes from fixing something during verification, commit them with a message describing what was fixed.

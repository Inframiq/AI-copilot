# Interview Center Hybrid Skill-Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make prep-question generation cost-scale with the number of unique missing skills seen across all users (not with tailoring runs), and make the Interview Center's "no active session" view show real, previously-generated questions instead of a fake localStorage progress bar with no underlying content.

**Architecture:** A new shared, cross-user Postgres table (`skill_question_bank`) caches interview questions keyed by normalized skill name. When a tailoring run needs prep questions, it looks up cached questions for the resume's missing skills first, and only calls the LLM for skills that have never been seen before — a cache-aside pattern, same shape as the existing `jd.parsed["agent1"]` cache this codebase already uses for JD skill extraction. A new read-only browse endpoint exposes the accumulated bank by topic, which the Interview Center's "no session" view now renders instead of the current fake per-topic-card progress bump.

**Tech Stack:** FastAPI, SQLAlchemy (async), Alembic, Pydantic, Next.js/React, Zustand, TanStack Query, Vitest, pytest.

## Global Constraints

- Every new/changed backend endpoint requires auth via the existing `get_current_user` dependency — the bank is shared across users (not per-user data), but still only reachable by logged-in users, same as every other `/ai/*` route.
- No change to `PrepQuestion`/`TailoringSession` shape or the existing `GET /sessions/{id}/questions` / `PATCH /questions/{id}/practice` endpoints — session-level practice tracking is untouched; only *where the question text comes from* changes.
- All new Python code follows this repo's existing service/router split: DB access happens where `db: AsyncSession` is already available (routers), threaded into `tailoring.py` service functions as a parameter — mirrors how `provider: AIProvider` is already passed in.
- Frontend: use the existing `apiClient` / `@tanstack/react-query` patterns already used throughout `apps/web` — no new HTTP client, no new state library.
- Run `npx tsc --noEmit` (web) and `pytest` (api) before every commit in this plan; both must be clean.

---

## File Structure

- **Create** `apps/api/alembic/versions/006_skill_question_bank.py` — migration for the new table.
- **Modify** `apps/api/app/db/models.py` — add `SkillQuestionBank` model.
- **Modify** `apps/api/app/services/tailoring.py` — add `SkillQuestionData`/`SkillQuestionsWrapper`, `_generate_questions_for_skills`, `get_or_generate_prep_questions`; thread `db` through `run_tailoring_pipeline`.
- **Modify** `apps/api/app/routers/ai.py` — pass `db` into `run_tailoring_pipeline`; add `GET /ai/questions/browse`.
- **Modify** `apps/api/app/schemas/ai.py` — add `SkillQuestionOut`.
- **Create** `apps/api/tests/test_skill_question_bank.py` — cache-aside behavior tests.
- **Modify** `apps/web/lib/api-client.ts` — add `getQuestionBank`.
- **Modify** `apps/web/packages/types` (`@career-copilot/types`) — add `SkillQuestionOut` type. *(Check the actual package path in Task 5 — this repo may keep shared types elsewhere; confirm before editing.)*
- **Modify** `apps/web/app/(app)/interview/page.tsx` — replace the fake localStorage topic-card branch with real bank-backed browsing.
- **Modify** `apps/web/__tests__/components/*` or a new `apps/web/__tests__/interview-page.test.tsx` — cover the new browse behavior.

---

### Task 1: `SkillQuestionBank` model + migration

**Files:**
- Modify: `apps/api/app/db/models.py`
- Create: `apps/api/alembic/versions/006_skill_question_bank.py`

**Interfaces:**
- Produces: `SkillQuestionBank` SQLAlchemy model with columns `id: uuid.UUID`, `skill: str` (normalized lowercase, indexed), `topic: str`, `question: str`, `answer_framework: str`, `created_at: datetime`. No `user_id`, no FK to any session — this table is a shared cache across all users.

- [ ] **Step 1: Add the model**

Add to `apps/api/app/db/models.py`, after the existing `PrepQuestion` class (around line 88):

```python
class SkillQuestionBank(Base):
    """Shared, cross-user cache of interview questions keyed by skill.

    Not tied to any resume, JD, or session — the same "Kubernetes" question
    can be reused for every user whose missing-skill list includes it,
    instead of every tailoring run re-generating it from scratch. See
    get_or_generate_prep_questions in services/tailoring.py.
    """
    __tablename__ = "skill_question_bank"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Normalized (stripped, lowercased) — the display-cased form the LLM
    # returned isn't stored here since it's never shown standalone; only via
    # topic groupings.
    skill: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    topic: Mapped[str] = mapped_column(String(20), nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer_framework: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)
```

- [ ] **Step 2: Write the migration**

Create `apps/api/alembic/versions/006_skill_question_bank.py`:

```python
"""add skill_question_bank table

Revision ID: 006
Revises: 005
Create Date: 2026-08-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "skill_question_bank",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("skill", sa.String(200), nullable=False),
        sa.Column("topic", sa.String(20), nullable=False),
        sa.Column("question", sa.Text, nullable=False),
        sa.Column("answer_framework", sa.Text, nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False),
    )
    op.create_index("ix_skill_question_bank_skill", "skill_question_bank", ["skill"])


def downgrade() -> None:
    op.drop_index("ix_skill_question_bank_skill", table_name="skill_question_bank")
    op.drop_table("skill_question_bank")
```

- [ ] **Step 3: Verify the app still imports cleanly**

Run: `cd apps/api && python -c "import app.main; print('IMPORT OK')"`
Expected: `IMPORT OK`

- [ ] **Step 4: Verify the migration chain resolves**

Run: `cd apps/api && alembic upgrade head --sql | tail -30`
Expected: SQL output ending in the `CREATE TABLE skill_question_bank` / `CREATE INDEX` statements from Step 2, no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/db/models.py apps/api/alembic/versions/006_skill_question_bank.py
git commit -m "feat(api): add skill_question_bank table for cross-user prep-question caching"
```

---

### Task 2: Cache-aside question generation in `tailoring.py`

**Files:**
- Modify: `apps/api/app/services/tailoring.py`
- Test: `apps/api/tests/test_skill_question_bank.py`

**Interfaces:**
- Consumes: `SkillQuestionBank` model (Task 1), `AIProvider.complete_structured` (existing), `_sanitize_skill_list` (existing helper in this file).
- Produces: `async def get_or_generate_prep_questions(missing_skills: list[str], resume_content: dict, provider: AIProvider, db: AsyncSession) -> list[PrepQuestionData]` — same return type as the `generate_prep_questions` function it replaces, so callers don't need to change shape, only the call site (Task 3).

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/test_skill_question_bank.py`:

```python
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from app.services.tailoring import (
    get_or_generate_prep_questions,
    SkillQuestionData,
    SkillQuestionsWrapper,
)
from app.db.models import SkillQuestionBank


def make_mock_db_with_rows(rows):
    session = MagicMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = rows
    session.execute = AsyncMock(return_value=result)
    session.add = MagicMock()
    session.commit = AsyncMock()
    return session


@pytest.mark.asyncio
async def test_uses_cached_rows_without_calling_the_llm():
    cached = SkillQuestionBank(
        id=uuid.uuid4(),
        skill="kubernetes",
        topic="Technical",
        question="Describe how you've used Kubernetes in production.",
        answer_framework="STAR: ...",
    )
    db = make_mock_db_with_rows([cached])
    provider = MagicMock()
    provider.complete_structured = AsyncMock()

    result = await get_or_generate_prep_questions(
        ["Kubernetes"], {"skills": []}, provider, db
    )

    provider.complete_structured.assert_not_called()
    assert len(result) == 1
    assert result[0].question == cached.question
    assert result[0].topic == "Technical"
    assert result[0].order_index == 1


@pytest.mark.asyncio
async def test_generates_and_stores_only_for_uncovered_skills():
    cached = SkillQuestionBank(
        id=uuid.uuid4(),
        skill="kubernetes",
        topic="Technical",
        question="Describe how you've used Kubernetes in production.",
        answer_framework="STAR: ...",
    )
    db = make_mock_db_with_rows([cached])
    provider = MagicMock()
    provider.complete_structured = AsyncMock(
        return_value=SkillQuestionsWrapper(
            questions=[
                SkillQuestionData(
                    skill="GraphQL",
                    topic="Technical",
                    question="How would you design a GraphQL schema for this API?",
                    answer_framework="STAR: ...",
                )
            ]
        )
    )

    result = await get_or_generate_prep_questions(
        ["Kubernetes", "GraphQL"], {"skills": []}, provider, db
    )

    # Only the uncovered skill (GraphQL) was sent to the LLM — Kubernetes was cached.
    provider.complete_structured.assert_called_once()
    called_system_prompt = provider.complete_structured.call_args.args[0]
    assert "GraphQL" in called_system_prompt
    assert "Kubernetes" not in called_system_prompt

    # The new question was persisted to the bank.
    db.add.assert_called_once()
    added_row = db.add.call_args.args[0]
    assert added_row.skill == "graphql"
    db.commit.assert_awaited_once()

    assert len(result) == 2


@pytest.mark.asyncio
async def test_drops_llm_questions_for_skills_that_were_not_asked():
    db = make_mock_db_with_rows([])
    provider = MagicMock()
    provider.complete_structured = AsyncMock(
        return_value=SkillQuestionsWrapper(
            questions=[
                SkillQuestionData(
                    skill="Some Hallucinated Skill",
                    topic="Technical",
                    question="...",
                    answer_framework="...",
                )
            ]
        )
    )

    result = await get_or_generate_prep_questions(
        ["Rust"], {"skills": []}, provider, db
    )

    db.add.assert_not_called()
    assert result == []


@pytest.mark.asyncio
async def test_empty_missing_skills_returns_empty_without_db_or_llm_calls():
    db = make_mock_db_with_rows([])
    provider = MagicMock()
    provider.complete_structured = AsyncMock()

    result = await get_or_generate_prep_questions([], {"skills": []}, provider, db)

    assert result == []
    db.execute.assert_not_called()
    provider.complete_structured.assert_not_called()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_skill_question_bank.py -v`
Expected: FAIL with `ImportError: cannot import name 'get_or_generate_prep_questions'`

- [ ] **Step 3: Write the implementation**

In `apps/api/app/services/tailoring.py`:

Add imports near the top (after the existing imports):

```python
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.models import SkillQuestionBank
```

Add near `PrepQuestionData`/`PrepQuestionsWrapper` (around line 84):

```python
_TOPIC_VALUES = {"Technical", "Behavioral", "HR & Culture"}


class SkillQuestionData(BaseModel):
    skill: str
    topic: str
    question: str
    answer_framework: str


class SkillQuestionsWrapper(BaseModel):
    questions: list[SkillQuestionData]
```

Replace the existing `generate_prep_questions` function (lines 485-501) with:

```python
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


async def get_or_generate_prep_questions(
    missing_skills: list[str],
    resume_content: dict,
    provider: AIProvider,
    db: AsyncSession,
) -> list[PrepQuestionData]:
    """Cache-aside prep-question lookup: reuses bank rows for skills already
    seen (from any prior user's tailoring run), and only calls the LLM for
    skills genuinely new to the bank — same pattern as the jd.parsed["agent1"]
    cache in routers/ai.py, applied to prep questions instead of JD parsing.
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
        await db.execute(select(SkillQuestionBank).where(SkillQuestionBank.skill.in_(keys)))
    ).scalars().all()
    covered_keys = {row.skill for row in cached_rows}
    uncovered_display = [display for key, display in normalized if key not in covered_keys]

    new_rows: list[SkillQuestionBank] = []
    if uncovered_display:
        generated = await _generate_questions_for_skills(uncovered_display, resume_content, provider)
        display_to_key = {display.lower(): key for key, display in normalized}
        for q in generated:
            key = display_to_key.get(q.skill.strip().lower())
            if key is None:
                continue  # LLM echoed a skill we never asked about — drop it, don't cache garbage
            topic = q.topic if q.topic in _TOPIC_VALUES else "Technical"
            row = SkillQuestionBank(
                skill=key, topic=topic, question=q.question, answer_framework=q.answer_framework
            )
            db.add(row)
            new_rows.append(row)
        if new_rows:
            await db.commit()

    all_rows = list(cached_rows) + new_rows
    selected = all_rows[:10]
    return [
        PrepQuestionData(
            topic=row.topic,
            question=row.question,
            answer_framework=row.answer_framework,
            is_gap_based=True,
            order_index=i + 1,
        )
        for i, row in enumerate(selected)
    ]
```

- [ ] **Step 4: Fix `test_tailoring.py`'s stale reference to the removed function**

`generate_prep_questions` and `PrepQuestionsWrapper` no longer exist — `apps/api/tests/test_tailoring.py` imports both (lines 3-11) and has a test that calls the old function directly (`test_generate_prep_questions_returns_list`, lines 57-63). This test file also has `run_tailoring_pipeline` tests that construct `PrepQuestionsWrapper` — those are handled in Task 3 (they need a `db` param too, which doesn't exist yet at this point in the plan). For now, just fix the import and the one test that calls the removed function directly.

Replace the import block (lines 3-11):

```python
from app.services.tailoring import (
    extract_jd_skills, ParsedJD,
    get_or_generate_prep_questions, PrepQuestionData, SkillQuestionData, SkillQuestionsWrapper,
    run_tailoring_pipeline, TailoringResult,
    analyze_jd_match, JDMatchAnalysis,
    JDAnalysis, MappingPlan, BulletMapping,
    WriterOutput, RewrittenBullet,
    _build_agent3_system,
)
```

(Line 2, `from unittest.mock import AsyncMock, MagicMock`, already exists above this block and needs no change — `MagicMock`/`AsyncMock` are reused below.)

Replace `test_generate_prep_questions_returns_list` (lines 57-63) with:

```python
def make_mock_db_with_rows(rows):
    session = MagicMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = rows
    session.execute = AsyncMock(return_value=result)
    session.add = MagicMock()
    session.commit = AsyncMock()
    return session


@pytest.mark.asyncio
async def test_get_or_generate_prep_questions_returns_list():
    provider = make_mock_provider(
        structured_return=SkillQuestionsWrapper(
            questions=[
                SkillQuestionData(
                    skill="AWS", topic="Technical",
                    question="How would you approach AWS?", answer_framework="Use STAR",
                )
            ]
        )
    )
    db = make_mock_db_with_rows([])

    result = await get_or_generate_prep_questions(["AWS"], {"experience": []}, provider, db)

    assert len(result) == 1
    assert result[0].topic == "Technical"
```

Leave `test_run_tailoring_pipeline_returns_result` and `test_run_tailoring_pipeline_dedupes_overlapping_skills` (further down this file) untouched for now — Task 3, Step 3 fixes both.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_skill_question_bank.py tests/test_tailoring.py -v`
Expected: the new tests in `test_skill_question_bank.py` pass; `test_tailoring.py` still has 2 failing tests (`test_run_tailoring_pipeline_returns_result`, `test_run_tailoring_pipeline_dedupes_overlapping_skills`) — expected at this point, Task 3 fixes them. Confirm the failure is specifically a missing `db` argument / `PrepQuestionsWrapper` NameError, not something else.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/services/tailoring.py apps/api/tests/test_skill_question_bank.py apps/api/tests/test_tailoring.py
git commit -m "feat(api): cache-aside prep question generation keyed by skill"
```

---

### Task 3: Wire the cache into `run_tailoring_pipeline` and `/ai/tailor`

**Files:**
- Modify: `apps/api/app/services/tailoring.py`
- Modify: `apps/api/app/routers/ai.py`
- Test: `apps/api/tests/test_jd_and_tailor_endpoints.py`

**Interfaces:**
- Consumes: `get_or_generate_prep_questions` (Task 2).
- Produces: `run_tailoring_pipeline(..., db: AsyncSession)` — new required parameter, appended last so existing positional call sites (there is only one, in `ai.py`) need one keyword argument added.

- [ ] **Step 1: Update `run_tailoring_pipeline`'s signature and call site**

In `apps/api/app/services/tailoring.py`, find `async def run_tailoring_pipeline(` (around line 598) and add `db: AsyncSession` as the last parameter:

```python
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
```

Find the `asyncio.gather` call (around line 641-644):

```python
    tailored_raw, questions = await asyncio.gather(
        _agent3_write(mapping_plan, original_skills, humanize_level, provider),
        generate_prep_questions(analysis.missing_skills, resume_content, provider),
    )
```

Replace with:

```python
    tailored_raw, questions = await asyncio.gather(
        _agent3_write(mapping_plan, original_skills, humanize_level, provider),
        get_or_generate_prep_questions(analysis.missing_skills, resume_content, provider, db),
    )
```

- [ ] **Step 2: Update the one call site in `ai.py`**

In `apps/api/app/routers/ai.py`, find the `result = await run_tailoring_pipeline(` call inside `tailor_resume` (around line 110-118) and add `db=db`:

```python
    result = await run_tailoring_pipeline(
        resume_row.content,
        jd_row.raw_text,
        body.humanize_level,
        provider,
        db=db,
        company_name=body.company_name,
        priority_skills=body.priority_skills,
        cached_jd_analysis=cached_for_tailor,
    )
```

- [ ] **Step 3: `test_jd_and_tailor_endpoints.py` needs no changes — confirm it**

`test_tailor_resume_returns_200_and_creates_session` and `test_tailor_resume_forwards_priority_skills_to_pipeline` both patch `app.routers.ai.run_tailoring_pipeline` wholesale with `AsyncMock(return_value=fake_result)` — the mock doesn't care about the new `db` kwarg, so nothing to change here.

Run: `cd apps/api && pytest tests/test_jd_and_tailor_endpoints.py -v`
Expected: all passing, unchanged from before this task

- [ ] **Step 4: Fix `test_tailoring.py`'s direct (unmocked) pipeline tests**

Unlike the router tests, `test_run_tailoring_pipeline_returns_result` and `test_run_tailoring_pipeline_dedupes_overlapping_skills` call the *real* `run_tailoring_pipeline` — they need a mock `db`, and their `PrepQuestionsWrapper` dispatch entries must become `SkillQuestionsWrapper` (that class no longer exists after Task 2).

Replace `test_run_tailoring_pipeline_returns_result` in its entirety:

```python
@pytest.mark.asyncio
async def test_run_tailoring_pipeline_returns_result():
    responses = {
        JDAnalysis: make_jd_analysis(exact_technical_tools=["Python"]),
        MappingPlan: MappingPlan(
            mapping_plan=[
                BulletMapping(
                    original_bullet_id="exp0_b0",
                    original_text="Used Python",
                    target_jd_keywords_to_inject=["Python"],
                    preserved_metrics=[],
                    strategic_instruction="REINFORCE",
                )
            ],
            plausible_skills_to_add=[],
        ),
        WriterOutput: WriterOutput(
            rewritten_bullets=[RewrittenBullet(bullet_id="exp0_b0", rewritten_text="Leveraged Python extensively")],
            updated_skills=["Python"],
        ),
        SkillQuestionsWrapper: SkillQuestionsWrapper(
            questions=[SkillQuestionData(skill="AWS", topic="Technical", question="Q?", answer_framework="A")]
        ),
    }
    provider = make_provider_dispatching_by_schema(responses)
    resume = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}
    db = make_mock_db_with_rows([])

    result = await run_tailoring_pipeline(resume, "Need Python and AWS exp.", 50, provider, db)

    assert isinstance(result, TailoringResult)
    assert result.ats_score >= 0
    assert result.tailored_content["experience"][0]["bullets"] == ["Leveraged Python extensively"]
```

Replace `test_run_tailoring_pipeline_dedupes_overlapping_skills` in its entirety:

```python
@pytest.mark.asyncio
async def test_run_tailoring_pipeline_dedupes_overlapping_skills():
    # Same dedup guarantee as the analyze-only test above, but exercised
    # through the full tailoring pipeline.
    responses = {
        JDAnalysis: make_jd_analysis(
            exact_technical_tools=["Python", "AWS"],
            ats_filter_phrases=["python"],
        ),
        MappingPlan: MappingPlan(mapping_plan=[], plausible_skills_to_add=[]),
        WriterOutput: WriterOutput(rewritten_bullets=[], updated_skills=[]),
        SkillQuestionsWrapper: SkillQuestionsWrapper(questions=[]),
    }
    provider = make_provider_dispatching_by_schema(responses)
    resume = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}]}
    db = make_mock_db_with_rows([])

    result = await run_tailoring_pipeline(resume, "Need Python and AWS.", 50, provider, db)

    assert result.matched_skills.count("Python") == 1
    assert result.ats_score == 50  # 1 of 2 unique skills matched, not 1 of 3
```

Run: `cd apps/api && pytest tests/test_tailoring.py -v`
Expected: all passing

- [ ] **Step 5: Fix `test_tailoring_priority_skills.py`'s direct (unmocked) pipeline tests**

Same two problems (needs `db`, `PrepQuestionsWrapper` → `SkillQuestionsWrapper`) across all three tests in this file.

Replace the top-level import block (lines 3-11):

```python
from app.services.tailoring import (
    run_tailoring_pipeline,
    JDAnalysis,
    MappingPlan,
    BulletMapping,
    WriterOutput,
    RewrittenBullet,
    SkillQuestionData,
    SkillQuestionsWrapper,
)
```

Add this helper right after the existing `make_provider_dispatching_by_schema` (around line 25):

```python
def make_mock_db_with_rows(rows):
    session = MagicMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = rows
    session.execute = AsyncMock(return_value=result)
    session.add = MagicMock()
    session.commit = AsyncMock()
    return session
```

In `test_priority_skills_reach_agent2_payload`: change the `if schema is PrepQuestionsWrapper: return PrepQuestionsWrapper(questions=[])` line to `if schema is SkillQuestionsWrapper: return SkillQuestionsWrapper(questions=[])`, and change the call:

```python
    resume = {"experience": [{"title": "Eng", "bullets": ["Did Python stuff"]}], "skills": ["Python"]}
    db = make_mock_db_with_rows([])
    await run_tailoring_pipeline(
        resume, "Need Python and Kubernetes.", 50, provider, db,
        priority_skills=["Kubernetes"],
    )
```

In `test_suggested_skills_always_includes_priority_skills_even_if_agent2_omits_them`: replace the `PrepQuestionsWrapper: PrepQuestionsWrapper(questions=[])` dict entry with `SkillQuestionsWrapper: SkillQuestionsWrapper(questions=[])`, and change the call:

```python
    resume = {"experience": [{"title": "Eng", "bullets": ["Did Python stuff"]}], "skills": ["Python"]}
    db = make_mock_db_with_rows([])
    result = await run_tailoring_pipeline(
        resume, "Need Python, Docker, and Kubernetes.", 50, provider, db,
        priority_skills=["Kubernetes", "docker"],
    )
```

In `test_no_priority_skills_falls_back_to_agent2_own_suggestions`: same dict-key swap, and:

```python
    resume = {"experience": [{"title": "Eng", "bullets": ["Did Python stuff"]}], "skills": ["Python"]}
    db = make_mock_db_with_rows([])
    result = await run_tailoring_pipeline(
        resume, "Need Python and Docker.", 50, provider, db,
        priority_skills=None,
    )
```

Run: `cd apps/api && pytest tests/test_tailoring_priority_skills.py -v`
Expected: all passing

- [ ] **Step 6: Verify the app imports cleanly and the full backend suite passes**

Run: `cd apps/api && python -c "import app.main; print('IMPORT OK')" && pytest -q --ignore=tests/test_resume_parser_security.py`
Expected: `IMPORT OK`, all tests passing — compare the failure count against Task 1's baseline run; it should be identical (only pre-existing, unrelated failures, if any)

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/services/tailoring.py apps/api/app/routers/ai.py apps/api/tests/test_jd_and_tailor_endpoints.py apps/api/tests/test_tailoring.py apps/api/tests/test_tailoring_priority_skills.py
git commit -m "feat(api): wire cache-aside prep questions into the tailoring pipeline"
```

---

### Task 4: `GET /ai/questions/browse` endpoint

**Files:**
- Modify: `apps/api/app/schemas/ai.py`
- Modify: `apps/api/app/routers/ai.py`
- Test: `apps/api/tests/test_skill_question_bank.py`

**Interfaces:**
- Produces: `SkillQuestionOut` schema (`id: UUID`, `skill: str`, `topic: str`, `question: str`, `answer_framework: str`); `GET /ai/questions/browse?topic=<Technical|Behavioral|HR & Culture>` → `list[SkillQuestionOut]`, auth-required, no ownership filtering (shared bank).

- [ ] **Step 1: Add the schema**

In `apps/api/app/schemas/ai.py`, add:

```python
class SkillQuestionOut(BaseModel):
    id: uuid.UUID
    skill: str
    topic: str
    question: str
    answer_framework: str
    model_config = {"from_attributes": True}
```

- [ ] **Step 2: Write the failing test**

Add to `apps/api/tests/test_skill_question_bank.py`:

```python
import time
import jwt as pyjwt
from datetime import datetime, timezone
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.core.config import settings
from app.db.session import get_db

TEST_USER_ID = "00000000-0000-0000-0000-000000000001"


def make_auth_header():
    payload = {
        "sub": TEST_USER_ID,
        "email": "test@test.com",
        "aud": "authenticated",
        "exp": int(time.time()) + 3600,
    }
    token = pyjwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_browse_questions_filters_by_topic():
    row = SkillQuestionBank(
        id=uuid.uuid4(),
        skill="kubernetes",
        topic="Technical",
        question="Describe how you've used Kubernetes in production.",
        answer_framework="STAR: ...",
        created_at=datetime.now(timezone.utc),
    )
    mock_session = MagicMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = [row]
    mock_session.execute = AsyncMock(return_value=result)

    async def override():
        yield mock_session

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(
                "/ai/questions/browse?topic=Technical", headers=make_auth_header()
            )
        assert r.status_code == 200
        body = r.json()
        assert len(body) == 1
        assert body[0]["skill"] == "kubernetes"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_browse_questions_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/ai/questions/browse")
    assert r.status_code == 401
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/api && pytest tests/test_skill_question_bank.py -v -k browse`
Expected: FAIL with 404 (route doesn't exist yet)

- [ ] **Step 4: Add the endpoint**

In `apps/api/app/routers/ai.py`, replace line 8:

```python
from app.db.models import Resume, JobDescription, TailoringSession, PrepQuestion
```

with:

```python
from app.db.models import Resume, JobDescription, TailoringSession, PrepQuestion, SkillQuestionBank
```

And replace line 11:

```python
from app.schemas.ai import TailorRequest, TailorOut, PrepQuestionOut, AnalyzeRequest, AnalyzeOut, RewriteBulletRequest, RewriteBulletOut
```

with:

```python
from app.schemas.ai import TailorRequest, TailorOut, PrepQuestionOut, AnalyzeRequest, AnalyzeOut, RewriteBulletRequest, RewriteBulletOut, SkillQuestionOut
```

Add the route (a sensible spot is right after the `/rewrite-bullet` route, before `/sessions/{session_id}`):

```python
@router.get("/questions/browse", response_model=list[SkillQuestionOut])
async def browse_questions(
    topic: str | None = None,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Read-only browse of the shared skill-question bank — used by the
    Interview Center's "no active session" view so it shows real,
    previously-generated questions instead of nothing. Not personalized;
    same content for every user browsing the same topic."""
    query = select(SkillQuestionBank)
    if topic:
        query = query.where(SkillQuestionBank.topic == topic)
    query = query.order_by(SkillQuestionBank.created_at.desc()).limit(50)
    rows = (await db.execute(query)).scalars().all()
    return rows
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && pytest tests/test_skill_question_bank.py -v`
Expected: 6 passed

- [ ] **Step 6: Run the full backend suite**

Run: `cd apps/api && pytest -q --ignore=tests/test_resume_parser_security.py`
Expected: all passing

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/schemas/ai.py apps/api/app/routers/ai.py apps/api/tests/test_skill_question_bank.py
git commit -m "feat(api): add GET /ai/questions/browse for the shared skill-question bank"
```

---

### Task 5: Frontend API client + type for the browse endpoint

**Files:**
- Modify: `apps/web/lib/api-client.ts`
- Modify: `packages/types/index.ts` (the `@career-copilot/types` workspace package) — add `SkillQuestionOut`, matching the shape of the existing `PrepQuestionOut` interface already in this file (around line 108).
- Test: `apps/web/__tests__/api-client.test.ts`

**Interfaces:**
- Produces: `apiClient.getQuestionBank(topic?: string): Promise<SkillQuestionOut[]>`; `SkillQuestionOut { id: string; skill: string; topic: string; question: string; answer_framework: string }`.

- [ ] **Step 1: Add the type to `packages/types/index.ts`**

Add, right after the existing `PrepQuestionOut` interface (around line 108):

```typescript
export interface SkillQuestionOut {
  id: string;
  skill: string;
  topic: string;
  question: string;
  answer_framework: string;
}
```

- [ ] **Step 2: Write the failing test**

In `apps/web/__tests__/api-client.test.ts`, add:

```typescript
describe("getQuestionBank", () => {
  it("fetches the shared question bank, optionally filtered by topic", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse([
        { id: "q-1", skill: "kubernetes", topic: "Technical", question: "...", answer_framework: "..." },
      ])
    );

    const result = await apiClient.getQuestionBank("Technical");

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/ai/questions/browse?topic=Technical");
    expect(result).toHaveLength(1);
  });

  it("omits the topic query param when not provided", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([]));

    await apiClient.getQuestionBank();

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/ai/questions/browse");
    expect(url).not.toContain("topic=");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/api-client.test.ts`
Expected: FAIL with `apiClient.getQuestionBank is not a function`

- [ ] **Step 4: Add the client method**

In `apps/web/lib/api-client.ts`, add the import and method near `getQuestions`:

```typescript
import type {
  // ...existing imports...
  SkillQuestionOut,
} from "@career-copilot/types";
```

```typescript
  getQuestionBank: (topic?: string): Promise<SkillQuestionOut[]> =>
    request<SkillQuestionOut[]>(
      "GET",
      `/ai/questions/browse${topic ? `?topic=${encodeURIComponent(topic)}` : ""}`
    ),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/api-client.test.ts`
Expected: all passing (13 tests — 11 existing + 2 new)

- [ ] **Step 6: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: clean

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/api-client.ts apps/web/__tests__/api-client.test.ts packages/types/index.ts
git commit -m "feat(web): add getQuestionBank API client method"
```

---

### Task 6: Interview Center — real bank-backed browsing instead of fake progress

**Files:**
- Modify: `apps/web/app/(app)/interview/page.tsx`
- Test: `apps/web/__tests__/interview-page.test.tsx` (new)

**Interfaces:**
- Consumes: `apiClient.getQuestionBank(topic?: string)` (Task 5).
- Produces: no new exports — this is a leaf page component.

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/interview-page.test.tsx`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getQuestions: vi.fn(),
    getResumes: vi.fn().mockResolvedValue([]),
    getJds: vi.fn().mockResolvedValue([]),
    getQuestionBank: vi.fn(),
    markQuestionPracticed: vi.fn(),
  },
}));

import InterviewIndexPage from "../app/(app)/interview/page";
import { useTailoringStore } from "../stores/tailoring-store";
import { apiClient } from "../lib/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

function renderWithQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("InterviewIndexPage — no active session", () => {
  beforeEach(() => {
    useTailoringStore.getState().resetStore();
    vi.clearAllMocks();
  });

  it("shows real bank questions for the active topic instead of fake local progress cards", async () => {
    vi.mocked(apiClient.getQuestionBank).mockResolvedValue([
      {
        id: "q-1",
        skill: "kubernetes",
        topic: "Technical",
        question: "Describe how you've used Kubernetes in production.",
        answer_framework: "STAR: ...",
      },
    ]);

    renderWithQueryClient(<InterviewIndexPage />);

    expect(await screen.findByText(/Describe how you've used Kubernetes/)).toBeInTheDocument();
    expect(apiClient.getQuestionBank).toHaveBeenCalledWith("Technical");
  });

  it("re-fetches the bank when switching tabs", async () => {
    vi.mocked(apiClient.getQuestionBank).mockResolvedValue([]);
    renderWithQueryClient(<InterviewIndexPage />);

    await screen.findByText("Behavioral");
    await userEvent.click(screen.getByText("Behavioral"));

    await waitFor(() =>
      expect(apiClient.getQuestionBank).toHaveBeenCalledWith("Behavioral")
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/interview-page.test.tsx`
Expected: FAIL — the bank question text isn't rendered anywhere yet (current code shows `TOPIC_DATA` cards instead)

- [ ] **Step 3: Replace the fake topic-card branch with real bank-backed browsing**

In `apps/web/app/(app)/interview/page.tsx`:

Remove the `TOPIC_PROGRESS_KEY`/`loadTopicProgress`/`saveTopicProgress` block (lines 47-60) and the `topicProg`/`setTopicProg` state (line 77) and its rehydration effect (lines 80-82) — no longer needed, since progress for standalone browsing is no longer tracked (browsing the shared bank is read-only; personalized practice tracking still only exists for real sessions, unchanged).

Remove `handleStartPractice` (lines 152-158) — no longer used.

Add a new query, right after the existing `jds` query (around line 96):

```typescript
  const { data: bankQuestions = [], isLoading: bankLoading } = useQuery<SkillQuestionOut[]>({
    queryKey: ["questionBank", activeTab],
    queryFn: () => apiClient.getQuestionBank(activeTab),
    enabled: !sessionId,
  });
```

Add the import at the top:

```typescript
import type { PrepQuestionOut, Resume, JobDescription, SkillQuestionOut } from "@career-copilot/types";
```

Replace the entire "No session — topic cards with dynamic localStorage progress" block (lines 280-331) with:

```jsx
        ) : (
          /* No session — real, previously-generated questions from the
             shared skill bank. Read-only (no practiced tracking): that
             only applies to your personalized session questions. */
          <div className="flex flex-col gap-md">
            {bankLoading ? (
              <div className="flex items-center justify-center py-xl">
                <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
              </div>
            ) : bankQuestions.length > 0 ? (
              bankQuestions.map((q) => (
                <div
                  key={q.id}
                  className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 hover:shadow-xl transition-shadow flex flex-col"
                >
                  <div className="flex justify-between items-start mb-md">
                    <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-primary/10 text-primary">
                      <MicrophoneStage size={24} />
                    </div>
                    <span className="bg-surface-container text-caption text-primary px-sm py-xs rounded-full">
                      {q.topic}
                    </span>
                  </div>
                  <h3 className="text-headline-md text-on-surface mb-sm font-semibold">{q.question}</h3>
                  <p className="text-body-sm text-on-surface-variant">{q.answer_framework}</p>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-xl gap-md text-center bg-surface-container-lowest rounded-2xl border border-outline-variant/20">
                <p className="text-body-md text-on-surface font-medium">No {activeTab} questions yet</p>
                <p className="text-body-sm text-on-surface-variant">
                  This grows automatically as more candidates tailor resumes against JDs needing these skills.
                </p>
              </div>
            )}

            <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-sm flex flex-col items-center justify-center gap-md py-xl text-center">
              <p className="text-body-md text-on-surface font-medium">Get Personalized Questions</p>
              <p className="text-body-sm text-on-surface-variant" style={{ maxWidth: "28rem" }}>
                Analyze a job description and tailor your resume to generate interview questions specific to your target role.
              </p>
              <button
                onClick={() => router.push("/jd")}
                className="px-xl py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200"
              >
                Go to JD Analyzer
              </button>
            </div>
          </div>
        )}
```

Remove the now-unused `TOPIC_DATA` constant (lines 28-45) and its icon-only imports if any become unused (`Star`, `Users`, `ChatCircleText` stay — still used elsewhere in the file for the readiness sidebar; `Handshake`, `Money`, `Heart` become unused if nothing else references them — check with a grep before removing each one).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/interview-page.test.tsx`
Expected: 2 passed

- [ ] **Step 5: Type-check and run the full frontend suite**

Run: `cd apps/web && npx tsc --noEmit && npx vitest run`
Expected: both clean, no regressions in the existing suite

- [ ] **Step 6: Production build check**

Run: `cd apps/web && rm -rf .next && npm run build`
Expected: clean build

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(app)/interview/page.tsx" apps/web/__tests__/interview-page.test.tsx
git commit -m "feat(web): Interview Center browse mode shows real bank questions, not fake local progress"
```

---

## Explicitly Out of Scope (follow-up work, not part of this plan)

- Spaced repetition / review scheduling for practiced questions.
- Free-text answer submission with AI feedback/scoring.
- A session-history list/picker (today only the single most-recent `TailoringSession` is reachable from the Interview Center).
- Adding `user_id` to `PrepQuestion` for cross-session per-user aggregation.
- Changing what happens on `TailoringSession` cascade-delete (still destroys that session's practice history).

These were identified during research but are separate feature asks from "cache prep-question generation and make the no-session view real" — each deserves its own plan if pursued.

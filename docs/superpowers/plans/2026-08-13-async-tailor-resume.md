# Async Tailor Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix "Tailor Resume" hanging forever in production by making `/ai/tailor` return immediately and run the AI pipeline in the background, with the frontend polling for completion. Minimal footprint — no change to the AI pipeline itself, so tailoring quality/output is untouched.

**Architecture:** `POST /ai/tailor` now only validates ownership, creates a `TailoringSession` row with `status="pending"`, schedules the existing, unmodified `run_tailoring_pipeline` as a FastAPI `BackgroundTasks` job (own DB session, following the exact pattern already used for PDF storage persistence in `apps/api/app/routers/resumes.py`), and returns `{session_id, status}` in well under a second. The background job writes its result (or `status="failed"`) back onto the session row. The frontend's `runTailoring` store action starts the job, then polls the existing `GET /ai/sessions/{id}` (extended with `status`/`company_keywords`/`suggested_skills`) every 3s for up to 2 minutes until it sees `completed` or `failed`.

**Root cause being fixed:** Render's free-tier proxy returns a response with no CORS headers if the app doesn't answer within ~60s (browsers then misreport this as a CORS error). The tailoring pipeline runs 3 chained/parallel LLM calls on the "pro" model and legitimately takes 30–90s+, especially after a cold start — comfortably past that limit. Moving the AI work off the request/response path removes the proxy timeout as a constraint, without changing the pipeline itself (no faster/cheaper model, no prompt changes — output quality is unaffected).

**Tech Stack:** FastAPI + SQLAlchemy async + Alembic (backend), Next.js + Zustand + Vitest (frontend). No new dependencies.

**Spec:** No separate spec doc — implements the fix agreed on 2026-08-13 in conversation (root-caused via console CORS error + Render's documented ~60s proxy timeout), scoped down per explicit request to minimize the diff.

## Global Constraints

- Do not touch `apps/api/app/services/tailoring.py` (the AI pipeline itself) at all — this fix is purely about *when* the existing pipeline runs, never *how*.
- Follow the existing background-task pattern in `apps/api/app/routers/resumes.py` (`_persist_pdf_to_storage` + `AsyncSessionLocal`) exactly — don't invent a new one.
- Both "Tailor Resume" buttons (`EditorPanel.tsx:691` and `:853`) already have `disabled={isLoading || ...}` — a second overlapping `runTailoring()` call can't happen through the UI. Don't add guard/cancellation logic for that case; it's unreachable and would be pure speculative complexity.
- No `error_message` column / stored error text — on failure the frontend shows one fixed message. The real error is already captured server-side via `logger.exception` for debugging; round-tripping it to the user isn't needed for this fix.
- ORM model changes in `apps/api/app/db/models.py` must stay in sync with the Alembic migration by hand (this repo has no autogenerate-diff check; a prior commit had to fix drift manually).
- Status values are plain strings (`"pending"`, `"completed"`, `"failed"`), matching the existing `status: Mapped[str] = mapped_column(String(20), ...)` convention used by `JobDescription.status` etc. — no Python enum.
- Poll interval: 3000ms. Max attempts: 40 (2-minute ceiling). Literal values in the store, not config.

---

### Task 1: DB migration + model — minimal status tracking on `TailoringSession`

**Files:**
- Create: `apps/api/alembic/versions/007_tailoring_session_status.py`
- Modify: `apps/api/app/db/models.py:50-70` (the `TailoringSession` class)

**Interfaces:**
- Produces: `TailoringSession.status: str` (`"pending" | "completed" | "failed"`), `TailoringSession.company_keywords: list[str]`, `TailoringSession.suggested_skills: list[str]` — Task 2's router code reads/writes all three. `company_keywords`/`suggested_skills` exist purely so polling doesn't lose data the synchronous response used to return directly.

- [ ] **Step 1: Write the migration**

```python
"""add status/company_keywords/suggested_skills to tailoring_sessions

Revision ID: 007
Revises: 006
Create Date: 2026-08-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tailoring_sessions",
        sa.Column("status", sa.String(20), nullable=False, server_default="completed"),
    )
    op.add_column(
        "tailoring_sessions",
        sa.Column(
            "company_keywords",
            postgresql.ARRAY(sa.String()),
            nullable=False,
            server_default="{}",
        ),
    )
    op.add_column(
        "tailoring_sessions",
        sa.Column(
            "suggested_skills",
            postgresql.ARRAY(sa.String()),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade() -> None:
    op.drop_column("tailoring_sessions", "suggested_skills")
    op.drop_column("tailoring_sessions", "company_keywords")
    op.drop_column("tailoring_sessions", "status")
```

Note: `status` backfills existing rows to `"completed"` — every pre-existing session already has `tailored_content` populated (the endpoint was synchronous before this change), so that's the correct historical value.

- [ ] **Step 2: Update the ORM model to match**

In `apps/api/app/db/models.py`, the `TailoringSession` class currently ends with (around line 64-66):

```python
    tailored_content: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    humanize_level: Mapped[int] = mapped_column(Integer, default=50)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)
```

Change it to:

```python
    tailored_content: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    humanize_level: Mapped[int] = mapped_column(Integer, default=50)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    company_keywords: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    suggested_skills: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)
```

`String` and `ARRAY` are already imported at the top of `models.py` — no import changes needed. Note the ORM-level default is `"pending"` (for newly-constructed rows in code), which differs from the migration's DB-level backfill default of `"completed"` (for pre-existing rows) — that's intentional, not a mistake.

- [ ] **Step 3: Run the migration against the dev DB**

```bash
cd apps/api && source .venv/bin/activate && alembic upgrade head
```

Expected: runs cleanly, ends at revision `007`.

- [ ] **Step 4: Verify with a quick sanity check**

```bash
cd apps/api && source .venv/bin/activate && python -c "
from app.db.models import TailoringSession
s = TailoringSession(status='pending', company_keywords=[], suggested_skills=[])
print(s.status, s.company_keywords, s.suggested_skills)
"
```

Expected: `pending [] []`

- [ ] **Step 5: Commit**

```bash
git add apps/api/alembic/versions/007_tailoring_session_status.py apps/api/app/db/models.py
git commit -m "feat: add status column to tailoring_sessions for async tailoring"
```

---

### Task 2: Backend — make `POST /ai/tailor` fire-and-forget, run the pipeline in the background

**Files:**
- Modify: `apps/api/app/routers/ai.py:1-159`
- Modify: `apps/api/app/schemas/ai.py` (add `TailorStartOut`)
- Test: `apps/api/tests/test_jd_and_tailor_endpoints.py:367-496`

**Interfaces:**
- Consumes: `run_tailoring_pipeline(...)` (unchanged, from `app.services.tailoring`), `AsyncSessionLocal` (from `app.db.session`), `TailoringSession`/`PrepQuestion` models from Task 1.
- Produces: `POST /ai/tailor` → `202 {"session_id": "<uuid>", "status": "pending"}`. `GET /ai/sessions/{id}` → adds `status: str`, `company_keywords: list[str]`, `suggested_skills: list[str]` to its existing dict response. Task 3 (frontend) consumes both shapes.

- [ ] **Step 1: Add `TailorStartOut` schema**

In `apps/api/app/schemas/ai.py`, right before the existing `TailorOut` class, add:

```python
class TailorStartOut(BaseModel):
    session_id: uuid.UUID
    status: str
```

- [ ] **Step 2: Rewrite the `/tailor` endpoint and add the background worker**

Replace the whole `tailor_resume` function in `apps/api/app/routers/ai.py` (currently lines 79-158) with:

```python
async def _run_tailoring_background(
    session_id: uuid.UUID,
    resume_content: dict,
    jd_text: str,
    humanize_level: int,
    provider,
    company_name: str | None,
    priority_skills: list[str],
    cached_jd_analysis: JDAnalysis | None,
) -> None:
    """Runs the AI tailoring pipeline off the request path.

    Render's free-tier proxy returns a response with no CORS headers if the
    app doesn't answer within ~60s, which browsers then misreport as a CORS
    error. This pipeline chains 3 pro-model LLM calls and routinely takes
    30-90s+, especially on a cold start — well past that limit. POST
    /ai/tailor returns immediately with a pending session; this function
    does the actual work afterward and writes the result back onto it. Uses
    its own DB session (the request-scoped one may already be closed by the
    time this runs) — same pattern as _persist_pdf_to_storage in
    routers/resumes.py.
    """
    async with AsyncSessionLocal() as session_db:
        try:
            result = await run_tailoring_pipeline(
                resume_content,
                jd_text,
                humanize_level,
                provider,
                db=session_db,
                company_name=company_name,
                priority_skills=priority_skills,
                cached_jd_analysis=cached_jd_analysis,
            )
        except Exception:
            logger.exception("Tailoring pipeline failed for session %s", session_id)
            row_result = await session_db.execute(
                select(TailoringSession).where(TailoringSession.id == session_id)
            )
            row = row_result.scalar_one_or_none()
            if row:
                row.status = "failed"
                await session_db.commit()
            return

        row_result = await session_db.execute(
            select(TailoringSession).where(TailoringSession.id == session_id)
        )
        row = row_result.scalar_one_or_none()
        if not row:
            return  # session row is gone — nothing to update
        row.ats_score = result.ats_score
        row.matched_skills = result.matched_skills
        row.missing_skills = result.missing_skills
        row.tailored_content = result.tailored_content
        row.company_keywords = result.company_keywords
        row.suggested_skills = result.suggested_skills
        row.status = "completed"
        session_db.add_all(
            [
                PrepQuestion(
                    session_id=row.id,
                    topic=q.topic,
                    question=q.question,
                    answer_framework=q.answer_framework,
                    is_gap_based=q.is_gap_based,
                    order_index=q.order_index,
                )
                for q in result.prep_questions
            ]
        )
        await session_db.commit()


@router.post("/tailor", response_model=TailorStartOut, status_code=202)
@limiter.limit("10/minute")
async def tailor_resume(
    request: Request,
    body: TailorRequest,
    background_tasks: BackgroundTasks,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    uid = uuid.UUID(user["sub"])
    resume_row = (
        await db.execute(select(Resume).where(Resume.id == body.resume_id, Resume.user_id == uid))
    ).scalar_one_or_none()
    jd_row = (
        await db.execute(select(JobDescription).where(JobDescription.id == body.jd_id, JobDescription.user_id == uid))
    ).scalar_one_or_none()
    if not resume_row or not jd_row:
        raise HTTPException(status_code=404, detail="Resume or JD not found")

    provider = get_ai_provider()

    # Reuse cached Agent 1 output (same logic as /analyze) so tailoring uses
    # the same skill list as a prior analysis — consistent ATS score throughout.
    cached_for_tailor: JDAnalysis | None = None
    if not body.company_name:
        raw_cached = (jd_row.parsed or {}).get("agent1")
        if raw_cached:
            try:
                cached_for_tailor = JDAnalysis(**raw_cached)
            except Exception:
                cached_for_tailor = None

    session = TailoringSession(
        user_id=uid,
        resume_id=body.resume_id,
        jd_id=body.jd_id,
        humanize_level=body.humanize_level,
        status="pending",
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    background_tasks.add_task(
        _run_tailoring_background,
        session.id,
        resume_row.content,
        jd_row.raw_text,
        body.humanize_level,
        provider,
        body.company_name,
        body.priority_skills,
        cached_for_tailor,
    )

    return TailorStartOut(session_id=session.id, status="pending")
```

At the top of `apps/api/app/routers/ai.py`, update the imports:

```python
import logging
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import attributes
from app.db.session import get_db, AsyncSessionLocal
from app.db.models import Resume, JobDescription, TailoringSession, PrepQuestion, SkillQuestionBank
from app.core.security import get_current_user
from app.core.rate_limit import limiter
from app.schemas.ai import (
    TailorRequest, TailorOut, TailorStartOut, PrepQuestionOut, AnalyzeRequest, AnalyzeOut,
    RewriteBulletRequest, RewriteBulletOut, SkillQuestionOut,
)
from app.services.ai_engine.factory import get_ai_provider
from app.services.tailoring import run_tailoring_pipeline, analyze_jd_match, JDAnalysis

router = APIRouter(prefix="/ai", tags=["ai"])
logger = logging.getLogger("app")
```

(`TailorOut` stays imported — other code/tests may still reference the schema even though `/tailor` no longer returns it directly.)

- [ ] **Step 3: Extend `GET /sessions/{id}` with the new fields**

In the same file, update `get_session` (currently lines 219-240):

```python
@router.get("/sessions/{session_id}")
async def get_session(session_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Return a tailoring session's stored output so the frontend can reload a
    previous tailored resume without re-running the AI, or poll a pending one
    started by POST /ai/tailor."""
    result = await db.execute(
        select(TailoringSession).where(
            TailoringSession.id == session_id,
            TailoringSession.user_id == uuid.UUID(user["sub"]),
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "session_id": str(session.id),
        "resume_id": str(session.resume_id),
        "jd_id": str(session.jd_id),
        "status": session.status,
        "tailored_content": session.tailored_content,
        "ats_score": session.ats_score,
        "matched_skills": session.matched_skills,
        "missing_skills": session.missing_skills,
        "company_keywords": session.company_keywords,
        "suggested_skills": session.suggested_skills,
    }
```

- [ ] **Step 4: Replace the existing tailor-success test**

In `apps/api/tests/test_jd_and_tailor_endpoints.py`, replace `test_tailor_resume_returns_200_and_creates_session` (lines 367-433) with:

```python
@pytest.mark.asyncio
async def test_tailor_resume_returns_202_and_creates_pending_session():
    override, mock_session = make_mock_db()
    resume = make_resume()
    jd = make_jd()

    resume_result = MagicMock()
    resume_result.scalar_one_or_none.return_value = resume
    jd_result = MagicMock()
    jd_result.scalar_one_or_none.return_value = jd
    mock_session.execute = AsyncMock(side_effect=[resume_result, jd_result])

    from app.db.models import TailoringSession

    def fake_add(obj):
        if isinstance(obj, TailoringSession) and obj.id is None:
            obj.id = uuid.uuid4()

    mock_session.add = MagicMock(side_effect=fake_add)

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.run_tailoring_pipeline", new=AsyncMock()):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(
                    "/ai/tailor",
                    json={"resume_id": str(resume.id), "jd_id": str(jd.id), "humanize_level": 50},
                    headers=make_auth_header(),
                )
        assert r.status_code == 202
        body = r.json()
        assert body["status"] == "pending"
        assert "session_id" in body
        mock_session.add.assert_called_once()  # the pending TailoringSession row
    finally:
        app.dependency_overrides.pop(get_db, None)
```

- [ ] **Step 5: Replace the priority-skills test with one covering the background task end-to-end**

Replace `test_tailor_resume_forwards_priority_skills_to_pipeline` (lines 436-495) with:

```python
@pytest.mark.asyncio
async def test_tailor_resume_background_task_persists_result_and_forwards_priority_skills():
    from app.services.tailoring import TailoringResult, PrepQuestionData
    from app.db.models import TailoringSession

    override, mock_session = make_mock_db()
    resume = make_resume()
    jd = make_jd()

    resume_result = MagicMock()
    resume_result.scalar_one_or_none.return_value = resume
    jd_result = MagicMock()
    jd_result.scalar_one_or_none.return_value = jd
    mock_session.execute = AsyncMock(side_effect=[resume_result, jd_result])

    created_session = TailoringSession(
        user_id=resume.user_id, resume_id=resume.id, jd_id=jd.id, humanize_level=50, status="pending"
    )

    def fake_add(obj):
        if isinstance(obj, TailoringSession) and obj.id is None:
            obj.id = uuid.uuid4()
            created_session.id = obj.id

    mock_session.add = MagicMock(side_effect=fake_add)

    # The background task's own DB session — its execute() re-fetches the
    # row the request handler just created.
    bg_session = MagicMock()
    bg_result = MagicMock()
    bg_result.scalar_one_or_none.side_effect = lambda: created_session
    bg_session.execute = AsyncMock(return_value=bg_result)
    bg_session.commit = AsyncMock()
    bg_session.add_all = MagicMock()

    class _FakeSessionContextManager:
        async def __aenter__(self):
            return bg_session

        async def __aexit__(self, *exc_info):
            return False

    fake_result = TailoringResult(
        tailored_content={"experience": []},
        matched_skills=["Python"],
        missing_skills=["AWS"],
        ats_score=50,
        prep_questions=[],
        company_keywords=["Acme Corp"],
        suggested_skills=["Kubernetes"],
    )
    pipeline_mock = AsyncMock(return_value=fake_result)

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.run_tailoring_pipeline", new=pipeline_mock), patch(
            "app.routers.ai.AsyncSessionLocal", new=lambda: _FakeSessionContextManager()
        ):
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
        assert r.status_code == 202
        _, kwargs = pipeline_mock.call_args
        assert kwargs["priority_skills"] == ["Kubernetes", "Terraform"]
        assert created_session.status == "completed"
        assert created_session.suggested_skills == ["Kubernetes"]
        assert created_session.company_keywords == ["Acme Corp"]
        bg_session.commit.assert_called()
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_tailor_resume_background_task_marks_session_failed_on_pipeline_error():
    from app.db.models import TailoringSession

    override, mock_session = make_mock_db()
    resume = make_resume()
    jd = make_jd()

    resume_result = MagicMock()
    resume_result.scalar_one_or_none.return_value = resume
    jd_result = MagicMock()
    jd_result.scalar_one_or_none.return_value = jd
    mock_session.execute = AsyncMock(side_effect=[resume_result, jd_result])

    created_session = TailoringSession(
        user_id=resume.user_id, resume_id=resume.id, jd_id=jd.id, humanize_level=50, status="pending"
    )

    def fake_add(obj):
        if isinstance(obj, TailoringSession) and obj.id is None:
            obj.id = uuid.uuid4()
            created_session.id = obj.id

    mock_session.add = MagicMock(side_effect=fake_add)

    bg_session = MagicMock()
    bg_result = MagicMock()
    bg_result.scalar_one_or_none.side_effect = lambda: created_session
    bg_session.execute = AsyncMock(return_value=bg_result)
    bg_session.commit = AsyncMock()

    class _FakeSessionContextManager:
        async def __aenter__(self):
            return bg_session

        async def __aexit__(self, *exc_info):
            return False

    pipeline_mock = AsyncMock(side_effect=RuntimeError("LLM provider timed out"))

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.ai.run_tailoring_pipeline", new=pipeline_mock), patch(
            "app.routers.ai.AsyncSessionLocal", new=lambda: _FakeSessionContextManager()
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(
                    "/ai/tailor",
                    json={"resume_id": str(resume.id), "jd_id": str(jd.id), "humanize_level": 50},
                    headers=make_auth_header(),
                )
        assert r.status_code == 202
        assert created_session.status == "failed"
    finally:
        app.dependency_overrides.pop(get_db, None)
```

- [ ] **Step 6: Add one test for the extended `GET /sessions/{id}` fields**

Find the existing test(s) covering `GET /ai/sessions/{id}` in `apps/api/tests/test_jd_and_tailor_endpoints.py` (search `get_session` / `"/ai/sessions/"`); add a new one right after them:

```python
@pytest.mark.asyncio
async def test_get_session_includes_status_field():
    from app.db.models import TailoringSession

    override, mock_session = make_mock_db()
    session_row = TailoringSession(
        id=uuid.uuid4(),
        user_id=uuid.UUID(TEST_USER_ID),
        resume_id=uuid.uuid4(),
        jd_id=uuid.uuid4(),
        status="pending",
        company_keywords=["Acme"],
        suggested_skills=["Kubernetes"],
    )
    result = MagicMock()
    result.scalar_one_or_none.return_value = session_row
    mock_session.execute = AsyncMock(return_value=result)

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/ai/sessions/{session_row.id}", headers=make_auth_header())
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "pending"
        assert body["company_keywords"] == ["Acme"]
        assert body["suggested_skills"] == ["Kubernetes"]
    finally:
        app.dependency_overrides.pop(get_db, None)
```

- [ ] **Step 7: Run the backend test suite**

```bash
cd apps/api && source .venv/bin/activate && pytest tests/test_jd_and_tailor_endpoints.py -v
```

Expected: all tests pass, including the 3 new/rewritten ones. If `TailoringSession(...)` construction in a test errors about unknown status default, re-check Task 1 Step 2 was applied.

- [ ] **Step 8: Commit**

```bash
git add apps/api/app/routers/ai.py apps/api/app/schemas/ai.py apps/api/tests/test_jd_and_tailor_endpoints.py
git commit -m "fix: run resume tailoring as a background task to avoid proxy timeouts"
```

---

### Task 3: Frontend — poll for the tailoring result instead of awaiting one long request

**Files:**
- Modify: `apps/web/lib/api-client.ts:182-213` (`tailorResume`, `getSession`)
- Modify: `apps/web/stores/tailoring-store.ts` (`runTailoring`)
- Test: `apps/web/__tests__/tailoring-store.test.ts`

**Interfaces:**
- Consumes: `POST /ai/tailor` → `{session_id, status}`, `GET /ai/sessions/{id}` → `{session_id, resume_id, jd_id, status, tailored_content, ats_score, matched_skills, missing_skills, company_keywords, suggested_skills}` (Task 2's shapes).
- Produces: `useTailoringStore.getState().runTailoring(resumeId)` behaves the same from every caller's point of view (`EditorPanel.tsx`, `BulletReviewPanel.tsx` — unchanged call sites) — it still ends with `isLoading: false` and either a hydrated `pendingContent`/`atsScore`/etc. or a populated `error`.

- [ ] **Step 1: Update `api-client.ts`'s tailoring methods**

In `apps/web/lib/api-client.ts`, replace the `tailorResume` and `getSession` entries (currently lines 182-213) with:

```typescript
  tailorResume: (
    resumeId: string,
    jdId: string,
    humanizeLevel: number,
    companyName?: string,
    prioritySkills?: string[],
  ): Promise<{ session_id: string; status: string }> =>
    request("POST", "/ai/tailor", {
      resume_id: resumeId,
      jd_id: jdId,
      humanize_level: humanizeLevel,
      ...(companyName?.trim() ? { company_name: companyName.trim() } : {}),
      ...(prioritySkills && prioritySkills.length > 0 ? { priority_skills: prioritySkills } : {}),
    }),

  rewriteBullet: (payload: {
    bullet_text: string;
    mode: "rewrite" | "humanize";
    jd_context?: string;
    humanize_level?: number;
  }): Promise<{ rewritten_text: string }> =>
    request<{ rewritten_text: string }>("POST", "/ai/rewrite-bullet", payload),

  getSession: (sessionId: string): Promise<{
    session_id: string;
    resume_id: string;
    jd_id: string;
    status: "pending" | "completed" | "failed";
    tailored_content: ResumeContent | null;
    ats_score: number | null;
    matched_skills: string[];
    missing_skills: string[];
    company_keywords: string[];
    suggested_skills: string[];
  }> => request("GET", `/ai/sessions/${sessionId}`),
```

(The `rewriteBullet` block is unchanged — shown only to mark `getSession`'s position relative to it; keep it as-is.)

- [ ] **Step 2: Remove the now-unused `TailorOut` import**

In `apps/web/lib/api-client.ts`'s `import type { ... } from "@career-copilot/types"` block, remove `TailorOut` — it was only used as `tailorResume`'s return type. Keep every other imported type as-is.

- [ ] **Step 3: Rewrite `runTailoring` with polling**

In `apps/web/stores/tailoring-store.ts`, replace the whole `runTailoring` implementation (currently lines 230-328) with:

```typescript
  runTailoring: async (resumeId: string) => {
    let { jdId } = get();
    const { jdText, humanizeLevel, companyName, prioritySkills } = get();

    if (!jdId) {
      if (!jdText.trim()) {
        set({ error: "No job description selected" });
        return;
      }
      try {
        const title = jdText.trim().split("\n")[0].slice(0, 120) || "Untitled JD";
        const jd = await apiClient.createJd({ title, raw_text: jdText });
        jdId = jd.id;
        set({ jdId });
      } catch (e: unknown) {
        set({ error: e instanceof Error ? e.message : "Failed to save job description" });
        return;
      }
    }

    set({
      isLoading: true,
      error: null,
      atsScore: null,
      matchedSkills: [],
      missingSkills: [],
      companyKeywords: [],
      suggestedSkills: [],
      sessionId: null,
      pendingContent: null,
      bulletDecisions: {},
      mergedContent: null,
      previewPdfUrl: null,
    });

    let started: { session_id: string; status: string };
    try {
      started = await apiClient.tailorResume(
        resumeId,
        jdId,
        humanizeLevel,
        companyName || undefined,
        prioritySkills,
      );
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : "Tailoring failed", isLoading: false });
      return;
    }

    // Poll GET /ai/sessions/{id} — the background job on the server can take
    // 30-90s+ (chained LLM calls), well past what a single HTTP request can
    // wait on Render's proxy. See routers/ai.py's _run_tailoring_background
    // for why this exists. The "Tailor Resume" button is disabled while
    // isLoading is true, so this can't overlap with a second call.
    const POLL_INTERVAL_MS = 3000;
    const MAX_ATTEMPTS = 40; // ~2 minutes ceiling

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let session;
      try {
        session = await apiClient.getSession(started.session_id);
      } catch (e: unknown) {
        set({ error: e instanceof Error ? e.message : "Tailoring failed", isLoading: false });
        return;
      }

      if (session.status === "completed") {
        const initialDecisions: Record<string, BulletDecision> = {};
        if (session.tailored_content) {
          const originalContent = useResumeStore.getState().content;
          if (originalContent) {
            session.tailored_content.experience.forEach((job, jobIdx) => {
              const origJob = originalContent.experience[jobIdx];
              job.bullets.forEach((bullet, bulletIdx) => {
                const origBullet = origJob?.bullets[bulletIdx] ?? "";
                if (bullet !== origBullet) {
                  initialDecisions[`exp${jobIdx}_b${bulletIdx}`] = "accept";
                }
              });
            });
            const originalSkillsSet = new Set(originalContent.skills);
            const tailoredSkillsSet = new Set(session.tailored_content.skills);
            for (const s of session.tailored_content.skills) {
              if (!originalSkillsSet.has(s)) initialDecisions[`skill_add:${s}`] = "accept";
            }
            for (const s of originalContent.skills) {
              if (!tailoredSkillsSet.has(s)) initialDecisions[`skill_rm:${s}`] = "reject";
            }
          }
        }

        const prioritySet = new Set(prioritySkills.map((s) => s.toLowerCase()));
        for (const s of session.suggested_skills) {
          if (prioritySet.has(s.toLowerCase())) {
            initialDecisions[`skill_add:${s}`] = "accept";
          }
        }

        set({
          sessionId: session.session_id,
          atsScore: session.ats_score,
          matchedSkills: session.matched_skills,
          missingSkills: session.missing_skills,
          companyKeywords: session.company_keywords,
          suggestedSkills: session.suggested_skills,
          pendingContent: session.tailored_content,
          bulletDecisions: initialDecisions,
          isLoading: false,
        });
        return;
      }

      if (session.status === "failed") {
        set({ error: "Tailoring failed — please try again.", isLoading: false });
        return;
      }

      // Still pending — wait before the next check, unless this was the last attempt.
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    }

    set({
      error: "Tailoring is taking longer than expected. Please try again in a moment.",
      isLoading: false,
    });
  },
```

- [ ] **Step 4: Update the test file's mocks**

Replace the `vi.mock("@/lib/api-client", ...)` block and `mockTailorResult` at the top of `apps/web/__tests__/tailoring-store.test.ts` (currently lines 1-30) with:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ResumeContent, JobDescription } from "@career-copilot/types";

// ── Mock apiClient ────────────────────────────────────────────────────────
// NOTE: vi.mock is hoisted, so the factory must NOT reference outer variables.
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    tailorResume: vi.fn(),
    getSession: vi.fn(),
    updateResume: vi.fn().mockResolvedValue({}),
    createResume: vi.fn(),
    generatePdf: vi.fn().mockResolvedValue({ signed_url: "https://example.com/tailored.pdf" }),
    createJd: vi.fn(),
    analyzeJd: vi.fn(),
  },
}));

const mockCompletedSession = {
  session_id: "session-xyz",
  resume_id: "resume-abc",
  jd_id: "jd-001",
  status: "completed" as const,
  ats_score: 82,
  matched_skills: ["TypeScript", "React"],
  missing_skills: ["GraphQL"],
  tailored_content: {
    contact: { name: "Jane Doe", email: "jane@example.com" },
    experience: [],
    education: [],
    skills: ["TypeScript", "React"],
  },
  company_keywords: [],
  suggested_skills: [],
};
```

Update the `beforeEach` block (currently around lines 45-64) — replace:

```typescript
    // Default: tailorResume resolves with the mock result
    vi.mocked(apiClient.tailorResume).mockResolvedValue(mockTailorResult);
```

with:

```typescript
    // Default: tailorResume kicks off a session, getSession reports it done
    // on the very first poll — most tests don't care about the pending phase.
    vi.mocked(apiClient.tailorResume).mockResolvedValue({
      session_id: "session-xyz",
      status: "pending",
    });
    vi.mocked(apiClient.getSession).mockResolvedValue(mockCompletedSession);
```

- [ ] **Step 5: Update tests that customized the tailored result via `tailorResume`**

Each of these currently calls `vi.mocked(apiClient.tailorResume).mockResolvedValueOnce({ ...mockTailorResult, ... })` to customize the result for one test. Since `tailorResume` no longer carries the result, switch each to `vi.mocked(apiClient.getSession).mockResolvedValueOnce({ ...mockCompletedSession, ... })`, keeping the same override fields:

- `"generatePreview merges accepted bullets and renders a preview without persisting"` (currently around line 191): change
  ```typescript
  vi.mocked(apiClient.tailorResume).mockResolvedValueOnce({
    ...mockTailorResult,
    tailored_content: {
      ...mockTailorResult.tailored_content,
      experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff, tailored"] }],
    },
  });
  ```
  to
  ```typescript
  vi.mocked(apiClient.getSession).mockResolvedValueOnce({
    ...mockCompletedSession,
    tailored_content: {
      ...mockCompletedSession.tailored_content,
      experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff, tailored"] }],
    },
  });
  ```

- `"reanalyzePreview re-scores the current merged bullets against the JD without persisting"` (currently around line 231): same substitution — `tailorResume` → `getSession`, `mockTailorResult` → `mockCompletedSession`, keeping the `ats_score: 60` and `tailored_content` overrides.

- `"runTailoring auto-accepts skill_add decisions for priority skills present in the result"` (currently around line 380):
  ```typescript
  vi.mocked(apiClient.tailorResume).mockResolvedValueOnce({
    ...mockTailorResult,
    suggested_skills: ["Kubernetes", "Docker"],
  });
  ```
  becomes
  ```typescript
  vi.mocked(apiClient.getSession).mockResolvedValueOnce({
    ...mockCompletedSession,
    suggested_skills: ["Kubernetes", "Docker"],
  });
  ```

All other existing tests need no changes beyond the shared `beforeEach` mock update in Step 4 — they don't reference `mockTailorResult` directly.

- [ ] **Step 6: Add two tests for the polling behavior**

Add these anywhere inside the `describe("useTailoringStore", ...)` block:

```typescript
  it("runTailoring polls until the session status is completed", async () => {
    vi.useFakeTimers();
    try {
      useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
      useTailoringStore.getState().setJd("jd-001", "raw text");
      vi.mocked(apiClient.getSession)
        .mockResolvedValueOnce({ ...mockCompletedSession, status: "pending", tailored_content: null })
        .mockResolvedValueOnce(mockCompletedSession);

      const promise = useTailoringStore.getState().runTailoring("resume-abc");
      await vi.advanceTimersByTimeAsync(3000);
      await promise;

      expect(apiClient.getSession).toHaveBeenCalledTimes(2);
      const state = useTailoringStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.atsScore).toBe(82);
      expect(state.sessionId).toBe("session-xyz");
    } finally {
      vi.useRealTimers();
    }
  });

  it("runTailoring surfaces a generic error when the session status is failed", async () => {
    useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.getSession).mockResolvedValueOnce({
      ...mockCompletedSession,
      status: "failed",
      tailored_content: null,
    });

    await useTailoringStore.getState().runTailoring("resume-abc");

    const state = useTailoringStore.getState();
    expect(state.error).toBe("Tailoring failed — please try again.");
    expect(state.isLoading).toBe(false);
    expect(state.pendingContent).toBeNull();
  });
```

- [ ] **Step 7: Run the frontend test suite**

```bash
cd apps/web && npm test -- tailoring-store.test.ts
```

Expected: all tests pass (the pre-existing 17 plus the 2 new ones = 19 total).

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/api-client.ts apps/web/stores/tailoring-store.ts apps/web/__tests__/tailoring-store.test.ts
git commit -m "fix: poll for tailoring completion instead of awaiting one long request"
```

---

### Task 4: Frontend copy — fix the now-inaccurate "15–30 seconds" wait-state text

**Files:**
- Modify: `apps/web/components/resume/EditorPanel.tsx:700` and `:863`

**Interfaces:** None — copy-only change.

- [ ] **Step 1: Update both occurrences**

Both lines currently read:

```typescript
                  AI is rewriting your bullets — this takes 15–30 seconds…
```

Change both (line 700 and line 863) to:

```typescript
                  AI is rewriting your bullets — this can take up to a couple of minutes…
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/resume/EditorPanel.tsx
git commit -m "fix: update tailoring wait-state copy to match the new async timeline"
```

---

### Task 5: Verification

**Files:** None modified.

- [ ] **Step 1: Run the full backend test suite**

```bash
cd apps/api && source .venv/bin/activate && pytest -v
```

- [ ] **Step 2: Run the full frontend test suite**

```bash
cd apps/web && npm test
```

- [ ] **Step 3: Manual smoke test against a local stack**

Use the `run-ai-copilot` skill to start both services locally, sign in with a real Supabase test account, run a JD analysis, click "Tailor Resume", and confirm the button shows a loading state immediately (not a hang) and the Bullet Review panel appears within ~2 minutes with tailored content, including suggested-skill chips and company keywords (the two fields most at risk of being silently dropped by this change).

- [ ] **Step 4: Deploy and confirm in production** (yours to run — real infra action)

```bash
git push origin main
```

Wait for Render + Vercel to redeploy, then repeat the original repro (JD Analyzer → paste a JD → Tailor Resume) and confirm it completes without the CORS error.

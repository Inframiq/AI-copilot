# Cover Letter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AI-generated, editable, downloadable cover letters, tied to a resume + JD pair (reusing an existing tailoring session's content when one exists, or generated standalone).

**Architecture:** New `cover_letters` table (mirrors `tailoring_sessions`: FKs to `resume_id`/`jd_id`/optional `tailoring_session_id`, async pending/completed/failed status). A new "letter writer" AI agent in `tailoring.py` reuses the cached `JDAnalysis` from `analyze_jd_match` — no duplicate JD-parsing call. A new `cover_letters.py` router follows the exact background-task pattern `POST /ai/tailor` already uses (create pending row → `background_tasks.add_task` → poll). A new Jinja/WeasyPrint template reuses the existing `pdf.py` plumbing. On the frontend, the editor page uses TanStack Query (fetch + poll while `status === "pending"`) and local component state for the draft text, not a new Zustand store — deliberately avoiding the cross-store coupling that caused the JD "Open" bug fixed earlier this session (`tailoring-store`'s `jdId` leaking into `EditorPanel`'s render mode). Each page's state is self-contained.

**Tech Stack:** FastAPI + SQLAlchemy (async) + Alembic + Pydantic (backend), Next.js + TanStack Query + Zustand (existing stores untouched except one prop refactor) + Radix UI (frontend), WeasyPrint + Jinja2 (PDF).

## Global Constraints

- Every new endpoint uses `Depends(get_current_user)` and filters by `user_id` — never trust a client-supplied user id.
- AI-generation and PDF-generation endpoints are rate-limited via `@limiter.limit(...)`, matching existing endpoints of the same shape (`POST /ai/tailor` → `10/minute`, `POST /resumes/{id}/pdf` → `10/minute`).
- The letter-writer prompt must never fabricate a hiring manager's name, a company address, or any candidate fact not already present in `resume_content` — same FACT LOCK principle Agent 3 already follows in `tailoring.py`.
- `humanize_level` is `int`, `ge=0, le=100`, default `50` — matches `TailorRequest`.
- All new frontend types are added to `packages/types/index.ts`, not redeclared locally.
- Run `cd apps/api && python -m pytest -q` and `cd apps/web && npx vitest run` (or the specific test file) after every task; run `cd apps/web && npx tsc --noEmit -p .` after every frontend task.

---

## File Structure

**Backend — create:**
- `apps/api/alembic/versions/008_cover_letters.py` — migration for the new table.
- `apps/api/app/schemas/cover_letter.py` — request/response Pydantic models.
- `apps/api/templates/cover_letter.html` — Jinja letter template.
- `apps/api/app/routers/cover_letters.py` — CRUD + generate + PDF endpoints.
- `apps/api/tests/test_cover_letters.py` — router tests.

**Backend — modify:**
- `apps/api/app/db/models.py` — add `CoverLetter`.
- `apps/api/app/services/tailoring.py` — add `CoverLetterOutput`, `_build_cover_letter_system`, `write_cover_letter`.
- `apps/api/app/services/pdf.py` — add `_render_letter_html`, `generate_letter_pdf`, `upload_letter_pdf`.
- `apps/api/app/routers/jd.py` — add `GET /{jd_id}/cover-letter`.
- `apps/api/app/main.py` — register the new router.
- `apps/api/tests/test_tailoring.py` — writer-agent test.
- `apps/api/tests/test_jd_and_tailor_endpoints.py` — new-endpoint test.

**Frontend — create:**
- `apps/web/app/(app)/cover-letters/[id]/page.tsx` — editor.
- `apps/web/__tests__/cover-letter-list-page.test.tsx`
- `apps/web/__tests__/cover-letter-editor-page.test.tsx`

**Frontend — modify:**
- `packages/types/index.ts` — add `CoverLetter`, `CoverLetterStart`, `JDCoverLetter`.
- `apps/web/lib/api-client.ts` — add cover-letter methods.
- `apps/web/components/resume/HumanizeSlider.tsx` — generalize to `value`/`onChange` props.
- `apps/web/components/resume/EditorPanel.tsx` — update the one existing call site.
- `apps/web/app/(app)/cover-letters/page.tsx` — replace the placeholder with list + create.
- `apps/web/app/(app)/jd/[jdId]/page.tsx` — add a Cover Letter row to "Generated for This JD".
- `apps/web/__tests__/components/Sidebar.test.tsx` — unaffected, no change needed (label already added).

---

### Task 1: `CoverLetter` model + migration

**Files:**
- Modify: `apps/api/app/db/models.py`
- Create: `apps/api/alembic/versions/008_cover_letters.py`
- Test: `apps/api/tests/test_models_cover_letter.py`

**Interfaces:**
- Produces: `CoverLetter` (SQLAlchemy model) with columns `id`, `user_id`, `resume_id`, `jd_id`, `tailoring_session_id`, `content`, `humanize_level`, `pdf_url`, `status`, `created_at`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_models_cover_letter.py
import uuid
from app.db.models import CoverLetter


def test_cover_letter_defaults():
    letter = CoverLetter(
        user_id=uuid.uuid4(),
        resume_id=uuid.uuid4(),
        jd_id=uuid.uuid4(),
    )
    assert letter.__tablename__ == "cover_letters"
    assert letter.status == "pending"
    assert letter.humanize_level == 50
    assert letter.tailoring_session_id is None
    assert letter.content is None
    assert letter.pdf_url is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_models_cover_letter.py -v`
Expected: FAIL with `ImportError: cannot import name 'CoverLetter'`

- [ ] **Step 3: Add the model**

Add to `apps/api/app/db/models.py`, after the `TailoringSession` class (so it can reference `TailoringSession` in its FK) and before `PrepQuestion`:

```python
class CoverLetter(Base):
    __tablename__ = "cover_letters"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    resume_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resumes.id", ondelete="CASCADE")
    )
    jd_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("job_descriptions.id", ondelete="CASCADE")
    )
    # Nullable — set when generated from an existing tailoring session (reuses
    # its tailored content); null for a standalone resume+JD generation. When
    # the linked session is deleted, the letter goes with it (CASCADE),
    # mirroring how PrepQuestion cascades off TailoringSession.
    tailoring_session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tailoring_sessions.id", ondelete="CASCADE"), nullable=True
    )
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    humanize_level: Mapped[int] = mapped_column(Integer, default=50)
    pdf_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), default=utcnow)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_models_cover_letter.py -v`
Expected: PASS

- [ ] **Step 5: Write the migration**

```python
# apps/api/alembic/versions/008_cover_letters.py
"""add cover_letters table

Revision ID: 008
Revises: 007
Create Date: 2026-08-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "cover_letters",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "resume_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("resumes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "jd_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("job_descriptions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "tailoring_session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tailoring_sessions.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("content", sa.Text, nullable=True),
        sa.Column("humanize_level", sa.Integer, nullable=False, server_default="50"),
        sa.Column("pdf_url", sa.Text, nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False),
    )
    op.create_index("ix_cover_letters_user_id", "cover_letters", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_cover_letters_user_id", table_name="cover_letters")
    op.drop_table("cover_letters")
```

- [ ] **Step 6: Apply the migration against the dev database**

Run: `cd apps/api && source .venv/Scripts/activate && alembic upgrade head`
Expected: `Running upgrade 007 -> 008, add cover_letters table` with no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/db/models.py apps/api/alembic/versions/008_cover_letters.py apps/api/tests/test_models_cover_letter.py
git commit -m "feat: add CoverLetter model and migration"
```

---

### Task 2: Pydantic schemas

**Files:**
- Create: `apps/api/app/schemas/cover_letter.py`
- Test: `apps/api/tests/test_cover_letter_schemas.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `CoverLetterGenerateRequest`, `CoverLetterStartOut`, `CoverLetterOut`, `CoverLetterUpdate` — imported by `routers/cover_letters.py` (Task 5) and `routers/jd.py` (Task 6).

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_cover_letter_schemas.py
import uuid
import pytest
from pydantic import ValidationError
from app.schemas.cover_letter import (
    CoverLetterGenerateRequest,
    CoverLetterUpdate,
)


def test_generate_request_defaults():
    req = CoverLetterGenerateRequest(resume_id=uuid.uuid4(), jd_id=uuid.uuid4())
    assert req.humanize_level == 50
    assert req.tailoring_session_id is None
    assert req.company_name is None


def test_generate_request_rejects_out_of_range_humanize_level():
    with pytest.raises(ValidationError):
        CoverLetterGenerateRequest(resume_id=uuid.uuid4(), jd_id=uuid.uuid4(), humanize_level=150)


def test_update_caps_content_length():
    with pytest.raises(ValidationError):
        CoverLetterUpdate(content="x" * 20001)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_cover_letter_schemas.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.schemas.cover_letter'`

- [ ] **Step 3: Write the schemas**

```python
# apps/api/app/schemas/cover_letter.py
import uuid
from datetime import datetime
from pydantic import BaseModel, Field


class CoverLetterGenerateRequest(BaseModel):
    resume_id: uuid.UUID
    jd_id: uuid.UUID
    # Set to reuse an existing tailoring session's tailored resume content
    # instead of the resume's saved (untailored) content. Omit for a
    # standalone letter generated straight from the resume as saved.
    tailoring_session_id: uuid.UUID | None = None
    humanize_level: int = Field(default=50, ge=0, le=100)
    company_name: str | None = Field(default=None, max_length=200)


class CoverLetterStartOut(BaseModel):
    cover_letter_id: uuid.UUID
    status: str


class CoverLetterOut(BaseModel):
    id: uuid.UUID
    resume_id: uuid.UUID
    jd_id: uuid.UUID
    tailoring_session_id: uuid.UUID | None
    content: str | None
    humanize_level: int
    pdf_url: str | None
    status: str
    created_at: datetime
    model_config = {"from_attributes": True}


class CoverLetterUpdate(BaseModel):
    content: str = Field(max_length=20000)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_cover_letter_schemas.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/schemas/cover_letter.py apps/api/tests/test_cover_letter_schemas.py
git commit -m "feat: add cover letter request/response schemas"
```

---

### Task 3: Letter-writer AI agent

**Files:**
- Modify: `apps/api/app/services/tailoring.py`
- Test: `apps/api/tests/test_tailoring.py`

**Interfaces:**
- Consumes: `JDAnalysis` (existing), `AIProvider` (existing), `_sanitize_skill_list` (existing).
- Produces: `CoverLetterOutput` (Pydantic, field `body: str`), `write_cover_letter(resume_content: dict, jd_analysis: JDAnalysis, matched_skills: list[str], jd_title: str, company_name: str | None, humanize_level: int, provider: AIProvider) -> CoverLetterOutput` — consumed by `routers/cover_letters.py` (Task 5).

- [ ] **Step 1: Write the failing test**

Add to `apps/api/tests/test_tailoring.py` (uses the existing `make_mock_provider` helper already defined in that file):

```python
@pytest.mark.asyncio
async def test_write_cover_letter_passes_jd_and_resume_context_to_the_prompt():
    from app.services.tailoring import write_cover_letter, CoverLetterOutput

    provider = make_mock_provider(
        structured_return=CoverLetterOutput(
            body="Dear Hiring Manager,\n\nI am excited to apply...\n\nSincerely,\nJane Doe"
        )
    )
    jd_analysis = make_jd_analysis(
        exact_technical_tools=["Python", "AWS"],
        domain_expertise_themes=["distributed systems"],
    )
    resume_content = {
        "contact": {"name": "Jane Doe", "email": "jane@example.com"},
        "experience": [{"company": "Acme", "title": "Engineer", "bullets": ["Built APIs with Python"]}],
        "skills": ["Python", "AWS"],
    }

    result = await write_cover_letter(
        resume_content, jd_analysis, ["Python", "AWS"], "Senior Backend Engineer",
        "Acme Corp", 50, provider,
    )

    assert isinstance(result, CoverLetterOutput)
    assert "Jane Doe" in result.body
    provider.complete_structured.assert_called_once()
    call_args = provider.complete_structured.call_args
    sent_payload = call_args.args[1]
    assert "Senior Backend Engineer" in sent_payload
    assert "Acme Corp" in sent_payload
    assert "distributed systems" in sent_payload
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_tailoring.py::test_write_cover_letter_passes_jd_and_resume_context_to_the_prompt -v`
Expected: FAIL with `ImportError: cannot import name 'write_cover_letter'`

- [ ] **Step 3: Add the agent**

Add to `apps/api/app/services/tailoring.py`, after `WriterOutput` (near the other Pydantic models, around line 77):

```python
class CoverLetterOutput(BaseModel):
    """Output of the cover-letter writer agent — one prose block including
    a generic salutation and signoff, ready to render or edit as-is."""
    body: str
```

Add after `_build_agent3_system`/`_agent3_write` (after line ~529, before the prep-questions section):

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_tailoring.py::test_write_cover_letter_passes_jd_and_resume_context_to_the_prompt -v`
Expected: PASS

- [ ] **Step 5: Run the full tailoring test file to confirm no regressions**

Run: `cd apps/api && python -m pytest tests/test_tailoring.py -v`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/services/tailoring.py apps/api/tests/test_tailoring.py
git commit -m "feat: add cover letter writer AI agent"
```

---

### Task 4: PDF template + render functions

**Files:**
- Create: `apps/api/templates/cover_letter.html`
- Modify: `apps/api/app/services/pdf.py`
- Test: `apps/api/tests/test_pdf.py`

**Interfaces:**
- Consumes: `_jinja_env`, `_blocked_url_fetcher` (existing, in the same file).
- Produces: `generate_letter_pdf(contact: dict, date_str: str, body: str) -> bytes`, `upload_letter_pdf(pdf_bytes: bytes, user_id: str, cover_letter_id: str, supabase_client) -> str` — consumed by `routers/cover_letters.py` (Task 5).

- [ ] **Step 1: Write the failing test**

Check the existing pattern first:

Run: `cd apps/api && grep -n "def test_" tests/test_pdf.py | head -5`

Then add, matching that file's style (a real WeasyPrint render, not mocked — same as the existing `generate_pdf` tests in that file):

```python
def test_generate_letter_pdf_returns_pdf_bytes():
    from app.services.pdf import generate_letter_pdf

    contact = {"name": "Jane Doe", "email": "jane@example.com", "phone": "555-1234"}
    body = "Dear Hiring Manager,\n\nI am excited to apply.\n\nSincerely,\nJane Doe"

    pdf_bytes = generate_letter_pdf(contact, "January 1, 2026", body)

    assert pdf_bytes.startswith(b"%PDF")


def test_generate_letter_pdf_escapes_body_text():
    from app.services.pdf import generate_letter_pdf

    contact = {"name": "Jane Doe", "email": "jane@example.com"}
    # A literal "<script>" in body text must never reach the rendered HTML
    # unescaped — Jinja's autoescape (already enabled on _jinja_env) handles
    # this, this test just confirms the letter template doesn't opt out of it.
    body = "Dear Hiring Manager,\n\n<script>alert(1)</script>\n\nSincerely,\nJane Doe"

    pdf_bytes = generate_letter_pdf(contact, "January 1, 2026", body)

    assert pdf_bytes.startswith(b"%PDF")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_pdf.py -k letter -v`
Expected: FAIL with `ImportError: cannot import name 'generate_letter_pdf'`

- [ ] **Step 3: Write the template**

```html
<!-- apps/api/templates/cover_letter.html -->
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { size: Letter; margin: 1in; }
  body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #111; }
  .header { margin-bottom: 24px; }
  .name { font-size: 16pt; font-weight: 700; margin: 0 0 4px; }
  .contact { font-size: 9.5pt; color: #444; }
  .date { margin: 20px 0; font-size: 10.5pt; }
  .body p { margin: 0 0 14px; white-space: pre-wrap; }
</style>
</head>
<body>
  <div class="header">
    <p class="name">{{ contact.name }}</p>
    <p class="contact">
      {{ contact.email }}{% if contact.phone %} · {{ contact.phone }}{% endif %}{% if contact.location %} · {{ contact.location }}{% endif %}
    </p>
  </div>
  <p class="date">{{ date_str }}</p>
  <div class="body">
    {% for paragraph in body.split('\n\n') %}
    <p>{{ paragraph }}</p>
    {% endfor %}
  </div>
</body>
</html>
```

- [ ] **Step 4: Add the render functions**

Add to `apps/api/app/services/pdf.py`, after `count_pdf_pages` (around line 118):

```python
def _render_letter_html(contact: dict, date_str: str, body: str) -> str:
    """Render a cover letter to an HTML string. Separate from _render_html
    since letter content isn't shaped like resume_content (no experience/
    education/skills sections) and needs no photo_url sanitization — the
    letter template never renders an image."""
    template = _jinja_env.get_template("cover_letter.html")
    return template.render(contact=contact, date_str=date_str, body=body)


def generate_letter_pdf(contact: dict, date_str: str, body: str) -> bytes:
    """Render a cover letter and return PDF bytes."""
    import weasyprint  # deferred, same reason as generate_pdf

    html = _render_letter_html(contact, date_str, body)
    return weasyprint.HTML(string=html, url_fetcher=_blocked_url_fetcher).write_pdf()


async def upload_letter_pdf(
    pdf_bytes: bytes,
    user_id: str,
    cover_letter_id: str,
    supabase_client,
) -> str:
    """Upload a cover letter PDF to the same Storage bucket resumes use
    (no separate bucket provisioning needed), under its own path prefix."""
    path = f"cover-letters/{user_id}/{cover_letter_id}.pdf"
    supabase_client.storage.from_("resumes").upload(
        path,
        pdf_bytes,
        {"content-type": "application/pdf", "upsert": "true"},
    )
    return path
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_pdf.py -k letter -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/templates/cover_letter.html apps/api/app/services/pdf.py apps/api/tests/test_pdf.py
git commit -m "feat: add cover letter PDF template and render functions"
```

---

### Task 5: Cover letters router — generate, get, list, update, delete

**Files:**
- Create: `apps/api/app/routers/cover_letters.py`
- Modify: `apps/api/app/main.py`
- Test: `apps/api/tests/test_cover_letters.py`

**Interfaces:**
- Consumes: `CoverLetter` (Task 1), schemas from Task 2, `write_cover_letter`/`JDAnalysis`/`analyze_jd_match` (Task 3 + existing), `generate_letter_pdf`/`upload_letter_pdf` (Task 4).
- Produces: `router` (FastAPI `APIRouter`), registered in `main.py` — the frontend's `apiClient` (Task 8) calls these endpoints directly.

- [ ] **Step 1: Write the failing tests**

```python
# apps/api/tests/test_cover_letters.py
import time
import uuid
import jwt as pyjwt
import pytest
from datetime import datetime, timezone
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, MagicMock, patch
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


def make_mock_db():
    mock_session = MagicMock()
    mock_session.execute = AsyncMock()
    mock_session.commit = AsyncMock()
    mock_session.refresh = AsyncMock()
    mock_session.add = MagicMock()
    mock_session.delete = AsyncMock()

    async def _override():
        yield mock_session

    return _override, mock_session


@pytest.mark.asyncio
async def test_generate_creates_pending_row_and_returns_202():
    from app.db.models import Resume, JobDescription

    override, mock_session = make_mock_db()
    resume = Resume(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), title="R", content={}, template_id="ats_clean",
    )
    jd = JobDescription(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID), title="Backend Engineer", raw_text="...", parsed={},
    )
    resume_result = MagicMock()
    resume_result.scalar_one_or_none.return_value = resume
    jd_result = MagicMock()
    jd_result.scalar_one_or_none.return_value = jd
    mock_session.execute = AsyncMock(side_effect=[resume_result, jd_result])

    app.dependency_overrides[get_db] = override
    try:
        with patch("app.routers.cover_letters.get_ai_provider", return_value=MagicMock()):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(
                    "/cover-letters",
                    json={"resume_id": str(resume.id), "jd_id": str(jd.id)},
                    headers=make_auth_header(),
                )
        assert r.status_code == 202
        body = r.json()
        assert body["status"] == "pending"
        assert "cover_letter_id" in body
        mock_session.add.assert_called_once()
        added = mock_session.add.call_args.args[0]
        assert added.status == "pending"
        assert added.resume_id == resume.id
        assert added.jd_id == jd.id
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_generate_404_when_resume_or_jd_not_owned():
    override, mock_session = make_mock_db()
    empty_result = MagicMock()
    empty_result.scalar_one_or_none.return_value = None
    mock_session.execute = AsyncMock(side_effect=[empty_result, empty_result])

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.post(
                "/cover-letters",
                json={"resume_id": str(uuid.uuid4()), "jd_id": str(uuid.uuid4())},
                headers=make_auth_header(),
            )
        assert r.status_code == 404
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_get_cover_letter_returns_completed_content():
    from app.db.models import CoverLetter

    override, mock_session = make_mock_db()
    letter = CoverLetter(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID),
        resume_id=uuid.uuid4(), jd_id=uuid.uuid4(),
        content="Dear Hiring Manager,...", status="completed",
        created_at=datetime.now(timezone.utc),
    )
    result = MagicMock()
    result.scalar_one_or_none.return_value = letter
    mock_session.execute = AsyncMock(return_value=result)

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/cover-letters/{letter.id}", headers=make_auth_header())
        assert r.status_code == 200
        assert r.json()["status"] == "completed"
        assert r.json()["content"] == "Dear Hiring Manager,..."
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_get_cover_letter_404_when_not_found():
    override, mock_session = make_mock_db()
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    mock_session.execute = AsyncMock(return_value=result)

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/cover-letters/{uuid.uuid4()}", headers=make_auth_header())
        assert r.status_code == 404
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_list_cover_letters_returns_only_current_user():
    override, mock_session = make_mock_db()
    result = MagicMock()
    result.scalars.return_value.all.return_value = []
    mock_session.execute = AsyncMock(return_value=result)

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/cover-letters", headers=make_auth_header())
        assert r.status_code == 200
        assert r.json() == []
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_update_cover_letter_saves_edited_content():
    from app.db.models import CoverLetter

    override, mock_session = make_mock_db()
    letter = CoverLetter(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID),
        resume_id=uuid.uuid4(), jd_id=uuid.uuid4(),
        content="old text", status="completed",
        created_at=datetime.now(timezone.utc),
    )
    result = MagicMock()
    result.scalar_one_or_none.return_value = letter
    mock_session.execute = AsyncMock(return_value=result)

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.patch(
                f"/cover-letters/{letter.id}",
                json={"content": "edited text"},
                headers=make_auth_header(),
            )
        assert r.status_code == 200
        assert r.json()["content"] == "edited text"
        assert letter.content == "edited text"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_delete_cover_letter():
    from app.db.models import CoverLetter

    override, mock_session = make_mock_db()
    letter = CoverLetter(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID),
        resume_id=uuid.uuid4(), jd_id=uuid.uuid4(),
        created_at=datetime.now(timezone.utc),
    )
    result = MagicMock()
    result.scalar_one_or_none.return_value = letter
    mock_session.execute = AsyncMock(return_value=result)

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.delete(f"/cover-letters/{letter.id}", headers=make_auth_header())
        assert r.status_code == 204
        mock_session.delete.assert_called_once_with(letter)
    finally:
        app.dependency_overrides.pop(get_db, None)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && python -m pytest tests/test_cover_letters.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.routers.cover_letters'` (via `app.main` import failing once wired in Step 4 below; before that, `ImportError` collecting the test module itself since it patches a nonexistent module path).

- [ ] **Step 3: Write the router**

```python
# apps/api/app/routers/cover_letters.py
import logging
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db, AsyncSessionLocal
from app.db.models import Resume, JobDescription, TailoringSession, CoverLetter
from app.core.security import get_current_user
from app.core.rate_limit import limiter
from app.schemas.cover_letter import (
    CoverLetterGenerateRequest, CoverLetterStartOut, CoverLetterOut, CoverLetterUpdate,
)
from app.services.ai_engine.factory import get_ai_provider
from app.services.tailoring import write_cover_letter, analyze_jd_match, JDAnalysis

router = APIRouter(prefix="/cover-letters", tags=["cover-letters"])
logger = logging.getLogger("app")


async def _run_cover_letter_background(
    cover_letter_id: uuid.UUID,
    resume_content: dict,
    jd_text: str,
    jd_title: str,
    company_name: str | None,
    humanize_level: int,
    provider,
    cached_jd_analysis: JDAnalysis | None,
) -> None:
    """Runs letter generation off the request path — same reasoning as
    _run_tailoring_background in routers/ai.py: this chains a JD-analysis
    call (skipped if cached) and a pro-model writer call, which can exceed
    Render's ~60s proxy timeout. Uses its own DB session since the request-
    scoped one may already be closed by the time this runs."""
    async with AsyncSessionLocal() as session_db:
        try:
            match = await analyze_jd_match(
                resume_content, jd_text, provider, cached_jd_analysis=cached_jd_analysis,
            )
            result = await write_cover_letter(
                resume_content, match.jd_analysis, match.matched_skills,
                jd_title, company_name, humanize_level, provider,
            )
        except Exception:
            logger.exception("Cover letter generation failed for %s", cover_letter_id)
            row_result = await session_db.execute(
                select(CoverLetter).where(CoverLetter.id == cover_letter_id)
            )
            row = row_result.scalar_one_or_none()
            if row:
                row.status = "failed"
                await session_db.commit()
            return

        row_result = await session_db.execute(
            select(CoverLetter).where(CoverLetter.id == cover_letter_id)
        )
        row = row_result.scalar_one_or_none()
        if not row:
            return
        row.content = result.body
        row.status = "completed"
        await session_db.commit()


@router.post("", response_model=CoverLetterStartOut, status_code=202)
@limiter.limit("10/minute")
async def generate_cover_letter(
    request: Request,
    body: CoverLetterGenerateRequest,
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

    # Reuse the tailored resume content when a session is linked; otherwise
    # use the resume as saved.
    resume_content = resume_row.content
    if body.tailoring_session_id:
        session_row = (
            await db.execute(
                select(TailoringSession).where(
                    TailoringSession.id == body.tailoring_session_id,
                    TailoringSession.user_id == uid,
                )
            )
        ).scalar_one_or_none()
        if session_row and session_row.tailored_content:
            resume_content = session_row.tailored_content

    provider = get_ai_provider()

    cached_jd_analysis: JDAnalysis | None = None
    if not body.company_name:
        raw_cached = (jd_row.parsed or {}).get("agent1")
        if raw_cached:
            try:
                cached_jd_analysis = JDAnalysis(**raw_cached)
            except Exception:
                cached_jd_analysis = None

    letter = CoverLetter(
        user_id=uid,
        resume_id=body.resume_id,
        jd_id=body.jd_id,
        tailoring_session_id=body.tailoring_session_id,
        humanize_level=body.humanize_level,
        status="pending",
    )
    db.add(letter)
    await db.commit()
    await db.refresh(letter)

    background_tasks.add_task(
        _run_cover_letter_background,
        letter.id,
        resume_content,
        jd_row.raw_text,
        jd_row.title,
        body.company_name,
        body.humanize_level,
        provider,
        cached_jd_analysis,
    )

    return CoverLetterStartOut(cover_letter_id=letter.id, status="pending")


@router.get("/{cover_letter_id}", response_model=CoverLetterOut)
async def get_cover_letter(
    cover_letter_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(CoverLetter).where(
            CoverLetter.id == cover_letter_id, CoverLetter.user_id == uuid.UUID(user["sub"])
        )
    )
    letter = result.scalar_one_or_none()
    if not letter:
        raise HTTPException(status_code=404, detail="Cover letter not found")
    return letter


@router.get("", response_model=list[CoverLetterOut])
async def list_cover_letters(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(CoverLetter)
        .where(CoverLetter.user_id == uuid.UUID(user["sub"]))
        .order_by(CoverLetter.created_at.desc())
    )
    return result.scalars().all()


@router.patch("/{cover_letter_id}", response_model=CoverLetterOut)
async def update_cover_letter(
    cover_letter_id: uuid.UUID,
    body: CoverLetterUpdate,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CoverLetter).where(
            CoverLetter.id == cover_letter_id, CoverLetter.user_id == uuid.UUID(user["sub"])
        )
    )
    letter = result.scalar_one_or_none()
    if not letter:
        raise HTTPException(status_code=404, detail="Cover letter not found")
    letter.content = body.content
    await db.commit()
    await db.refresh(letter)
    return letter


@router.delete("/{cover_letter_id}", status_code=204)
async def delete_cover_letter(
    cover_letter_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(CoverLetter).where(
            CoverLetter.id == cover_letter_id, CoverLetter.user_id == uuid.UUID(user["sub"])
        )
    )
    letter = result.scalar_one_or_none()
    if not letter:
        raise HTTPException(status_code=404, detail="Cover letter not found")
    await db.delete(letter)
    await db.commit()
```

- [ ] **Step 4: Register the router**

In `apps/api/app/main.py`, change:

```python
from app.routers import resumes, jd, ai, learning, contacts
```

to:

```python
from app.routers import resumes, jd, ai, learning, contacts, cover_letters
```

and after `app.include_router(contacts.router)` add:

```python
app.include_router(cover_letters.router)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && python -m pytest tests/test_cover_letters.py -v`
Expected: all PASS

- [ ] **Step 6: Run the full backend suite to confirm no regressions**

Run: `cd apps/api && python -m pytest -q --ignore=tests/test_resume_parser_security.py`
Expected: same pass count as before plus the new tests (pre-existing unrelated failures — missing `weasyprint`/JWKS-env — are environment gaps, not regressions; confirm no *new* failures)

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/routers/cover_letters.py apps/api/app/main.py apps/api/tests/test_cover_letters.py
git commit -m "feat: add cover letters router (generate/get/list/update/delete)"
```

---

### Task 6: Cover letter PDF endpoint

**Files:**
- Modify: `apps/api/app/routers/cover_letters.py`
- Test: `apps/api/tests/test_cover_letters.py`

**Interfaces:**
- Consumes: `generate_letter_pdf`, `upload_letter_pdf` (Task 4).
- Produces: `POST /cover-letters/{id}/pdf` — consumed by `apiClient.generateCoverLetterPdf` (Task 8).

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/test_cover_letters.py`:

```python
@pytest.mark.asyncio
async def test_generate_pdf_returns_data_url_and_persists_in_background():
    import base64
    from app.db.models import CoverLetter, Resume

    class _FakeSessionContextManager:
        def __init__(self, session):
            self._session = session

        async def __aenter__(self):
            return self._session

        async def __aexit__(self, *exc_info):
            return False

    override, mock_session = make_mock_db()
    letter = CoverLetter(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID),
        resume_id=uuid.uuid4(), jd_id=uuid.uuid4(),
        content="Dear Hiring Manager,\n\nBody.\n\nSincerely,\nJane Doe",
        status="completed", created_at=datetime.now(timezone.utc),
    )
    resume = Resume(
        id=letter.resume_id, user_id=uuid.UUID(TEST_USER_ID), title="R",
        content={"contact": {"name": "Jane Doe", "email": "jane@example.com"}},
        template_id="ats_clean",
    )
    letter_result = MagicMock()
    letter_result.scalar_one_or_none.return_value = letter
    resume_result = MagicMock()
    resume_result.scalar_one_or_none.return_value = resume
    mock_session.execute = AsyncMock(side_effect=[letter_result, resume_result])

    bg_session = MagicMock()
    bg_letter_result = MagicMock()
    bg_letter_result.scalar_one_or_none.return_value = letter
    bg_session.execute = AsyncMock(return_value=bg_letter_result)
    bg_session.commit = AsyncMock()
    session_factory = MagicMock(side_effect=lambda: _FakeSessionContextManager(bg_session))

    app.dependency_overrides[get_db] = override
    try:
        with patch(
            "app.routers.cover_letters.generate_letter_pdf", return_value=b"%PDF-fake"
        ) as mock_gen, patch(
            "app.routers.cover_letters.upload_letter_pdf",
            new=AsyncMock(return_value="cover-letters/user/letter.pdf"),
        ) as mock_upload, patch(
            "app.routers.cover_letters.AsyncSessionLocal", new=session_factory
        ), patch(
            "app.routers.cover_letters._supabase", return_value=MagicMock()
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                r = await client.post(f"/cover-letters/{letter.id}/pdf", headers=make_auth_header())
        assert r.status_code == 200
        body = r.json()
        assert body["signed_url"] == "data:application/pdf;base64," + base64.b64encode(b"%PDF-fake").decode()
        mock_gen.assert_called_once()
        mock_upload.assert_called_once()
        assert letter.pdf_url == "cover-letters/user/letter.pdf"
    finally:
        app.dependency_overrides.pop(get_db, None)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_cover_letters.py::test_generate_pdf_returns_data_url_and_persists_in_background -v`
Expected: FAIL with 404 (no such route yet)

- [ ] **Step 3: Add the endpoint**

Add to `apps/api/app/routers/cover_letters.py`. First, extend the imports:

```python
import asyncio
import base64
from app.services.pdf import generate_letter_pdf, upload_letter_pdf
from supabase import create_client
from app.core.config import settings
```

Add the Supabase singleton helper (same pattern as `routers/resumes.py`) right after `logger = logging.getLogger("app")`:

```python
_sb_client = None


def _supabase():
    global _sb_client
    if _sb_client is None:
        _sb_client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    return _sb_client
```

Add the background-persist helper and endpoint at the end of the file:

```python
async def _persist_letter_pdf_to_storage(pdf_bytes: bytes, user_id: str, cover_letter_id: uuid.UUID) -> None:
    sb = _supabase()
    path = await upload_letter_pdf(pdf_bytes, user_id, str(cover_letter_id), sb)
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(CoverLetter).where(CoverLetter.id == cover_letter_id))
        letter = result.scalar_one_or_none()
        if letter:
            letter.pdf_url = path
            await session.commit()


@router.post("/{cover_letter_id}/pdf")
@limiter.limit("10/minute")
async def generate_cover_letter_pdf(
    request: Request,
    cover_letter_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    uid = uuid.UUID(user["sub"])
    letter = (
        await db.execute(
            select(CoverLetter).where(CoverLetter.id == cover_letter_id, CoverLetter.user_id == uid)
        )
    ).scalar_one_or_none()
    if not letter or not letter.content:
        raise HTTPException(status_code=404, detail="Cover letter not found or not yet generated")
    resume_row = (
        await db.execute(select(Resume).where(Resume.id == letter.resume_id, Resume.user_id == uid))
    ).scalar_one_or_none()
    contact = (resume_row.content or {}).get("contact", {}) if resume_row else {}
    date_str = datetime.now(timezone.utc).strftime("%B %-d, %Y")

    pdf_bytes = await asyncio.to_thread(generate_letter_pdf, contact, date_str, letter.content)
    background_tasks.add_task(_persist_letter_pdf_to_storage, pdf_bytes, str(uid), cover_letter_id)
    data_url = f"data:application/pdf;base64,{base64.b64encode(pdf_bytes).decode('ascii')}"
    return {"signed_url": data_url, "expires_in": None}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_cover_letters.py -v`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/routers/cover_letters.py apps/api/tests/test_cover_letters.py
git commit -m "feat: add cover letter PDF generation endpoint"
```

---

### Task 7: `GET /jd/{jd_id}/cover-letter`

**Files:**
- Modify: `apps/api/app/routers/jd.py`
- Test: `apps/api/tests/test_jd_and_tailor_endpoints.py`

**Interfaces:**
- Consumes: `CoverLetter` (Task 1).
- Produces: `GET /jd/{jd_id}/cover-letter` → `{"cover_letter_id": str|None, "status": str|None, "created_at": str|None}` — consumed by `apiClient.getJdCoverLetter` (Task 8) and the JD detail page's Cover Letter row (Task 11).

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/tests/test_jd_and_tailor_endpoints.py`, near the `GET /jd/{jd_id}/details` tests:

```python
# ── GET /jd/{jd_id}/cover-letter ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_jd_cover_letter_returns_latest():
    from app.db.models import CoverLetter

    jd_id = uuid.uuid4()
    letter = CoverLetter(
        id=uuid.uuid4(), user_id=uuid.UUID(TEST_USER_ID),
        resume_id=uuid.uuid4(), jd_id=jd_id,
        status="completed", created_at=datetime.now(timezone.utc),
    )
    override, mock_session = make_mock_db()
    result = MagicMock()
    result.scalars.return_value.first.return_value = letter
    mock_session.execute = AsyncMock(return_value=result)

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/jd/{jd_id}/cover-letter", headers=make_auth_header())
        assert r.status_code == 200
        body = r.json()
        assert body["cover_letter_id"] == str(letter.id)
        assert body["status"] == "completed"
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_get_jd_cover_letter_none_when_no_letter_yet():
    jd_id = uuid.uuid4()
    override, mock_session = make_mock_db()
    result = MagicMock()
    result.scalars.return_value.first.return_value = None
    mock_session.execute = AsyncMock(return_value=result)

    app.dependency_overrides[get_db] = override
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get(f"/jd/{jd_id}/cover-letter", headers=make_auth_header())
        assert r.status_code == 200
        assert r.json() == {"cover_letter_id": None, "status": None, "created_at": None}
    finally:
        app.dependency_overrides.pop(get_db, None)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && python -m pytest tests/test_jd_and_tailor_endpoints.py -k cover_letter -v`
Expected: FAIL with 404 (no such route yet)

- [ ] **Step 3: Add the endpoint**

In `apps/api/app/routers/jd.py`, add to the import line:

```python
from app.db.models import JobDescription, TailoringSession, PrepQuestion, CoverLetter
```

Add the endpoint after `get_jd_details` (after the existing `/{jd_id}/details` route, before `delete_jd`):

```python
@router.get("/{jd_id}/cover-letter")
async def get_jd_cover_letter(jd_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Latest cover letter for this JD, regardless of status — the JD detail
    page's "Generated for This JD" card uses this to show a pending/failed/
    completed letter, or offer to generate one if there's none yet."""
    uid = uuid.UUID(user["sub"])
    result = await db.execute(
        select(CoverLetter)
        .where(CoverLetter.jd_id == jd_id, CoverLetter.user_id == uid)
        .order_by(CoverLetter.created_at.desc())
        .limit(1)
    )
    letter = result.scalars().first()
    if not letter:
        return {"cover_letter_id": None, "status": None, "created_at": None}
    return {
        "cover_letter_id": str(letter.id),
        "status": letter.status,
        "created_at": letter.created_at.isoformat(),
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && python -m pytest tests/test_jd_and_tailor_endpoints.py -v`
Expected: all PASS (previous 19 tests + 2 new)

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/routers/jd.py apps/api/tests/test_jd_and_tailor_endpoints.py
git commit -m "feat: add GET /jd/{jd_id}/cover-letter"
```

---

### Task 8: Frontend types + api-client methods

**Files:**
- Modify: `packages/types/index.ts`
- Modify: `apps/web/lib/api-client.ts`
- Test: `apps/web/__tests__/api-client.test.ts`

**Interfaces:**
- Produces: `CoverLetter`, `CoverLetterStart`, `JDCoverLetter` types; `apiClient.generateCoverLetter`, `apiClient.getCoverLetter`, `apiClient.getCoverLetters`, `apiClient.getJdCoverLetter`, `apiClient.updateCoverLetter`, `apiClient.generateCoverLetterPdf`, `apiClient.deleteCoverLetter` — consumed by Tasks 10-11.

- [ ] **Step 1: Write the failing test**

This file mocks `global.fetch` directly per-test via `vi.stubGlobal("fetch", vi.fn())` in `beforeEach`, and has a local `jsonResponse(body, init?)` helper already defined at the top of the file (returns a fetch-shaped `Response`-like object) — reuse both exactly as the existing tests in the file do. Add:

```ts
it("generateCoverLetter POSTs to /cover-letters with the right body", async () => {
  vi.mocked(fetch).mockResolvedValue(jsonResponse({ cover_letter_id: "cl-1", status: "pending" }));

  const result = await apiClient.generateCoverLetter("resume-1", "jd-1", 60, "session-1");

  expect(result).toEqual({ cover_letter_id: "cl-1", status: "pending" });
  const [url, init] = vi.mocked(fetch).mock.calls[0];
  expect(url).toContain("/cover-letters");
  expect(init?.method).toBe("POST");
  expect(JSON.parse(init?.body as string)).toEqual({
    resume_id: "resume-1",
    jd_id: "jd-1",
    humanize_level: 60,
    tailoring_session_id: "session-1",
    company_name: undefined,
  });
});

it("getJdCoverLetter GETs /jd/{id}/cover-letter", async () => {
  vi.mocked(fetch).mockResolvedValue(jsonResponse({ cover_letter_id: null, status: null, created_at: null }));

  const result = await apiClient.getJdCoverLetter("jd-1");

  expect(result.cover_letter_id).toBeNull();
  const [url] = vi.mocked(fetch).mock.calls[0];
  expect(url).toContain("/jd/jd-1/cover-letter");
});
```

Note: `JSON.stringify` drops `undefined`-valued object keys, so the sent-body assertion for `company_name: undefined` will actually observe that key simply absent — `toEqual` treats a missing key and an explicit `undefined` value as equal, so this assertion is correct as written.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/api-client.test.ts -t "generateCoverLetter"`
Expected: FAIL — `apiClient.generateCoverLetter is not a function`

- [ ] **Step 3: Add the types**

In `packages/types/index.ts`, add after the `JDDetails` interface:

```ts
export interface CoverLetter {
  id: string;
  resume_id: string;
  jd_id: string;
  tailoring_session_id: string | null;
  content: string | null;
  humanize_level: number;
  pdf_url: string | null;
  status: "pending" | "completed" | "failed";
  created_at: string;
}

export interface CoverLetterStart {
  cover_letter_id: string;
  status: string;
}

export interface JDCoverLetter {
  cover_letter_id: string | null;
  status: string | null;
  created_at: string | null;
}
```

- [ ] **Step 4: Add the api-client methods**

In `apps/web/lib/api-client.ts`, add `CoverLetter, CoverLetterStart, JDCoverLetter` to the type import list, then add near `getJdDetails`:

```ts
generateCoverLetter: (
  resumeId: string,
  jdId: string,
  humanizeLevel: number,
  tailoringSessionId?: string,
  companyName?: string
): Promise<CoverLetterStart> =>
  request<CoverLetterStart>("POST", "/cover-letters", {
    resume_id: resumeId,
    jd_id: jdId,
    humanize_level: humanizeLevel,
    tailoring_session_id: tailoringSessionId,
    company_name: companyName,
  }),

getCoverLetter: (id: string): Promise<CoverLetter> =>
  request<CoverLetter>("GET", `/cover-letters/${id}`),

getCoverLetters: (): Promise<CoverLetter[]> =>
  request<CoverLetter[]>("GET", "/cover-letters"),

getJdCoverLetter: (jdId: string): Promise<JDCoverLetter> =>
  request<JDCoverLetter>("GET", `/jd/${jdId}/cover-letter`),

updateCoverLetter: (id: string, content: string): Promise<CoverLetter> =>
  request<CoverLetter>("PATCH", `/cover-letters/${id}`, { content }),

generateCoverLetterPdf: (id: string): Promise<{ signed_url: string }> =>
  request<{ signed_url: string }>("POST", `/cover-letters/${id}/pdf`),

deleteCoverLetter: (id: string): Promise<void> =>
  request<void>("DELETE", `/cover-letters/${id}`),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/api-client.test.ts`
Expected: all PASS

- [ ] **Step 6: Type-check**

Run: `cd apps/web && npx tsc --noEmit -p .`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add packages/types/index.ts apps/web/lib/api-client.ts apps/web/__tests__/api-client.test.ts
git commit -m "feat: add cover letter types and api-client methods"
```

---

### Task 9: Generalize `HumanizeSlider` to props

**Files:**
- Modify: `apps/web/components/resume/HumanizeSlider.tsx`
- Modify: `apps/web/components/resume/EditorPanel.tsx`

**Interfaces:**
- Produces: `HumanizeSlider({ value: number; onChange: (n: number) => void })` — consumed by `EditorPanel.tsx` (updated in this task) and the cover letter editor page (Task 11).

- [ ] **Step 1: Confirm no dedicated test exists to update**

Run: `cd apps/web && find __tests__ -iname "*humanize*"`
Expected: no output — no dedicated test file references this component by name (confirmed during planning; `EditorPanel.test.tsx` doesn't touch it directly either).

- [ ] **Step 2: Generalize the component**

Replace the contents of `apps/web/components/resume/HumanizeSlider.tsx`:

```tsx
"use client";
import * as RadixSlider from "@radix-ui/react-slider";

export function HumanizeSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex flex-col gap-sm">
      <div className="flex justify-between items-center">
        <span className="text-label-md text-on-surface-variant">Humanize Level</span>
        <span className="text-label-md text-primary font-bold">{value}</span>
      </div>
      <div className="flex items-center justify-between text-caption text-on-surface-variant mb-xs">
        <span>Natural</span>
        <span>ATS Max</span>
      </div>
      <RadixSlider.Root
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        min={0}
        max={100}
        step={5}
        className="relative flex items-center w-full h-5"
      >
        <RadixSlider.Track className="bg-surface-variant relative grow rounded-full h-2">
          <RadixSlider.Range className="absolute bg-primary rounded-full h-full" />
        </RadixSlider.Track>
        <RadixSlider.Thumb className="block w-5 h-5 bg-primary rounded-full shadow-md focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer" />
      </RadixSlider.Root>
    </div>
  );
}
```

- [ ] **Step 3: Update both existing call sites**

`apps/web/components/resume/EditorPanel.tsx` has TWO usages of `<HumanizeSlider />` in two different components in the same file — `EditorPanel` itself (line ~724) and a separate prop-driven subcomponent `TailoringForm` (line ~890), which currently has no `humanizeLevel`/`setHumanizeLevel` in scope at all (it relied on `HumanizeSlider` reading the store internally). All of the following edits are in this one file.

3a. `EditorPanel`'s own `useTailoringStore()` destructure (around line 37) currently reads:

```tsx
  const {
    jdText, setJd,
    jdId,
    companyName, setCompanyName,
    atsScore, matchedSkills, missingSkills,
    prioritySkills, togglePrioritySkill,
    runTailoring, isLoading, error: tailoringError,
    pendingContent,
  } = useTailoringStore();
```

Add `humanizeLevel, setHumanizeLevel`:

```tsx
  const {
    jdText, setJd,
    jdId,
    companyName, setCompanyName,
    atsScore, matchedSkills, missingSkills,
    prioritySkills, togglePrioritySkill,
    runTailoring, isLoading, error: tailoringError,
    pendingContent,
    humanizeLevel, setHumanizeLevel,
  } = useTailoringStore();
```

3b. `EditorPanel`'s own inline usage (around line 724, inside its main render, right after the JD-context textarea):

```tsx
              <HumanizeSlider />
```

becomes:

```tsx
              <HumanizeSlider value={humanizeLevel} onChange={setHumanizeLevel} />
```

3c. The `<TailoringForm ... />` call site (around line 672) currently passes:

```tsx
            <TailoringForm
              jdText={jdText}
              companyName={companyName}
              setCompanyName={setCompanyName}
              atsScore={atsScore}
              matchedSkills={matchedSkills}
              missingSkills={missingSkills}
              prioritySkills={prioritySkills}
              togglePrioritySkill={togglePrioritySkill}
              isLoading={isLoading}
              error={tailoringError}
              onTailor={() => resumeId && runTailoring(resumeId)}
              resumeId={resumeId}
```

Add two more props:

```tsx
            <TailoringForm
              jdText={jdText}
              companyName={companyName}
              setCompanyName={setCompanyName}
              atsScore={atsScore}
              matchedSkills={matchedSkills}
              missingSkills={missingSkills}
              prioritySkills={prioritySkills}
              togglePrioritySkill={togglePrioritySkill}
              isLoading={isLoading}
              error={tailoringError}
              onTailor={() => resumeId && runTailoring(resumeId)}
              resumeId={resumeId}
              humanizeLevel={humanizeLevel}
              setHumanizeLevel={setHumanizeLevel}
```

(leave the closing `/>` and everything after it as-is — this only adds two new prop lines before it.)

3d. `TailoringForm`'s own props destructure and type block (around line 762) currently reads:

```tsx
function TailoringForm({
  jdText,
  companyName,
  setCompanyName,
  atsScore,
  matchedSkills,
  missingSkills,
  prioritySkills,
  togglePrioritySkill,
  isLoading,
  error,
  onTailor,
  resumeId,
}: {
  jdText: string;
  companyName: string;
  setCompanyName: (v: string) => void;
  atsScore: number | null;
  matchedSkills: string[];
  missingSkills: string[];
  prioritySkills: string[];
  togglePrioritySkill: (skill: string) => void;
  isLoading: boolean;
  error: string | null;
  onTailor: () => void;
  resumeId: string | null;
}) {
```

Add `humanizeLevel`/`setHumanizeLevel` to both the destructure and the type:

```tsx
function TailoringForm({
  jdText,
  companyName,
  setCompanyName,
  atsScore,
  matchedSkills,
  missingSkills,
  prioritySkills,
  togglePrioritySkill,
  isLoading,
  error,
  onTailor,
  resumeId,
  humanizeLevel,
  setHumanizeLevel,
}: {
  jdText: string;
  companyName: string;
  setCompanyName: (v: string) => void;
  atsScore: number | null;
  matchedSkills: string[];
  missingSkills: string[];
  prioritySkills: string[];
  togglePrioritySkill: (skill: string) => void;
  isLoading: boolean;
  error: string | null;
  onTailor: () => void;
  resumeId: string | null;
  humanizeLevel: number;
  setHumanizeLevel: (n: number) => void;
}) {
```

3e. `TailoringForm`'s own inline usage (around line 890, in the "Humanize slider" comment block):

```tsx
      {/* Humanize slider */}
      <HumanizeSlider />
```

becomes:

```tsx
      {/* Humanize slider */}
      <HumanizeSlider value={humanizeLevel} onChange={setHumanizeLevel} />
```

- [ ] **Step 4: Type-check and run EditorPanel tests**

Run: `cd apps/web && npx tsc --noEmit -p . && npx vitest run __tests__/components/EditorPanel.test.tsx`
Expected: no type errors, all 19 tests still PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/resume/HumanizeSlider.tsx apps/web/components/resume/EditorPanel.tsx
git commit -m "refactor: generalize HumanizeSlider to value/onChange props"
```

---

### Task 10: Cover letters list + standalone create page

**Files:**
- Modify: `apps/web/app/(app)/cover-letters/page.tsx` (replaces the placeholder from the earlier sidebar-tab commit)
- Test: `apps/web/__tests__/cover-letter-list-page.test.tsx`

**Interfaces:**
- Consumes: `apiClient.getCoverLetters`, `apiClient.generateCoverLetter`, `apiClient.getResumes`, `apiClient.getJds` (existing + Task 8).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/__tests__/cover-letter-list-page.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getCoverLetters: vi.fn().mockResolvedValue([]),
    getResumes: vi.fn().mockResolvedValue([
      { id: "resume-1", user_id: "u1", title: "Master Resume", template_id: "ats_clean", content: {}, created_at: "", updated_at: "" },
    ]),
    getJds: vi.fn().mockResolvedValue([
      { id: "jd-1", user_id: "u1", title: "Backend Engineer", raw_text: "...", parsed_skills: [], status: "not_applied", created_at: "" },
    ]),
    generateCoverLetter: vi.fn(),
  },
}));

import CoverLettersPage from "../app/(app)/cover-letters/page";
import { apiClient } from "../lib/api-client";

function renderWithQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("CoverLettersPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("generates a cover letter from the selected resume and JD, then navigates to it", async () => {
    vi.mocked(apiClient.generateCoverLetter).mockResolvedValue({ cover_letter_id: "cl-1", status: "pending" });

    renderWithQueryClient(<CoverLettersPage />);

    await userEvent.selectOptions(await screen.findByLabelText("Resume"), "resume-1");
    await userEvent.selectOptions(screen.getByLabelText("Job Description"), "jd-1");
    await userEvent.click(screen.getByText("Generate Cover Letter"));

    await waitFor(() =>
      expect(apiClient.generateCoverLetter).toHaveBeenCalledWith("resume-1", "jd-1", 50, undefined, undefined)
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/cover-letters/cl-1"));
  });

  it("shows an empty state when there are no saved cover letters yet", async () => {
    renderWithQueryClient(<CoverLettersPage />);
    expect(await screen.findByText(/No cover letters yet/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/cover-letter-list-page.test.tsx`
Expected: FAIL — placeholder page has no form/selects to interact with.

- [ ] **Step 3: Write the page**

Replace `apps/web/app/(app)/cover-letters/page.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { EnvelopeSimple, Sparkle } from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import { Card } from "@/components/ui/Card";
import type { CoverLetter, Resume, JobDescription } from "@career-copilot/types";

export default function CoverLettersPage() {
  const router = useRouter();
  const [resumeId, setResumeId] = useState("");
  const [jdId, setJdId] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: letters = [] } = useQuery<CoverLetter[]>({
    queryKey: ["coverLetters"],
    queryFn: () => apiClient.getCoverLetters(),
  });
  const { data: resumes = [] } = useQuery<Resume[]>({
    queryKey: ["resumes"],
    queryFn: () => apiClient.getResumes(),
  });
  const { data: jds = [] } = useQuery<JobDescription[]>({
    queryKey: ["jds"],
    queryFn: () => apiClient.getJds(),
  });

  async function handleGenerate() {
    if (!resumeId || !jdId) return;
    setIsGenerating(true);
    setError(null);
    try {
      const { cover_letter_id } = await apiClient.generateCoverLetter(resumeId, jdId, 50, undefined, undefined);
      router.push(`/cover-letters/${cover_letter_id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to generate cover letter");
      setIsGenerating(false);
    }
  }

  return (
    <div className="max-w-[1440px] mx-auto p-gutter pb-xxl flex flex-col gap-xl">
      <section className="pb-md">
        <h1 className="text-headline-xl text-on-surface mb-xs font-bold" style={{ letterSpacing: "-0.02em" }}>
          Cover Letters
        </h1>
        <p className="text-body-lg text-on-surface-variant">
          Generate a cover letter from any resume and job description, edit it, and export it as a PDF.
        </p>
      </section>

      <Card className="flex flex-col gap-md">
        <h2 className="text-headline-md text-on-surface font-semibold">New Cover Letter</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-md">
          <div className="flex flex-col gap-xs">
            <label htmlFor="resume-select" className="text-label-sm text-on-surface-variant font-semibold">Resume</label>
            <select
              id="resume-select"
              value={resumeId}
              onChange={(e) => setResumeId(e.target.value)}
              className="w-full px-sm py-xs rounded-lg text-body-sm bg-surface-container border border-outline-variant/30 text-on-surface cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">Select a resume…</option>
              {resumes.map((r) => (
                <option key={r.id} value={r.id}>{r.title}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-xs">
            <label htmlFor="jd-select" className="text-label-sm text-on-surface-variant font-semibold">Job Description</label>
            <select
              id="jd-select"
              value={jdId}
              onChange={(e) => setJdId(e.target.value)}
              className="w-full px-sm py-xs rounded-lg text-body-sm bg-surface-container border border-outline-variant/30 text-on-surface cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">Select a job description…</option>
              {jds.map((jd) => (
                <option key={jd.id} value={jd.id}>{jd.title}</option>
              ))}
            </select>
          </div>
        </div>
        {error && <p className="text-caption text-error">{error}</p>}
        <button
          onClick={handleGenerate}
          disabled={!resumeId || !jdId || isGenerating}
          className="self-start flex items-center gap-xs px-lg py-sm rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Sparkle size={16} className={isGenerating ? "animate-pulse" : ""} />
          {isGenerating ? "Generating…" : "Generate Cover Letter"}
        </button>
      </Card>

      {letters.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-md py-xxl text-center">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            <EnvelopeSimple size={28} className="text-primary" />
          </div>
          <p className="text-body-md text-on-surface font-medium">No cover letters yet</p>
          <p className="text-body-sm text-on-surface-variant">Pick a resume and job description above to generate your first one.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-md">
          {letters.map((letter) => (
            <button
              key={letter.id}
              onClick={() => router.push(`/cover-letters/${letter.id}`)}
              className="text-left p-md rounded-xl border border-outline-variant/20 hover:border-primary/40 hover:bg-surface-container transition-all"
            >
              <p className="text-label-md text-on-surface font-semibold">
                {letter.status === "pending" ? "Generating…" : letter.status === "failed" ? "Generation failed" : "Cover Letter"}
              </p>
              <p className="text-caption text-on-surface-variant mt-xs">
                {new Date(letter.created_at).toLocaleDateString()}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/cover-letter-list-page.test.tsx`
Expected: all PASS

- [ ] **Step 5: Type-check**

Run: `cd apps/web && npx tsc --noEmit -p .`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(app)/cover-letters/page.tsx" apps/web/__tests__/cover-letter-list-page.test.tsx
git commit -m "feat: replace cover letters placeholder with list + standalone create"
```

---

### Task 11: Cover letter editor page

**Files:**
- Create: `apps/web/app/(app)/cover-letters/[id]/page.tsx`
- Test: `apps/web/__tests__/cover-letter-editor-page.test.tsx`

**Interfaces:**
- Consumes: `apiClient.getCoverLetter`, `apiClient.updateCoverLetter`, `apiClient.generateCoverLetterPdf`, `apiClient.generateCoverLetter` (regenerate), `HumanizeSlider` (Task 9).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/__tests__/cover-letter-editor-page.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getCoverLetter: vi.fn(),
    updateCoverLetter: vi.fn(),
    generateCoverLetterPdf: vi.fn(),
    generateCoverLetter: vi.fn(),
  },
}));

import CoverLetterEditorPage from "../app/(app)/cover-letters/[id]/page";
import { apiClient } from "../lib/api-client";

async function renderWithQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  });
  return result;
}

describe("CoverLetterEditorPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a generating state while status is pending, then the editable content once completed", async () => {
    vi.mocked(apiClient.getCoverLetter)
      .mockResolvedValueOnce({
        id: "cl-1", resume_id: "r1", jd_id: "jd1", tailoring_session_id: null,
        content: null, humanize_level: 50, pdf_url: null, status: "pending", created_at: "2026-01-01T00:00:00Z",
      })
      .mockResolvedValueOnce({
        id: "cl-1", resume_id: "r1", jd_id: "jd1", tailoring_session_id: null,
        content: "Dear Hiring Manager,\n\nBody text.\n\nSincerely,\nJane Doe",
        humanize_level: 50, pdf_url: null, status: "completed", created_at: "2026-01-01T00:00:00Z",
      });

    await renderWithQueryClient(<CoverLetterEditorPage params={Promise.resolve({ id: "cl-1" })} />);

    expect(await screen.findByText(/Generating your cover letter/)).toBeInTheDocument();
    expect(await screen.findByDisplayValue(/Dear Hiring Manager/)).toBeInTheDocument();
  });

  it("saves edits via updateCoverLetter", async () => {
    vi.mocked(apiClient.getCoverLetter).mockResolvedValue({
      id: "cl-1", resume_id: "r1", jd_id: "jd1", tailoring_session_id: null,
      content: "Original body", humanize_level: 50, pdf_url: null, status: "completed", created_at: "2026-01-01T00:00:00Z",
    });
    vi.mocked(apiClient.updateCoverLetter).mockResolvedValue({
      id: "cl-1", resume_id: "r1", jd_id: "jd1", tailoring_session_id: null,
      content: "Edited body", humanize_level: 50, pdf_url: null, status: "completed", created_at: "2026-01-01T00:00:00Z",
    });

    await renderWithQueryClient(<CoverLetterEditorPage params={Promise.resolve({ id: "cl-1" })} />);

    const textarea = await screen.findByDisplayValue("Original body");
    await userEvent.clear(textarea);
    await userEvent.type(textarea, "Edited body");
    await userEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(apiClient.updateCoverLetter).toHaveBeenCalledWith("cl-1", "Edited body"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/cover-letter-editor-page.test.tsx`
Expected: FAIL — `Cannot find module '../app/(app)/cover-letters/[id]/page'`

- [ ] **Step 3: Write the page**

```tsx
// apps/web/app/(app)/cover-letters/[id]/page.tsx
"use client";
import { use, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadSimple, Copy, FloppyDisk, Sparkle } from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import { Card } from "@/components/ui/Card";
import { HumanizeSlider } from "@/components/resume/HumanizeSlider";
import type { CoverLetter } from "@career-copilot/types";

export default function CoverLetterEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: letter } = useQuery<CoverLetter>({
    queryKey: ["coverLetter", id],
    queryFn: () => apiClient.getCoverLetter(id),
    // Poll while generation is in flight; stop once it lands on a terminal status.
    refetchInterval: (query) => (query.state.data?.status === "pending" ? 3000 : false),
  });

  // Seed the draft from the fetched content exactly once it arrives — never
  // re-seed on a later refetch (that would blow away unsaved edits). Tracks
  // by id so navigating from one letter to another does re-seed.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  useEffect(() => {
    if (letter?.status === "completed" && letter.content !== null && seededFor !== id) {
      setDraft(letter.content);
      setSeededFor(id);
    }
  }, [letter, id, seededFor]);

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      await apiClient.updateCoverLetter(id, draft);
      queryClient.invalidateQueries({ queryKey: ["coverLetter", id] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRegenerate(nextHumanizeLevel: number) {
    if (!letter) return;
    setIsRegenerating(true);
    setError(null);
    try {
      await apiClient.generateCoverLetter(
        letter.resume_id, letter.jd_id, nextHumanizeLevel, letter.tailoring_session_id ?? undefined
      );
      // Regeneration creates a new row; simplest correct behavior for v1 is
      // to just re-fetch this one's fields won't change — a full rebuild UX
      // (navigating to the new id) is a follow-up, not required for save/
      // edit/export to work correctly here.
      queryClient.invalidateQueries({ queryKey: ["coverLetter", id] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to regenerate");
    } finally {
      setIsRegenerating(false);
    }
  }

  async function handleExportPdf() {
    setIsExporting(true);
    setError(null);
    try {
      const { signed_url } = await apiClient.generateCoverLetterPdf(id);
      const response = await fetch(signed_url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = "cover-letter.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to export PDF");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!letter || letter.status === "pending") {
    return (
      <div className="max-w-[900px] mx-auto p-gutter pb-xxl flex flex-col items-center justify-center gap-md py-xxl text-center">
        <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
        <p className="text-body-md text-on-surface-variant">Generating your cover letter…</p>
      </div>
    );
  }

  if (letter.status === "failed") {
    return (
      <div className="max-w-[900px] mx-auto p-gutter pb-xxl flex flex-col items-center justify-center gap-md py-xxl text-center">
        <p className="text-body-md text-error font-medium">Generation failed. Try regenerating from the Cover Letters list.</p>
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto p-gutter pb-xxl flex flex-col gap-xl">
      <section className="pb-md">
        <h1 className="text-headline-xl text-on-surface mb-xs font-bold" style={{ letterSpacing: "-0.02em" }}>
          Cover Letter
        </h1>
      </section>

      <Card className="flex flex-col gap-md">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={16}
          className="w-full px-md py-sm rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-on-surface text-body-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
        />
        <HumanizeSlider value={letter.humanize_level} onChange={handleRegenerate} />
        {error && <p className="text-caption text-error">{error}</p>}
        <div className="flex flex-wrap gap-sm">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-xs px-md py-sm rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-md hover:shadow-lg transition-all disabled:opacity-50"
          >
            <FloppyDisk size={16} />
            {isSaving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={handleExportPdf}
            disabled={isExporting}
            className="flex items-center gap-xs px-md py-sm rounded-xl text-label-md text-on-surface border border-outline-variant/40 hover:bg-surface-container transition-all disabled:opacity-50"
          >
            <DownloadSimple size={16} />
            {isExporting ? "Exporting…" : "Download PDF"}
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-xs px-md py-sm rounded-xl text-label-md text-on-surface border border-outline-variant/40 hover:bg-surface-container transition-all"
          >
            <Copy size={16} />
            {copied ? "Copied!" : "Copy Text"}
          </button>
          <button
            onClick={() => handleRegenerate(letter.humanize_level)}
            disabled={isRegenerating}
            className="flex items-center gap-xs px-md py-sm rounded-xl text-label-md text-primary border border-primary/30 hover:bg-primary/5 transition-all disabled:opacity-50"
          >
            <Sparkle size={16} className={isRegenerating ? "animate-pulse" : ""} />
            {isRegenerating ? "Regenerating…" : "Regenerate"}
          </button>
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/cover-letter-editor-page.test.tsx`
Expected: all PASS

- [ ] **Step 5: Type-check**

Run: `cd apps/web && npx tsc --noEmit -p .`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(app)/cover-letters/[id]/page.tsx" apps/web/__tests__/cover-letter-editor-page.test.tsx
git commit -m "feat: add cover letter editor page (edit/save/export/regenerate)"
```

---

### Task 12: JD detail page — Cover Letter row

**Files:**
- Modify: `apps/web/app/(app)/jd/[jdId]/page.tsx`
- Test: `apps/web/__tests__/jd-detail-page.test.tsx`

**Interfaces:**
- Consumes: `apiClient.getJdCoverLetter`, `apiClient.generateCoverLetter` (Task 8).

- [ ] **Step 1: Write the failing test**

Add to `apps/web/__tests__/jd-detail-page.test.tsx`. First extend the `apiClient` mock at the top of the file to include `getJdCoverLetter` and `generateCoverLetter`:

```ts
getJdCoverLetter: vi.fn().mockResolvedValue({ cover_letter_id: null, status: null, created_at: null }),
generateCoverLetter: vi.fn(),
```

Then add a new `describe` block:

```tsx
describe("JDPage — Cover Letter row", () => {
  beforeEach(() => {
    useTailoringStore.getState().resetStore();
    useResumeStore.getState().resetStore();
    vi.clearAllMocks();
    vi.mocked(apiClient.getJd).mockResolvedValue(JD as any);
    vi.mocked(apiClient.getResumes).mockResolvedValue([RESUME] as any);
    vi.mocked(apiClient.getJdDetails).mockResolvedValue({ session_id: null } as any);
    vi.mocked(apiClient.analyzeJd).mockResolvedValue({
      ats_score: 70, matched_skills: [], missing_skills: [], company_keywords: [],
    });
  });

  it("offers to generate a cover letter when none exists yet", async () => {
    vi.mocked(apiClient.getJdCoverLetter).mockResolvedValue({ cover_letter_id: null, status: null, created_at: null });
    vi.mocked(apiClient.generateCoverLetter).mockResolvedValue({ cover_letter_id: "cl-1", status: "pending" });

    await renderWithQueryClient(<JDPage params={Promise.resolve({ jdId: "jd-1" })} />);

    await userEvent.click(await screen.findByText("Generate"));

    await waitFor(() => expect(apiClient.generateCoverLetter).toHaveBeenCalledWith("resume-1", "jd-1", 50));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/cover-letters/cl-1"));
  });

  it("offers to open an existing completed cover letter", async () => {
    vi.mocked(apiClient.getJdCoverLetter).mockResolvedValue({
      cover_letter_id: "cl-2", status: "completed", created_at: "2026-01-01T00:00:00Z",
    });

    await renderWithQueryClient(<JDPage params={Promise.resolve({ jdId: "jd-1" })} />);

    await userEvent.click(await screen.findByText("Open Letter"));
    expect(mockPush).toHaveBeenCalledWith("/cover-letters/cl-2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/jd-detail-page.test.tsx -t "Cover Letter row"`
Expected: FAIL — `Unable to find an element with the text: Generate`

- [ ] **Step 3: Add the row**

In `apps/web/app/(app)/jd/[jdId]/page.tsx`, the current top-of-file imports (lines 10-21) read:

```tsx
import type { AnalyzeOut, JobDescription, Resume, JDDetails } from "@career-copilot/types";
import {
  CheckCircle,
  WarningCircle,
  ArrowLeft,
  Sparkle,
  ArrowCounterClockwise,
  FolderOpen,
  Target,
  FileText,
  Microphone,
} from "@phosphor-icons/react";
```

Replace with:

```tsx
import type { AnalyzeOut, JobDescription, Resume, JDDetails, JDCoverLetter } from "@career-copilot/types";
import {
  CheckCircle,
  WarningCircle,
  ArrowLeft,
  Sparkle,
  ArrowCounterClockwise,
  FolderOpen,
  Target,
  FileText,
  Microphone,
  EnvelopeSimple,
} from "@phosphor-icons/react";
```

The existing `jdDetails` query (lines 52-58) reads:

```tsx
  // Everything already generated for this JD — the latest tailored resume
  // and its interview prep progress — so this page can show that work
  // instead of only ever offering to start it over.
  const { data: jdDetails } = useQuery<JDDetails>({
    queryKey: ["jdDetails", jdId],
    queryFn: () => apiClient.getJdDetails(jdId),
  });
```

Immediately after it (still before the `// Only show the master resume...` comment that follows), add:

```tsx
  const [isGeneratingLetter, setIsGeneratingLetter] = useState(false);
  const [letterError, setLetterError] = useState<string | null>(null);

  const { data: coverLetter } = useQuery<JDCoverLetter>({
    queryKey: ["jdCoverLetter", jdId],
    queryFn: () => apiClient.getJdCoverLetter(jdId),
  });

  async function handleGenerateCoverLetter() {
    if (!masterResume) return;
    setIsGeneratingLetter(true);
    setLetterError(null);
    try {
      const { cover_letter_id } = await apiClient.generateCoverLetter(masterResume.id, jdId, 50);
      router.push(`/cover-letters/${cover_letter_id}`);
    } catch (e: unknown) {
      setLetterError(e instanceof Error ? e.message : "Failed to generate cover letter");
      setIsGeneratingLetter(false);
    }
  }
```

(this new block sits between the `jdDetails` query above and the `// Only show the master resume...` comment/`masterResume` computation that already follows it in the file)

The "Generated for This JD" `<Card>` currently ends like this (the `{!jdDetails?.session_id ? (...) : (...)}` ternary is the ENTIRE content of the card besides the `<h2>`):

```tsx
              </div>
            </div>
          )}
        </Card>

        {/* Raw JD text preview — full width */}
```

The Cover Letter row must be unconditional — shown whether or not a tailoring session exists yet (a letter can be generated standalone). Insert it as a new sibling AFTER the closing `)}` of that ternary and BEFORE the `</Card>`, replacing the snippet above with:

```tsx
              </div>
            </div>
          )}

          {/* Cover letter — unconditional, unlike the two rows above: a
              letter can be generated standalone before any tailoring
              session exists for this JD. */}
          <div className="flex items-center gap-md px-md py-sm rounded-xl border border-outline-variant/20 bg-surface-container/40">
            <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <EnvelopeSimple size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-label-md text-on-surface font-semibold">Cover Letter</p>
              <p className="text-caption text-on-surface-variant">
                {coverLetter?.status === "completed"
                  ? `Generated ${coverLetter.created_at ? new Date(coverLetter.created_at).toLocaleDateString() : ""}`
                  : coverLetter?.status === "pending"
                  ? "Generating…"
                  : coverLetter?.status === "failed"
                  ? "Generation failed — try again"
                  : "Not generated yet"}
              </p>
            </div>
            {coverLetter?.status === "completed" && coverLetter.cover_letter_id ? (
              <button
                onClick={() => router.push(`/cover-letters/${coverLetter.cover_letter_id}`)}
                className="shrink-0 flex items-center gap-xs px-sm py-xs rounded-lg text-label-sm text-primary border border-primary/30 hover:bg-primary/5 transition-all"
              >
                <FolderOpen size={14} />
                Open Letter
              </button>
            ) : (
              <button
                onClick={handleGenerateCoverLetter}
                disabled={isGeneratingLetter || !masterResume}
                className="shrink-0 flex items-center gap-xs px-sm py-xs rounded-lg text-label-sm text-primary border border-primary/30 hover:bg-primary/5 transition-all disabled:opacity-50"
              >
                <Sparkle size={14} className={isGeneratingLetter ? "animate-pulse" : ""} />
                {isGeneratingLetter ? "Generating…" : "Generate"}
              </button>
            )}
          </div>
          {letterError && <p className="text-caption text-error">{letterError}</p>}
        </Card>

        {/* Raw JD text preview — full width */}
```

Note the indentation matches the surrounding JSX (this content sits directly inside the `<Card className="lg:col-span-2 flex flex-col gap-md">`, as a sibling to the `{!jdDetails?.session_id ? (...) : (...)}` block, not nested inside either of its branches) — the `</Card>` and the "Raw JD text preview" comment that follow are the same ones already in the file; this replacement just inserts the new block between the ternary's closing `)}` and `</Card>`.

This row is unconditional (shown regardless of `jdDetails?.session_id`, unlike the Resume/Interview rows) — a cover letter can be generated standalone even before any tailoring session exists. Place it as a sibling to the existing `{!jdDetails?.session_id ? (...) : (...)}` conditional inside the "Generated for This JD" `<Card>`, not nested inside either branch.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/jd-detail-page.test.tsx`
Expected: all PASS (previous 2 tests + 2 new)

- [ ] **Step 5: Type-check**

Run: `cd apps/web && npx tsc --noEmit -p .`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(app)/jd/[jdId]/page.tsx" apps/web/__tests__/jd-detail-page.test.tsx
git commit -m "feat: surface Cover Letter generation on the JD detail page"
```

---

### Task 13: Full-suite verification and push

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend suite**

Run: `cd apps/api && python -m pytest -q --ignore=tests/test_resume_parser_security.py`
Expected: all pass except the two pre-existing environment-only failures already present before this feature (`test_experienced_professional_profile`, `test_many_projects_and_certifications_get_capped` — missing `weasyprint`) and the JWKS error (`test_es256_token_verified_via_jwks`). No *new* failures.

- [ ] **Step 2: Run the full frontend suite**

Run: `cd apps/web && npx vitest run`
Expected: all pass, no new failures.

- [ ] **Step 3: Type-check the whole frontend**

Run: `cd apps/web && npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 4: Apply the migration if not already applied in Task 1**

Run: `cd apps/api && source .venv/Scripts/activate && alembic current`
Expected: shows `008` as the current head. If not, run `alembic upgrade head`.

- [ ] **Step 5: Push**

```bash
git push origin main
```

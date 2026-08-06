# Career Copilot — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the FastAPI backend with AI engine, ATS scoring, tailoring pipeline, PDF generation, and all REST endpoints.

**Architecture:** FastAPI app with SQLAlchemy + Alembic for PostgreSQL, a swappable AI provider abstraction (Gemini/OpenAI), WeasyPrint for server-side PDF generation, and Supabase Storage for PDF persistence. Supabase Auth JWTs are verified on every request via a shared secret.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2, WeasyPrint, google-generativeai, openai, supabase-py, pytest, httpx

## Global Constraints

- Python 3.11+ required
- All endpoints require `Authorization: Bearer <supabase_jwt>` — no public endpoints except health check
- All AI structured outputs use Pydantic model enforcement — no free-form JSON parsing
- Steps A+B of tailoring pipeline use fast model; Steps C+D use pro model
- PDF storage path format: `resumes/{user_id}/{resume_id}.pdf` — never store signed URLs in DB
- `AI_PROVIDER` env var is `gemini` (default) or `openai` — no other values accepted
- No custom JWT signing — Supabase JWT secret verification only

---

## File Map

```
apps/api/
├── app/
│   ├── main.py                        ← FastAPI app, CORS, router includes
│   ├── core/
│   │   ├── config.py                  ← Settings via pydantic-settings
│   │   └── security.py                ← JWT verification, get_current_user dep
│   ├── db/
│   │   ├── models.py                  ← SQLAlchemy ORM: Profile, Resume, JobDescription, TailoringSession, PrepQuestion
│   │   └── session.py                 ← async engine, get_db dependency
│   ├── schemas/
│   │   ├── resume.py                  ← ResumeCreate, ResumeUpdate, ResumeOut
│   │   ├── jd.py                      ← JDCreate, JDOut, ParsedJD
│   │   └── ai.py                      ← TailorRequest, TailorOut, PrepQuestionOut
│   ├── routers/
│   │   ├── resumes.py                 ← GET/POST/PATCH/DELETE /resumes
│   │   ├── jd.py                      ← POST /jd, GET /jd/{id}
│   │   └── ai.py                      ← POST /ai/tailor, POST /resumes/{id}/pdf
│   └── services/
│       ├── ai_engine/
│       │   ├── base.py                ← AIProvider ABC
│       │   ├── gemini_provider.py     ← GeminiProvider
│       │   ├── openai_provider.py     ← OpenAIProvider
│       │   └── factory.py             ← get_ai_provider()
│       ├── ats.py                     ← compute_delta(), ats_score()
│       ├── tailoring.py               ← extract_jd_skills(), rewrite_bullets(), generate_prep_questions()
│       └── pdf.py                     ← generate_pdf(), upload_to_storage(), get_signed_url()
├── alembic/
│   ├── env.py
│   └── versions/
│       └── 001_initial_schema.py
├── tests/
│   ├── conftest.py                    ← pytest fixtures, test DB, test client
│   ├── test_security.py
│   ├── test_ats.py
│   ├── test_tailoring.py
│   ├── test_pdf.py
│   └── test_routers.py
├── templates/
│   ├── ats_clean.html                 ← Jinja2 resume template (minimal)
│   └── ats_modern.html                ← Jinja2 resume template (styled)
├── alembic.ini
├── requirements.txt
└── .env.example
```

---

### Task 1: Project scaffold + config + security

**Files:**
- Create: `apps/api/requirements.txt`
- Create: `apps/api/.env.example`
- Create: `apps/api/app/core/config.py`
- Create: `apps/api/app/core/security.py`
- Create: `apps/api/app/main.py`
- Create: `apps/api/tests/conftest.py`
- Test: `apps/api/tests/test_security.py`

**Interfaces:**
- Produces: `get_current_user(token) -> dict` — FastAPI dependency used by all routers
- Produces: `settings` — singleton Settings object imported by all modules

- [ ] **Step 1: Create requirements.txt**

```
fastapi==0.111.0
uvicorn[standard]==0.30.1
sqlalchemy==2.0.30
asyncpg==0.29.0
alembic==1.13.1
pydantic-settings==2.3.0
python-jose[cryptography]==3.3.0
httpx==0.27.0
google-generativeai==0.7.2
openai==1.35.0
supabase==2.5.0
weasyprint==62.3
jinja2==3.1.4
pytest==8.2.2
pytest-asyncio==0.23.7
pytest-httpx==0.30.0
python-multipart==0.0.9
```

- [ ] **Step 2: Create .env.example**

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=
DATABASE_URL=postgresql+asyncpg://postgres:password@db.supabase.co:5432/postgres
AI_PROVIDER=gemini
AI_MODEL_FAST=gemini-2.5-flash
AI_MODEL_PRO=gemini-2.5-pro
GEMINI_API_KEY=
OPENAI_API_KEY=
```

- [ ] **Step 3: Write failing test for JWT verification**

`apps/api/tests/test_security.py`:
```python
import pytest
import time
import jwt as pyjwt
from app.core.security import verify_supabase_jwt

SECRET = "test-secret-at-least-32-chars-long!!"

def make_token(sub: str, secret: str = SECRET, exp_offset: int = 3600) -> str:
    payload = {"sub": sub, "email": "test@test.com", "exp": int(time.time()) + exp_offset}
    return pyjwt.encode(payload, secret, algorithm="HS256")

def test_valid_token_returns_payload():
    token = make_token("user-123")
    payload = verify_supabase_jwt(token, secret=SECRET)
    assert payload["sub"] == "user-123"

def test_expired_token_raises():
    token = make_token("user-123", exp_offset=-10)
    with pytest.raises(Exception, match="expired"):
        verify_supabase_jwt(token, secret=SECRET)

def test_wrong_secret_raises():
    token = make_token("user-123", secret="wrong-secret-padding-padding-!!!")
    with pytest.raises(Exception):
        verify_supabase_jwt(token, secret=SECRET)
```

- [ ] **Step 4: Run test — expect FAIL (module not found)**

```bash
cd apps/api && pip install -r requirements.txt
pytest tests/test_security.py -v
```
Expected: `ModuleNotFoundError: No module named 'app'`

- [ ] **Step 5: Create config.py**

`apps/api/app/core/config.py`:
```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    supabase_jwt_secret: str
    database_url: str
    ai_provider: str = "gemini"
    ai_model_fast: str = "gemini-2.5-flash"
    ai_model_pro: str = "gemini-2.5-pro"
    gemini_api_key: str = ""
    openai_api_key: str = ""

    class Config:
        env_file = ".env"

settings = Settings()
```

- [ ] **Step 6: Create security.py**

`apps/api/app/core/security.py`:
```python
from jose import jwt, JWTError, ExpiredSignatureError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.config import settings

bearer_scheme = HTTPBearer()

def verify_supabase_jwt(token: str, secret: str | None = None) -> dict:
    key = secret or settings.supabase_jwt_secret
    try:
        payload = jwt.decode(token, key, algorithms=["HS256"], options={"verify_aud": False})
        return payload
    except ExpiredSignatureError:
        raise ValueError("Token expired")
    except JWTError as e:
        raise ValueError(f"Invalid token: {e}")

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    try:
        return verify_supabase_jwt(credentials.credentials)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))
```

- [ ] **Step 7: Create main.py**

`apps/api/app/main.py`:
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Career Copilot API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://*.vercel.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok"}
```

- [ ] **Step 8: Create tests/conftest.py**

```python
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app

@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
```

- [ ] **Step 9: Run tests — expect PASS**

```bash
cd apps/api && pytest tests/test_security.py -v
```
Expected: 3 passed

- [ ] **Step 10: Commit**

```bash
git add apps/api/
git commit -m "feat(api): scaffold FastAPI app with config and JWT verification"
```

---

### Task 2: Database models + Alembic migration

**Files:**
- Create: `apps/api/app/db/session.py`
- Create: `apps/api/app/db/models.py`
- Create: `apps/api/alembic.ini`
- Create: `apps/api/alembic/env.py`
- Create: `apps/api/alembic/versions/001_initial_schema.py`

**Interfaces:**
- Produces: `get_db()` — async SQLAlchemy session dependency
- Produces: ORM models: `Resume`, `JobDescription`, `TailoringSession`, `PrepQuestion`

- [ ] **Step 1: Create session.py**

`apps/api/app/db/session.py`:
```python
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings

engine = create_async_engine(settings.database_url, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
```

- [ ] **Step 2: Create models.py**

`apps/api/app/db/models.py`:
```python
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Integer, Boolean, Text, ARRAY, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID, JSONB, TIMESTAMPTZ
from app.db.session import Base

def utcnow():
    return datetime.now(timezone.utc)

class Resume(Base):
    __tablename__ = "resumes"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    template_id: Mapped[str] = mapped_column(String(50), nullable=False, default="ats_clean")
    pdf_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMPTZ, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMPTZ, default=utcnow, onupdate=utcnow)
    sessions: Mapped[list["TailoringSession"]] = relationship(back_populates="resume", cascade="all, delete-orphan")

class JobDescription(Base):
    __tablename__ = "job_descriptions"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    parsed: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMPTZ, default=utcnow)
    sessions: Mapped[list["TailoringSession"]] = relationship(back_populates="jd", cascade="all, delete-orphan")

class TailoringSession(Base):
    __tablename__ = "tailoring_sessions"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    resume_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("resumes.id", ondelete="CASCADE"))
    jd_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("job_descriptions.id", ondelete="CASCADE"))
    ats_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    matched_skills: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    missing_skills: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    tailored_content: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    humanize_level: Mapped[int] = mapped_column(Integer, default=50)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMPTZ, default=utcnow)
    resume: Mapped["Resume"] = relationship(back_populates="sessions")
    jd: Mapped["JobDescription"] = relationship(back_populates="sessions")
    questions: Mapped[list["PrepQuestion"]] = relationship(back_populates="session", cascade="all, delete-orphan")

class PrepQuestion(Base):
    __tablename__ = "prep_questions"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tailoring_sessions.id", ondelete="CASCADE"), index=True)
    topic: Mapped[str] = mapped_column(String(255), nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer_framework: Mapped[str] = mapped_column(Text, nullable=False)
    is_gap_based: Mapped[bool] = mapped_column(Boolean, default=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    session: Mapped["TailoringSession"] = relationship(back_populates="questions")
```

- [ ] **Step 3: Initialise Alembic**

```bash
cd apps/api && alembic init alembic
```

- [ ] **Step 4: Update alembic/env.py to use async engine and import models**

`apps/api/alembic/env.py` — replace the `run_migrations_online` block:
```python
import asyncio
from logging.config import fileConfig
from sqlalchemy.ext.asyncio import create_async_engine
from alembic import context
from app.core.config import settings
from app.db.session import Base
from app.db import models  # noqa: F401 — registers all models

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

def run_migrations_offline():
    context.configure(url=settings.database_url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()

async def run_migrations_online():
    connectable = create_async_engine(settings.database_url)
    async with connectable.connect() as connection:
        await connection.run_sync(lambda conn: context.configure(connection=conn, target_metadata=target_metadata))
        async with connection.begin():
            await connection.run_sync(lambda _: context.run_migrations())

if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
```

- [ ] **Step 5: Generate and review the initial migration**

```bash
cd apps/api && alembic revision --autogenerate -m "initial schema"
```
Open the generated file in `alembic/versions/` and verify all four tables are present: `resumes`, `job_descriptions`, `tailoring_sessions`, `prep_questions`.

- [ ] **Step 6: Apply migration to Supabase DB**

```bash
cd apps/api && alembic upgrade head
```
Expected: migration runs without error.

- [ ] **Step 7: Create Supabase trigger for auto-creating profiles on signup**

In the Supabase dashboard → SQL Editor, run:
```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url, created_at)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```
Test: register a new user → a row should appear in `public.profiles`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/app/db/ apps/api/alembic/ apps/api/alembic.ini
git commit -m "feat(api): add SQLAlchemy models and Alembic initial migration"
```

---

### Task 3: AI engine abstraction

**Files:**
- Create: `apps/api/app/services/ai_engine/base.py`
- Create: `apps/api/app/services/ai_engine/gemini_provider.py`
- Create: `apps/api/app/services/ai_engine/openai_provider.py`
- Create: `apps/api/app/services/ai_engine/factory.py`
- Test: `apps/api/tests/test_ai_engine.py`

**Interfaces:**
- Produces: `get_ai_provider() -> AIProvider` — used by tailoring.py and ats.py
- Produces: `AIProvider.complete(system, user, model_tier) -> str`
- Produces: `AIProvider.complete_structured(system, user, schema, model_tier) -> BaseModel`

- [ ] **Step 1: Write failing tests**

`apps/api/tests/test_ai_engine.py`:
```python
import pytest
from unittest.mock import AsyncMock, patch
from pydantic import BaseModel
from app.services.ai_engine.factory import get_ai_provider

class SkillList(BaseModel):
    skills: list[str]

@pytest.mark.asyncio
async def test_factory_returns_gemini_by_default():
    with patch.dict("os.environ", {"AI_PROVIDER": "gemini", "GEMINI_API_KEY": "fake"}):
        from app.services.ai_engine import factory
        import importlib; importlib.reload(factory)
        provider = factory.get_ai_provider()
        assert provider.__class__.__name__ == "GeminiProvider"

@pytest.mark.asyncio
async def test_factory_returns_openai_when_set():
    with patch.dict("os.environ", {"AI_PROVIDER": "openai", "OPENAI_API_KEY": "fake"}):
        from app.services.ai_engine import factory
        import importlib; importlib.reload(factory)
        provider = factory.get_ai_provider()
        assert provider.__class__.__name__ == "OpenAIProvider"

@pytest.mark.asyncio
async def test_factory_raises_on_unknown_provider():
    with patch.dict("os.environ", {"AI_PROVIDER": "unknown"}):
        from app.services.ai_engine import factory
        import importlib; importlib.reload(factory)
        with pytest.raises(ValueError, match="Unknown AI_PROVIDER"):
            factory.get_ai_provider()
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/api && pytest tests/test_ai_engine.py -v
```

- [ ] **Step 3: Create base.py**

`apps/api/app/services/ai_engine/base.py`:
```python
from abc import ABC, abstractmethod
from pydantic import BaseModel

class AIProvider(ABC):
    @abstractmethod
    async def complete(self, system: str, user: str, model_tier: str = "fast") -> str:
        """model_tier: 'fast' | 'pro'"""

    @abstractmethod
    async def complete_structured(
        self, system: str, user: str, schema: type[BaseModel], model_tier: str = "fast"
    ) -> BaseModel:
        """Returns a validated instance of schema."""
```

- [ ] **Step 4: Create gemini_provider.py**

`apps/api/app/services/ai_engine/gemini_provider.py`:
```python
import json
import google.generativeai as genai
from pydantic import BaseModel
from app.services.ai_engine.base import AIProvider

class GeminiProvider(AIProvider):
    def __init__(self, fast_model: str, pro_model: str, api_key: str):
        genai.configure(api_key=api_key)
        self._fast = genai.GenerativeModel(fast_model)
        self._pro = genai.GenerativeModel(pro_model)

    def _model(self, tier: str):
        return self._pro if tier == "pro" else self._fast

    async def complete(self, system: str, user: str, model_tier: str = "fast") -> str:
        prompt = f"{system}\n\n{user}"
        response = await self._model(model_tier).generate_content_async(prompt)
        return response.text

    async def complete_structured(
        self, system: str, user: str, schema: type[BaseModel], model_tier: str = "fast"
    ) -> BaseModel:
        prompt = (
            f"{system}\n\nRespond ONLY with valid JSON matching this schema: "
            f"{schema.model_json_schema()}\n\n{user}"
        )
        response = await self._model(model_tier).generate_content_async(prompt)
        text = response.text.strip().lstrip("```json").rstrip("```").strip()
        return schema.model_validate(json.loads(text))
```

- [ ] **Step 5: Create openai_provider.py**

`apps/api/app/services/ai_engine/openai_provider.py`:
```python
import json
from openai import AsyncOpenAI
from pydantic import BaseModel
from app.services.ai_engine.base import AIProvider

class OpenAIProvider(AIProvider):
    def __init__(self, fast_model: str, pro_model: str, api_key: str):
        self._client = AsyncOpenAI(api_key=api_key)
        self._fast = fast_model
        self._pro = pro_model

    def _model(self, tier: str) -> str:
        return self._pro if tier == "pro" else self._fast

    async def complete(self, system: str, user: str, model_tier: str = "fast") -> str:
        response = await self._client.chat.completions.create(
            model=self._model(model_tier),
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        )
        return response.choices[0].message.content

    async def complete_structured(
        self, system: str, user: str, schema: type[BaseModel], model_tier: str = "fast"
    ) -> BaseModel:
        response = await self._client.chat.completions.create(
            model=self._model(model_tier),
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            response_format={"type": "json_object"},
        )
        return schema.model_validate(json.loads(response.choices[0].message.content))
```

- [ ] **Step 6: Create factory.py**

`apps/api/app/services/ai_engine/factory.py`:
```python
import os
from app.services.ai_engine.base import AIProvider

def get_ai_provider() -> AIProvider:
    provider = os.getenv("AI_PROVIDER", "gemini")
    fast = os.getenv("AI_MODEL_FAST", "gemini-2.5-flash")
    pro = os.getenv("AI_MODEL_PRO", "gemini-2.5-pro")

    if provider == "gemini":
        from app.services.ai_engine.gemini_provider import GeminiProvider
        return GeminiProvider(fast_model=fast, pro_model=pro, api_key=os.getenv("GEMINI_API_KEY", ""))

    if provider == "openai":
        from app.services.ai_engine.openai_provider import OpenAIProvider
        return OpenAIProvider(fast_model=fast, pro_model=pro, api_key=os.getenv("OPENAI_API_KEY", ""))

    raise ValueError(f"Unknown AI_PROVIDER: {provider!r}. Use 'gemini' or 'openai'.")
```

- [ ] **Step 7: Run tests — expect PASS**

```bash
cd apps/api && pytest tests/test_ai_engine.py -v
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/app/services/ai_engine/ apps/api/tests/test_ai_engine.py
git commit -m "feat(api): add swappable AI provider abstraction (Gemini + OpenAI)"
```

---

### Task 4: ATS scoring service

**Files:**
- Create: `apps/api/app/services/ats.py`
- Test: `apps/api/tests/test_ats.py`

**Interfaces:**
- Consumes: `AIProvider.complete_structured()`
- Produces: `compute_delta(jd_skills, resume_text) -> DeltaResult` where `DeltaResult` has `matched: list[str]`, `missing: list[str]`, `ats_score: int`

- [ ] **Step 1: Write failing tests**

`apps/api/tests/test_ats.py`:
```python
import pytest
from app.services.ats import compute_delta, DeltaResult

def test_compute_delta_all_matched():
    jd_skills = ["Python", "FastAPI", "PostgreSQL"]
    resume_text = "Experienced with Python, FastAPI, and PostgreSQL databases."
    result = compute_delta(jd_skills, resume_text)
    assert isinstance(result, DeltaResult)
    assert set(result.matched) == {"Python", "FastAPI", "PostgreSQL"}
    assert result.missing == []
    assert result.ats_score == 100

def test_compute_delta_none_matched():
    jd_skills = ["Kubernetes", "Rust", "Terraform"]
    resume_text = "Expert in Python and JavaScript development."
    result = compute_delta(jd_skills, resume_text)
    assert result.matched == []
    assert set(result.missing) == {"Kubernetes", "Rust", "Terraform"}
    assert result.ats_score == 0

def test_compute_delta_partial_match():
    jd_skills = ["Python", "AWS", "Docker"]
    resume_text = "Python developer with Docker experience."
    result = compute_delta(jd_skills, resume_text)
    assert "Python" in result.matched
    assert "Docker" in result.matched
    assert "AWS" in result.missing
    assert result.ats_score == pytest.approx(66, abs=2)

def test_ats_score_is_0_to_100():
    result = compute_delta(["X", "Y"], "nothing relevant")
    assert 0 <= result.ats_score <= 100
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/api && pytest tests/test_ats.py -v
```

- [ ] **Step 3: Implement ats.py**

`apps/api/app/services/ats.py`:
```python
from dataclasses import dataclass

@dataclass
class DeltaResult:
    matched: list[str]
    missing: list[str]
    ats_score: int

def compute_delta(jd_skills: list[str], resume_text: str) -> DeltaResult:
    """Case-insensitive keyword match of JD skills against resume plain text."""
    resume_lower = resume_text.lower()
    matched = []
    missing = []
    for skill in jd_skills:
        if skill.lower() in resume_lower:
            matched.append(skill)
        else:
            missing.append(skill)
    total = len(jd_skills)
    score = round((len(matched) / total) * 100) if total > 0 else 0
    return DeltaResult(matched=matched, missing=missing, ats_score=score)
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd apps/api && pytest tests/test_ats.py -v
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/ats.py apps/api/tests/test_ats.py
git commit -m "feat(api): add ATS keyword scoring service"
```

---

### Task 5: Tailoring pipeline

**Files:**
- Create: `apps/api/app/services/tailoring.py`
- Test: `apps/api/tests/test_tailoring.py`

**Interfaces:**
- Consumes: `AIProvider`, `compute_delta()`
- Produces:
  - `extract_jd_skills(jd_text, provider) -> ParsedJD` where `ParsedJD` has `required: list[str]`, `nice_to_have: list[str]`
  - `rewrite_bullets(resume_content, matched_skills, humanize_level, provider) -> dict`
  - `generate_prep_questions(missing_skills, resume_content, provider) -> list[PrepQuestionData]`
  - `run_tailoring_pipeline(resume_content, jd_text, humanize_level, provider) -> TailoringResult`

- [ ] **Step 1: Write failing tests**

`apps/api/tests/test_tailoring.py`:
```python
import pytest
from unittest.mock import AsyncMock, MagicMock
from pydantic import BaseModel
from app.services.tailoring import (
    extract_jd_skills, ParsedJD,
    rewrite_bullets,
    generate_prep_questions, PrepQuestionData,
    run_tailoring_pipeline, TailoringResult,
)

def make_mock_provider(structured_return=None, complete_return=""):
    provider = MagicMock()
    provider.complete_structured = AsyncMock(return_value=structured_return)
    provider.complete = AsyncMock(return_value=complete_return)
    return provider

@pytest.mark.asyncio
async def test_extract_jd_skills_returns_parsed_jd():
    parsed = ParsedJD(required=["Python", "AWS"], nice_to_have=["Docker"])
    provider = make_mock_provider(structured_return=parsed)
    result = await extract_jd_skills("We need Python, AWS. Docker is a plus.", provider)
    assert isinstance(result, ParsedJD)
    assert "Python" in result.required

@pytest.mark.asyncio
async def test_rewrite_bullets_returns_dict():
    provider = make_mock_provider(complete_return='{"experience": [{"title": "Engineer", "bullets": ["Built APIs"]}]}')
    resume = {"experience": [{"title": "Engineer", "bullets": ["Built stuff"]}]}
    result = await rewrite_bullets(resume, ["Python"], 50, provider)
    assert isinstance(result, dict)

@pytest.mark.asyncio
async def test_generate_prep_questions_returns_list():
    questions = [PrepQuestionData(topic="AWS", question="How would you approach AWS?", answer_framework="Use STAR", is_gap_based=True, order_index=0)]
    provider = make_mock_provider(structured_return=MagicMock(questions=questions))
    result = await generate_prep_questions(["AWS"], {"experience": []}, provider)
    assert len(result) >= 1
    assert result[0].topic == "AWS"

@pytest.mark.asyncio
async def test_run_tailoring_pipeline_returns_result():
    parsed_jd = ParsedJD(required=["Python"], nice_to_have=[])
    questions_wrapper = MagicMock(questions=[
        PrepQuestionData(topic="AWS", question="Q?", answer_framework="A", is_gap_based=True, order_index=0)
    ])
    provider = MagicMock()
    provider.complete_structured = AsyncMock(side_effect=[parsed_jd, questions_wrapper])
    provider.complete = AsyncMock(return_value='{"experience": []}')
    resume = {"experience": [{"title": "Eng", "bullets": ["Used Python"]}], "skills": ["Python"]}
    result = await run_tailoring_pipeline(resume, "Need Python and AWS exp.", 50, provider)
    assert isinstance(result, TailoringResult)
    assert result.ats_score >= 0
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/api && pytest tests/test_tailoring.py -v
```

- [ ] **Step 3: Implement tailoring.py**

`apps/api/app/services/tailoring.py`:
```python
import json
from dataclasses import dataclass
from pydantic import BaseModel
from app.services.ai_engine.base import AIProvider
from app.services.ats import compute_delta, DeltaResult

class ParsedJD(BaseModel):
    required: list[str]
    nice_to_have: list[str]

class PrepQuestionData(BaseModel):
    topic: str
    question: str
    answer_framework: str
    is_gap_based: bool = True
    order_index: int

class PrepQuestionsWrapper(BaseModel):
    questions: list[PrepQuestionData]

@dataclass
class TailoringResult:
    tailored_content: dict
    matched_skills: list[str]
    missing_skills: list[str]
    ats_score: int
    prep_questions: list[PrepQuestionData]

async def extract_jd_skills(jd_text: str, provider: AIProvider) -> ParsedJD:
    system = (
        "You are an expert technical recruiter. Extract skills from the job description. "
        "Return structured JSON only."
    )
    return await provider.complete_structured(system, jd_text, ParsedJD, model_tier="fast")

async def rewrite_bullets(
    resume_content: dict, matched_skills: list[str], humanize_level: int, provider: AIProvider
) -> dict:
    humanize_desc = (
        "Write in completely natural prose — keywords appear organically." if humanize_level < 30
        else "Front-load keywords prominently in each bullet for maximum ATS density." if humanize_level > 70
        else "Weave keywords naturally into bullets while keeping them readable."
    )
    system = (
        f"You are a professional resume writer. Rewrite the experience bullets to include "
        f"these skills: {matched_skills}. {humanize_desc} "
        f"Return the full resume_content JSON with rewritten bullets only — do not add fake metrics."
    )
    raw = await provider.complete(system, json.dumps(resume_content), model_tier="pro")
    try:
        cleaned = raw.strip().lstrip("```json").rstrip("```").strip()
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return resume_content  # fallback: return original if parsing fails

async def generate_prep_questions(
    missing_skills: list[str], resume_content: dict, provider: AIProvider
) -> list[PrepQuestionData]:
    system = (
        "You are an expert interview coach. Generate 10 interview questions based on the "
        f"candidate's resume gaps. Missing skills: {missing_skills}. "
        "For each question, provide: topic, question, answer_framework (STAR-based), "
        "is_gap_based=true, order_index. Return as JSON with a 'questions' array."
    )
    wrapper = await provider.complete_structured(
        system, json.dumps(resume_content), PrepQuestionsWrapper, model_tier="pro"
    )
    return wrapper.questions

async def run_tailoring_pipeline(
    resume_content: dict, jd_text: str, humanize_level: int, provider: AIProvider
) -> TailoringResult:
    # Step A: extract JD skills (fast model)
    parsed_jd = await extract_jd_skills(jd_text, provider)
    all_jd_skills = parsed_jd.required + parsed_jd.nice_to_have

    # Step B: compute delta (local, no AI)
    resume_text = json.dumps(resume_content)
    delta = compute_delta(all_jd_skills, resume_text)

    # Step C: rewrite bullets (pro model)
    tailored = await rewrite_bullets(resume_content, delta.matched, humanize_level, provider)

    # Step D: generate prep questions (pro model)
    questions = await generate_prep_questions(delta.missing, resume_content, provider)

    return TailoringResult(
        tailored_content=tailored,
        matched_skills=delta.matched,
        missing_skills=delta.missing,
        ats_score=delta.ats_score,
        prep_questions=questions,
    )
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd apps/api && pytest tests/test_tailoring.py -v
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/tailoring.py apps/api/tests/test_tailoring.py
git commit -m "feat(api): add 4-step AI tailoring pipeline"
```

---

### Task 6: PDF generation service

**Files:**
- Create: `apps/api/app/services/pdf.py`
- Create: `apps/api/templates/ats_clean.html`
- Create: `apps/api/templates/ats_modern.html`
- Test: `apps/api/tests/test_pdf.py`

**Interfaces:**
- Produces: `generate_pdf(resume_content, template_id) -> bytes`
- Produces: `upload_pdf(pdf_bytes, user_id, resume_id, supabase_client) -> str` (returns storage path)
- Produces: `get_signed_url(storage_path, supabase_client) -> str`

- [ ] **Step 1: Write failing tests**

`apps/api/tests/test_pdf.py`:
```python
import pytest
from app.services.pdf import generate_pdf

SAMPLE_RESUME = {
    "contact": {"name": "Jane Doe", "email": "jane@example.com", "phone": "555-0100", "location": "NYC"},
    "experience": [{"company": "Acme Corp", "title": "Engineer", "dates": "2022–2024", "bullets": ["Built APIs", "Led team of 3"]}],
    "education": [{"school": "MIT", "degree": "B.S. Computer Science", "dates": "2018–2022"}],
    "skills": ["Python", "FastAPI", "PostgreSQL"],
}

def test_generate_pdf_returns_bytes_ats_clean():
    pdf = generate_pdf(SAMPLE_RESUME, "ats_clean")
    assert isinstance(pdf, bytes)
    assert pdf[:4] == b"%PDF"

def test_generate_pdf_returns_bytes_ats_modern():
    pdf = generate_pdf(SAMPLE_RESUME, "ats_modern")
    assert isinstance(pdf, bytes)
    assert pdf[:4] == b"%PDF"

def test_generate_pdf_invalid_template_raises():
    with pytest.raises(ValueError, match="Unknown template"):
        generate_pdf(SAMPLE_RESUME, "unknown_template")
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/api && pytest tests/test_pdf.py -v
```

- [ ] **Step 3: Create ats_clean.html template**

`apps/api/templates/ats_clean.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.4; margin: 1in; color: #000; }
  h1 { font-size: 16pt; margin: 0 0 4px; }
  .contact { font-size: 10pt; margin-bottom: 12px; }
  h2 { font-size: 12pt; border-bottom: 1px solid #000; margin: 12px 0 4px; text-transform: uppercase; letter-spacing: 0.05em; }
  .job-title { font-weight: bold; }
  .dates { float: right; font-size: 10pt; }
  ul { margin: 4px 0 8px 16px; padding: 0; }
  li { margin-bottom: 2px; }
  .skills { margin: 4px 0; }
</style>
</head>
<body>
<h1>{{ contact.name }}</h1>
<div class="contact">{{ contact.email }} | {{ contact.phone }} | {{ contact.location }}</div>

{% if experience %}
<h2>Experience</h2>
{% for job in experience %}
<div><span class="job-title">{{ job.title }}</span>, {{ job.company }} <span class="dates">{{ job.dates }}</span></div>
<ul>{% for b in job.bullets %}<li>{{ b }}</li>{% endfor %}</ul>
{% endfor %}
{% endif %}

{% if education %}
<h2>Education</h2>
{% for edu in education %}
<div><span class="job-title">{{ edu.degree }}</span>, {{ edu.school }} <span class="dates">{{ edu.dates }}</span></div>
{% endfor %}
{% endif %}

{% if skills %}
<h2>Skills</h2>
<div class="skills">{{ skills | join(", ") }}</div>
{% endif %}
</body>
</html>
```

- [ ] **Step 4: Create ats_modern.html template**

`apps/api/templates/ats_modern.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 11pt; line-height: 1.5; margin: 0.75in 1in; color: #131b2e; }
  h1 { font-size: 18pt; font-weight: 700; margin: 0 0 2px; letter-spacing: -0.02em; }
  .contact { font-size: 10pt; color: #454651; margin-bottom: 16px; }
  h2 { font-size: 11pt; font-weight: 700; color: #000a56; border-bottom: 1.5px solid #eaedff; margin: 14px 0 6px; text-transform: uppercase; letter-spacing: 0.08em; }
  .job-header { display: flex; justify-content: space-between; align-items: baseline; }
  .job-title { font-weight: 600; font-size: 11pt; }
  .company { font-size: 10pt; color: #454651; }
  .dates { font-size: 10pt; color: #767682; }
  ul { margin: 4px 0 10px 16px; padding: 0; }
  li { margin-bottom: 3px; font-size: 10.5pt; }
  .skills { font-size: 10.5pt; margin: 4px 0; }
</style>
</head>
<body>
<h1>{{ contact.name }}</h1>
<div class="contact">{{ contact.email }} &nbsp;·&nbsp; {{ contact.phone }} &nbsp;·&nbsp; {{ contact.location }}</div>

{% if experience %}
<h2>Experience</h2>
{% for job in experience %}
<div class="job-header">
  <div><span class="job-title">{{ job.title }}</span> &nbsp;·&nbsp; <span class="company">{{ job.company }}</span></div>
  <span class="dates">{{ job.dates }}</span>
</div>
<ul>{% for b in job.bullets %}<li>{{ b }}</li>{% endfor %}</ul>
{% endfor %}
{% endif %}

{% if education %}
<h2>Education</h2>
{% for edu in education %}
<div class="job-header">
  <div><span class="job-title">{{ edu.degree }}</span> &nbsp;·&nbsp; <span class="company">{{ edu.school }}</span></div>
  <span class="dates">{{ edu.dates }}</span>
</div>
{% endfor %}
{% endif %}

{% if skills %}
<h2>Skills</h2>
<div class="skills">{{ skills | join(" &nbsp;·&nbsp; ") }}</div>
{% endif %}
</body>
</html>
```

- [ ] **Step 5: Implement pdf.py**

`apps/api/app/services/pdf.py`:
```python
import uuid
from pathlib import Path
from jinja2 import Environment, FileSystemLoader
import weasyprint

TEMPLATES_DIR = Path(__file__).parent.parent.parent / "templates"
ALLOWED_TEMPLATES = {"ats_clean", "ats_modern"}

_jinja_env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)), autoescape=True)

def generate_pdf(resume_content: dict, template_id: str) -> bytes:
    if template_id not in ALLOWED_TEMPLATES:
        raise ValueError(f"Unknown template: {template_id!r}. Use one of {ALLOWED_TEMPLATES}")
    template = _jinja_env.get_template(f"{template_id}.html")
    html = template.render(**resume_content)
    return weasyprint.HTML(string=html).write_pdf()

async def upload_pdf(
    pdf_bytes: bytes, user_id: str, resume_id: str, supabase_client
) -> str:
    """Upload PDF to Supabase Storage. Returns storage path."""
    path = f"resumes/{user_id}/{resume_id}.pdf"
    supabase_client.storage.from_("resumes").upload(
        path, pdf_bytes, {"content-type": "application/pdf", "upsert": "true"}
    )
    return path

def get_signed_url(storage_path: str, supabase_client, expires_in: int = 3600) -> str:
    """Generate a signed URL valid for expires_in seconds."""
    result = supabase_client.storage.from_("resumes").create_signed_url(storage_path, expires_in)
    return result["signedURL"]
```

- [ ] **Step 6: Run tests — expect PASS**

```bash
cd apps/api && pytest tests/test_pdf.py -v
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/app/services/pdf.py apps/api/templates/ apps/api/tests/test_pdf.py
git commit -m "feat(api): add WeasyPrint PDF generation with ats_clean and ats_modern templates"
```

---

### Task 7: Pydantic schemas + all routers

**Files:**
- Create: `apps/api/app/schemas/resume.py`
- Create: `apps/api/app/schemas/jd.py`
- Create: `apps/api/app/schemas/ai.py`
- Create: `apps/api/app/routers/resumes.py`
- Create: `apps/api/app/routers/jd.py`
- Create: `apps/api/app/routers/ai.py`
- Modify: `apps/api/app/main.py` — include routers
- Test: `apps/api/tests/test_routers.py`

**Interfaces:**
- Produces: REST API — all endpoints below
- Consumes: `get_current_user`, `get_db`, `run_tailoring_pipeline`, `generate_pdf`, `upload_pdf`, `get_signed_url`

**Endpoints:**
```
GET    /health                      → public
GET    /resumes                     → list user's resumes
POST   /resumes                     → create resume
GET    /resumes/{id}                → get one resume
PATCH  /resumes/{id}                → update resume content/title/template
DELETE /resumes/{id}                → delete resume
POST   /resumes/{id}/pdf            → generate PDF, upload, return signed URL
POST   /jd                          → create JD record
GET    /jd/{id}                     → get parsed JD
POST   /ai/tailor                   → run full tailoring pipeline
GET    /ai/sessions/{id}/questions  → get prep questions for session
```

- [ ] **Step 1: Create schemas**

`apps/api/app/schemas/resume.py`:
```python
import uuid
from datetime import datetime
from pydantic import BaseModel

class ResumeCreate(BaseModel):
    title: str
    content: dict = {}
    template_id: str = "ats_clean"

class ResumeUpdate(BaseModel):
    title: str | None = None
    content: dict | None = None
    template_id: str | None = None

class ResumeOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    title: str
    content: dict
    template_id: str
    pdf_url: str | None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}
```

`apps/api/app/schemas/jd.py`:
```python
import uuid
from datetime import datetime
from pydantic import BaseModel

class JDCreate(BaseModel):
    raw_text: str

class JDOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    raw_text: str
    parsed: dict | None
    created_at: datetime
    model_config = {"from_attributes": True}
```

`apps/api/app/schemas/ai.py`:
```python
import uuid
from datetime import datetime
from pydantic import BaseModel

class TailorRequest(BaseModel):
    resume_id: uuid.UUID
    jd_id: uuid.UUID
    humanize_level: int = 50  # 0–100

class PrepQuestionOut(BaseModel):
    id: uuid.UUID
    session_id: uuid.UUID
    topic: str
    question: str
    answer_framework: str
    is_gap_based: bool
    order_index: int
    model_config = {"from_attributes": True}

class TailorOut(BaseModel):
    session_id: uuid.UUID
    ats_score: int
    matched_skills: list[str]
    missing_skills: list[str]
    tailored_content: dict
    questions: list[PrepQuestionOut]
```

- [ ] **Step 2: Create resumes router**

`apps/api/app/routers/resumes.py`:
```python
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db
from app.db.models import Resume
from app.core.security import get_current_user
from app.schemas.resume import ResumeCreate, ResumeUpdate, ResumeOut
from app.services.pdf import generate_pdf, upload_pdf, get_signed_url
from supabase import create_client
from app.core.config import settings

router = APIRouter(prefix="/resumes", tags=["resumes"])

def _supabase():
    return create_client(settings.supabase_url, settings.supabase_service_role_key)

@router.get("", response_model=list[ResumeOut])
async def list_resumes(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Resume).where(Resume.user_id == uuid.UUID(user["sub"])))
    return result.scalars().all()

@router.post("", response_model=ResumeOut, status_code=status.HTTP_201_CREATED)
async def create_resume(body: ResumeCreate, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    resume = Resume(user_id=uuid.UUID(user["sub"]), **body.model_dump())
    db.add(resume)
    await db.commit()
    await db.refresh(resume)
    return resume

@router.get("/{resume_id}", response_model=ResumeOut)
async def get_resume(resume_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Resume).where(Resume.id == resume_id, Resume.user_id == uuid.UUID(user["sub"])))
    resume = result.scalar_one_or_none()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    return resume

@router.patch("/{resume_id}", response_model=ResumeOut)
async def update_resume(resume_id: uuid.UUID, body: ResumeUpdate, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Resume).where(Resume.id == resume_id, Resume.user_id == uuid.UUID(user["sub"])))
    resume = result.scalar_one_or_none()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(resume, field, value)
    await db.commit()
    await db.refresh(resume)
    return resume

@router.delete("/{resume_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_resume(resume_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Resume).where(Resume.id == resume_id, Resume.user_id == uuid.UUID(user["sub"])))
    resume = result.scalar_one_or_none()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    await db.delete(resume)
    await db.commit()

@router.post("/{resume_id}/pdf")
async def generate_resume_pdf(resume_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Resume).where(Resume.id == resume_id, Resume.user_id == uuid.UUID(user["sub"])))
    resume = result.scalar_one_or_none()
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")
    pdf_bytes = generate_pdf(resume.content, resume.template_id)
    sb = _supabase()
    path = await upload_pdf(pdf_bytes, str(user["sub"]), str(resume_id), sb)
    resume.pdf_url = path
    await db.commit()
    signed_url = get_signed_url(path, sb)
    return {"signed_url": signed_url, "expires_in": 3600}
```

- [ ] **Step 3: Create JD router**

`apps/api/app/routers/jd.py`:
```python
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db
from app.db.models import JobDescription
from app.core.security import get_current_user
from app.schemas.jd import JDCreate, JDOut
from app.services.ai_engine.factory import get_ai_provider
from app.services.tailoring import extract_jd_skills

router = APIRouter(prefix="/jd", tags=["jd"])

@router.post("", response_model=JDOut, status_code=201)
async def create_jd(body: JDCreate, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    provider = get_ai_provider()
    parsed = await extract_jd_skills(body.raw_text, provider)
    jd = JobDescription(
        user_id=uuid.UUID(user["sub"]),
        raw_text=body.raw_text,
        parsed=parsed.model_dump(),
    )
    db.add(jd)
    await db.commit()
    await db.refresh(jd)
    return jd

@router.get("/{jd_id}", response_model=JDOut)
async def get_jd(jd_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(JobDescription).where(JobDescription.id == jd_id, JobDescription.user_id == uuid.UUID(user["sub"])))
    jd = result.scalar_one_or_none()
    if not jd:
        raise HTTPException(status_code=404, detail="JD not found")
    return jd
```

- [ ] **Step 4: Create AI router**

`apps/api/app/routers/ai.py`:
```python
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db
from app.db.models import Resume, JobDescription, TailoringSession, PrepQuestion
from app.core.security import get_current_user
from app.schemas.ai import TailorRequest, TailorOut, PrepQuestionOut
from app.services.ai_engine.factory import get_ai_provider
from app.services.tailoring import run_tailoring_pipeline

router = APIRouter(prefix="/ai", tags=["ai"])

@router.post("/tailor", response_model=TailorOut)
async def tailor_resume(body: TailorRequest, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    uid = uuid.UUID(user["sub"])
    resume_row = (await db.execute(select(Resume).where(Resume.id == body.resume_id, Resume.user_id == uid))).scalar_one_or_none()
    jd_row = (await db.execute(select(JobDescription).where(JobDescription.id == body.jd_id, JobDescription.user_id == uid))).scalar_one_or_none()
    if not resume_row or not jd_row:
        raise HTTPException(status_code=404, detail="Resume or JD not found")

    provider = get_ai_provider()
    result = await run_tailoring_pipeline(resume_row.content, jd_row.raw_text, body.humanize_level, provider)

    session = TailoringSession(
        user_id=uid, resume_id=body.resume_id, jd_id=body.jd_id,
        ats_score=result.ats_score, matched_skills=result.matched_skills,
        missing_skills=result.missing_skills, tailored_content=result.tailored_content,
        humanize_level=body.humanize_level,
    )
    db.add(session)
    await db.flush()

    questions = [
        PrepQuestion(session_id=session.id, topic=q.topic, question=q.question,
                     answer_framework=q.answer_framework, is_gap_based=q.is_gap_based, order_index=q.order_index)
        for q in result.prep_questions
    ]
    db.add_all(questions)
    await db.commit()
    await db.refresh(session)

    return TailorOut(
        session_id=session.id, ats_score=result.ats_score,
        matched_skills=result.matched_skills, missing_skills=result.missing_skills,
        tailored_content=result.tailored_content,
        questions=[PrepQuestionOut.model_validate(q) for q in questions],
    )

@router.get("/sessions/{session_id}/questions", response_model=list[PrepQuestionOut])
async def get_questions(session_id: uuid.UUID, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PrepQuestion).join(TailoringSession)
        .where(TailoringSession.id == session_id, TailoringSession.user_id == uuid.UUID(user["sub"]))
        .order_by(PrepQuestion.order_index)
    )
    return result.scalars().all()
```

- [ ] **Step 5: Wire routers into main.py**

`apps/api/app/main.py`:
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import resumes, jd, ai

app = FastAPI(title="Career Copilot API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://*.vercel.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(resumes.router)
app.include_router(jd.router)
app.include_router(ai.router)

@app.get("/health")
async def health():
    return {"status": "ok"}
```

- [ ] **Step 6: Write router smoke tests**

`apps/api/tests/test_routers.py`:
```python
import pytest
import time
import jwt as pyjwt
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch, AsyncMock
from app.main import app
from app.core.config import settings

def make_auth_header():
    payload = {"sub": "00000000-0000-0000-0000-000000000001", "email": "test@test.com", "exp": int(time.time()) + 3600}
    token = pyjwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}

@pytest.mark.asyncio
async def test_health_is_public():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/health")
    assert r.status_code == 200

@pytest.mark.asyncio
async def test_list_resumes_requires_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/resumes")
    assert r.status_code == 403

@pytest.mark.asyncio
async def test_list_resumes_returns_200_with_valid_token():
    with patch("app.routers.resumes.get_db") as mock_db:
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=AsyncMock(scalars=lambda: AsyncMock(all=lambda: [])))
        mock_db.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_db.return_value.__aexit__ = AsyncMock(return_value=False)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/resumes", headers=make_auth_header())
    assert r.status_code == 200
```

- [ ] **Step 7: Run all tests**

```bash
cd apps/api && pytest tests/ -v
```
Expected: all passing (router tests may need DB mock adjustment — check output and fix any import errors)

- [ ] **Step 8: Commit**

```bash
git add apps/api/app/schemas/ apps/api/app/routers/ apps/api/tests/test_routers.py apps/api/app/main.py
git commit -m "feat(api): add all REST routers — resumes, jd, ai tailoring"
```

---

### Task 8: Monorepo root + deployment config

**Files:**
- Create: `turbo.json`
- Create: `package.json` (root)
- Create: `apps/api/Procfile` (Railway)
- Create: `.env.example` (root)
- Create: `.gitignore`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "ai-resume-hub",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint"
  },
  "devDependencies": {
    "turbo": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] },
    "dev": { "cache": false, "persistent": true },
    "lint": {}
  }
}
```

- [ ] **Step 3: Create Procfile for Railway**

`apps/api/Procfile`:
```
web: uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

- [ ] **Step 4: Create .gitignore**

```
.env
__pycache__/
*.pyc
.venv/
node_modules/
.next/
dist/
*.pdf
.DS_Store
```

- [ ] **Step 5: Final backend test run**

```bash
cd apps/api && pytest tests/ -v --tb=short
```
Expected: all tests passing.

- [ ] **Step 6: Commit**

```bash
git add turbo.json package.json apps/api/Procfile .gitignore .env.example
git commit -m "chore: add monorepo scaffold and Railway deployment config"
```

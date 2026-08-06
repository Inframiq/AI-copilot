# AI Resume Hub — Design Spec
**Date:** 2026-08-06
**Scope:** Web application + backend (V1 MVP). Android app is out of scope for this phase.

---

## 1. Product Summary

A dual-mode AI-powered career tool that:
1. Tailors a user's resume against a Job Description (JD) to maximize ATS match score
2. Generates gap-based interview prep questions targeting the user's specific missing skills

The product is named **Career Copilot**.

---

## 2. Repository Structure

Turborepo monorepo with two apps and one packages directory.

```
ai-resume-hub/
├── apps/
│   ├── api/                          ← FastAPI backend (Python)
│   └── web/                          ← Next.js 14 App Router frontend
├── packages/
│   └── types/                        ← Shared TypeScript types (API contracts)
├── turbo.json
├── package.json
└── .env.example
```

### apps/api/ structure

```
apps/api/
├── app/
│   ├── main.py                       ← Entrypoint, CORS, router registration
│   ├── core/
│   │   ├── config.py                 ← Env vars (DB URL, Supabase keys, AI keys)
│   │   └── security.py               ← Supabase JWT verification
│   ├── db/
│   │   ├── models.py                 ← SQLAlchemy ORM models
│   │   └── session.py                ← DB connection pool
│   ├── routers/
│   │   ├── resumes.py                ← /resumes/* CRUD
│   │   ├── jd.py                     ← /jd/* analysis endpoints
│   │   └── ai.py                     ← /ai/* tailoring, humanize, prep generation
│   ├── services/
│   │   ├── ai_engine/
│   │   │   ├── base.py               ← Abstract AIProvider interface
│   │   │   ├── openai.py             ← OpenAI implementation
│   │   │   ├── gemini.py             ← Gemini implementation
│   │   │   └── factory.py            ← Reads AI_PROVIDER env var, returns provider
│   │   ├── ats.py                    ← ATS scoring & keyword matching
│   │   ├── tailoring.py              ← 4-step tailoring pipeline
│   │   └── pdf.py                    ← WeasyPrint PDF generation + Supabase Storage upload
│   └── schemas/                      ← Pydantic request/response models
├── alembic/                          ← DB migrations
└── requirements.txt
```

### apps/web/ structure

```
apps/web/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   └── callback/route.ts         ← Supabase OAuth callback
│   ├── dashboard/page.tsx
│   ├── studio/[resumeId]/page.tsx
│   ├── jd/[jdId]/page.tsx
│   └── interview/[sessionId]/page.tsx
├── components/
│   ├── ui/                           ← Radix UI primitives + Tailwind
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   └── TopNav.tsx                ← Mobile top bar
│   ├── resume/
│   │   ├── EditorPanel.tsx           ← Left panel (tabs: Contact, Experience, Education, Skills)
│   │   ├── PreviewPanel.tsx          ← Right panel (PDF iframe + template selector)
│   │   ├── AtsScoreRing.tsx
│   │   ├── SkillsDelta.tsx           ← Matched (green) / Missing (red) skills list
│   │   └── HumanizeSlider.tsx
│   └── interview/
│       ├── QuestionCard.tsx
│       └── TopicList.tsx
├── lib/
│   ├── api-client.ts                 ← Typed fetch wrapper → FastAPI
│   └── supabase.ts                   ← Supabase client (auth + storage)
├── stores/
│   ├── resume-store.ts               ← Zustand: editor content, isDirty, auto-save
│   └── tailoring-store.ts            ← Zustand: JD text, session state, humanize level
├── design-refs/                      ← Original HTML reference screens (committed)
│   ├── dashboard.html
│   ├── resume_studio.html
│   ├── jd_analyzer.html
│   └── interview_center.html
└── tailwind.config.ts
```

---

## 3. Database Schema (PostgreSQL via Supabase)

Supabase Auth manages identity. Our schema extends it with a `profiles` table.

```sql
-- User profile (extends Supabase auth.users)
profiles
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
  full_name     TEXT
  avatar_url    TEXT
  created_at    TIMESTAMPTZ DEFAULT now()

-- Resume documents
resumes
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
  title         TEXT NOT NULL                          -- e.g. "Senior PM @ Stripe"
  content       JSONB NOT NULL DEFAULT '{}'            -- sections: contact, experience, education, skills
  template_id   TEXT NOT NULL DEFAULT 'ats_clean'      -- 'ats_clean' | 'ats_modern'
  pdf_url       TEXT                                   -- Supabase Storage object path (e.g. resumes/{user_id}/{id}.pdf); signed URLs generated on demand, not stored
  created_at    TIMESTAMPTZ DEFAULT now()
  updated_at    TIMESTAMPTZ DEFAULT now()

-- Job descriptions
job_descriptions
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
  raw_text      TEXT NOT NULL
  parsed        JSONB                                  -- {required_skills[], nice_to_have[], role, company}
  created_at    TIMESTAMPTZ DEFAULT now()

-- Tailoring sessions (resume ↔ JD pairing)
tailoring_sessions
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
  resume_id     UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE
  jd_id         UUID NOT NULL REFERENCES job_descriptions(id) ON DELETE CASCADE
  ats_score     INTEGER                               -- 0–100
  matched_skills  TEXT[] DEFAULT '{}'
  missing_skills  TEXT[] DEFAULT '{}'
  tailored_content JSONB                              -- rewritten resume sections
  humanize_level  INTEGER DEFAULT 50                  -- 0–100 slider value used
  created_at    TIMESTAMPTZ DEFAULT now()

-- Interview prep questions (belong to a tailoring session)
prep_questions
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid()
  session_id    UUID NOT NULL REFERENCES tailoring_sessions(id) ON DELETE CASCADE
  topic         TEXT NOT NULL                         -- e.g. "AWS", "System Design"
  question      TEXT NOT NULL
  answer_framework TEXT NOT NULL
  is_gap_based  BOOLEAN DEFAULT true                  -- true = generated from a missing skill
  order_index   INTEGER NOT NULL
```

**Indexes:**
- `resumes(user_id)`, `tailoring_sessions(user_id)`, `prep_questions(session_id)`

---

## 4. Authentication

**Provider:** Supabase Auth

**Methods:**
- Google OAuth 2.0
- LinkedIn OAuth 2.0
- GitHub OAuth 2.0
- Email + password

**Flow:**
1. User authenticates via Supabase Auth (handled by `@supabase/ssr` in Next.js)
2. Supabase issues a JWT signed with the project JWT secret
3. All FastAPI requests include `Authorization: Bearer <supabase_jwt>`
4. FastAPI verifies the JWT using `SUPABASE_JWT_SECRET` env var — no custom signing logic
5. On first login, a `profiles` row is upserted via a Supabase database trigger on `auth.users`

**Password reset:** Supabase Auth built-in email reset flow (no custom code needed)

**Session management:** `@supabase/ssr` handles cookie-based session refresh automatically in Next.js middleware

---

## 5. AI Engine

### Provider Abstraction

All AI logic lives in `apps/api/app/services/ai_engine/`. The rest of the codebase calls one interface.

```python
# base.py
class AIProvider(ABC):
    @abstractmethod
    async def complete(self, system: str, user: str, json_mode: bool = False) -> str: ...

    @abstractmethod
    async def complete_structured(self, system: str, user: str, schema: type[BaseModel]) -> BaseModel: ...
```

```python
# factory.py
def get_ai_provider() -> AIProvider:
    provider = os.getenv("AI_PROVIDER", "gemini")
    if provider == "openai":
        return OpenAIProvider(model=os.getenv("AI_MODEL_FAST", "gpt-4o-mini"),
                              pro_model=os.getenv("AI_MODEL_PRO", "gpt-4o"))
    if provider == "gemini":
        return GeminiProvider(model=os.getenv("AI_MODEL_FAST", "gemini-2.5-flash"),
                              pro_model=os.getenv("AI_MODEL_PRO", "gemini-2.5-pro"))
    raise ValueError(f"Unknown AI_PROVIDER: {provider}")
```

**Switching providers:** Set `AI_PROVIDER=openai` or `AI_PROVIDER=gemini` in env. No code changes.

### Model Routing

| Task | Model tier | Rationale |
|---|---|---|
| Parse uploaded resume PDF | Fast | Simple structured extraction |
| Extract JD skills | Fast | Classification, not reasoning |
| ATS keyword scoring | Fast | Pattern matching |
| Resume tailoring & rewrite | Pro | Quality-critical reasoning |
| Gap analysis & interview prep | Pro | Nuanced, context-heavy output |

### 4-Step Tailoring Pipeline (`tailoring.py`)

```
Step A: extract_jd_skills(jd_text)
        → {required: str[], nice_to_have: str[]}

Step B: compute_delta(jd_skills, resume_content)
        → {matched: str[], missing: str[], ats_score: int}

Step C: rewrite_bullets(resume_content, matched_skills, humanize_level)
        → tailored_content: dict

Step D: generate_prep_questions(missing_skills, resume_content)
        → PrepQuestion[]
```

Each step is a separate async function. Steps A+B run on the fast model. Steps C+D run on the pro model. The pipeline can be partially re-run (e.g., re-run Step C with a new `humanize_level` without repeating Steps A+B).

**Humanize slider (0–100):** Controls how aggressively matched keywords are woven into bullet points. At 0, output is natural prose that happens to contain keywords. At 100, keywords are front-loaded for maximum ATS density. The prompt instructs the model explicitly — no post-processing.

**JSON Mode:** All structured outputs use `complete_structured()` with Pydantic schema enforcement. No free-form parsing.

---

## 6. PDF Generation

**Server-side only** — WeasyPrint (Python). No client-side PDF rendering.

**Two templates:**
- `ats_clean` — Single column, minimal styling, maximum ATS parse compatibility
- `ats_modern` — Single column, improved typography (font weights, spacing), still fully ATS-safe (no images, no tables, embedded text layer)

**Flow:**
1. User clicks "Download PDF" or "Tailor to JD" (which auto-generates PDF)
2. FastAPI `POST /resumes/{id}/pdf` renders the resume content through the selected Jinja2 HTML template
3. WeasyPrint converts HTML → PDF bytes
4. PDF uploaded to Supabase Storage bucket `resumes/`
5. Storage path saved to `resumes.pdf_url` in DB
6. Signed URL (1-hour expiry) generated on demand from the stored path and returned to frontend
7. Frontend opens the signed URL in the preview iframe or triggers browser download

**ATS Parser View:** Removed. Matched/missing skills are surfaced in the Studio sidebar panel (green/red chip lists with the ATS score ring) — more actionable than a raw text dump.

---

## 7. Web Application

### Pages

| Route | Screen | Description |
|---|---|---|
| `/` | Landing | Unauthenticated marketing page |
| `/(auth)/login` | Login | Supabase Auth UI — Google, LinkedIn, GitHub, email |
| `/(auth)/register` | Register | Email + password registration |
| `/(auth)/callback` | — | Supabase OAuth callback handler |
| `/dashboard` | Dashboard | Bento metrics grid + recent resumes |
| `/studio/[resumeId]` | Resume Studio | Split-screen builder workspace |
| `/jd/[jdId]` | JD Analyzer | ATS score ring + skills delta |
| `/interview/[sessionId]` | Interview Center | Gap-based prep questions |

### Studio Layout

```
┌─────────────────────────┬──────────────────────────┐
│  LEFT PANEL             │  RIGHT PANEL             │
│  Tabs:                  │  PDF preview (iframe)    │
│  Contact | Experience   │  Template selector       │
│  Education | Skills     │  (ats_clean / ats_modern)│
│                         │                          │
│  JD Context (collapse)  │  ATS Score ring          │
│                         │  Matched ✓  Missing ✗    │
│  AI Tools:              │                          │
│  • Humanize slider      │  [Download PDF]          │
│  • [Tailor to JD]       │  [Generate Prep]         │
│  • Missing skills list  │                          │
└─────────────────────────┴──────────────────────────┘
```

### State Management

```typescript
// resume-store.ts
useResumeStore {
  resumeId: string
  content: ResumeContent       // sections object
  templateId: string
  isDirty: boolean
  updateSection(section, data): void
  saveResume(): Promise<void>  // debounced 2s auto-save → PATCH /resumes/{id}
}

// tailoring-store.ts
useTailoringStore {
  jdText: string
  sessionId: string | null
  atsScore: number | null
  matchedSkills: string[]
  missingSkills: string[]
  humanizeLevel: number        // 0–100
  tailoredContent: ResumeContent | null
  runTailoring(): Promise<void>  // POST /ai/tailor
}
```

**Data fetching:** React Query for all server state (resume list, session data, prep questions). Zustand for local editor state only.

**PDF preview:** Refreshes only on explicit save or "Tailor to JD" — not on every keystroke.

### Sidebar Navigation

Dashboard | Resume Builder | JD Analyzer | Interview Center | Settings | Support

Active state: `secondary-container` fill + `primary` text + `scale-95` on press.

---

## 8. Design System

**Source of truth:** HTML reference files in `apps/web/design-refs/` (committed from the provided Stitch export).

| Token | Value |
|---|---|
| Font | Hanken Grotesk (via `next/font/google`) |
| Icons | `@phosphor-icons/react` |
| Primary | `#000a56` |
| Background | `#faf8ff` |
| Surface lowest | `#ffffff` |
| Surface container | `#eaedff` |
| On-surface | `#131b2e` |
| Outline variant | `#c6c5d3` |
| Secondary container | `#d4e3ff` |
| Border radius (cards) | `rounded-2xl` (16px) |
| Border radius (buttons) | `rounded-lg` (8px) |
| Sidebar width | `280px` |
| Max canvas width | `1440px` |
| Gutter | `24px` |

All Tailwind color, spacing, fontSize, and borderRadius tokens are ported verbatim from the Stitch HTML configs into `tailwind.config.ts`. Components are built to pixel-match the reference screens.

---

## 9. Deployment (Free Tier)

| Service | Platform | Free tier limits |
|---|---|---|
| Next.js web app | Vercel | 100GB bandwidth/month |
| FastAPI backend | Railway | 500 hours/month, 512MB RAM |
| PostgreSQL + Storage | Supabase | 500MB DB, 1GB Storage, 50k MAU |
| Emails (password reset) | Supabase Auth built-in | — |

**Environment variables (`.env.example`):**
```
# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=

# AI Provider
AI_PROVIDER=gemini               # 'gemini' | 'openai'
AI_MODEL_FAST=gemini-2.5-flash
AI_MODEL_PRO=gemini-2.5-pro
GEMINI_API_KEY=
OPENAI_API_KEY=                  # optional, only if AI_PROVIDER=openai

# Database
DATABASE_URL=                    # Supabase PostgreSQL connection string

# Web
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_API_URL=             # Railway FastAPI URL
```

---

## 10. Out of Scope (V1)

- Android application
- AI Career Intelligence / Company Intelligence features
- Conversational AI Coach
- OneDrive integration
- Google Drive storage integration
- Job tracking pipeline
- Chrome extension

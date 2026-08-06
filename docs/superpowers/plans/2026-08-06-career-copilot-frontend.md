# Career Copilot — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Next.js 14 web application — auth, dashboard, resume studio, JD analyzer, and interview center — pixel-matched to the provided Stitch design reference screens.

**Architecture:** Next.js 14 App Router with Supabase Auth (`@supabase/ssr`), Zustand for editor state, React Query for server state, Tailwind CSS with design tokens ported verbatim from Stitch HTML exports. All AI and data calls go through a typed `api-client.ts` that talks to the FastAPI backend.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, Zustand, @tanstack/react-query, @supabase/ssr, @supabase/supabase-js, @phosphor-icons/react, Radix UI, next/font/google (Hanken Grotesk)

**Dependency:** Backend plan must be complete — all FastAPI endpoints available at `NEXT_PUBLIC_API_URL`.

## Global Constraints

- Next.js 14 App Router only — no Pages Router
- All color/spacing/font tokens copied verbatim from `design-refs/` HTML files into `tailwind.config.ts`
- Font: Hanken Grotesk via `next/font/google` — no CDN
- Icons: `@phosphor-icons/react` — no CDN
- No client-side PDF rendering — PDF preview uses `<iframe src={signedUrl}>`
- PDF preview only refreshes on explicit save or "Tailor to JD" action
- All FastAPI calls include `Authorization: Bearer <supabase_access_token>` from the active session
- Zustand for editor/tailoring local state; React Query for all server-fetched data

---

## File Map

```
apps/web/
├── app/
│   ├── layout.tsx                     ← Root layout: font, React Query provider, Supabase session
│   ├── page.tsx                       ← Landing page (unauthenticated)
│   ├── middleware.ts                  ← Supabase session refresh on every request
│   ├── (auth)/
│   │   ├── login/page.tsx             ← Login form + OAuth buttons
│   │   ├── register/page.tsx          ← Email/password registration form
│   │   └── callback/route.ts          ← Supabase OAuth code exchange
│   ├── dashboard/
│   │   └── page.tsx                   ← Bento metrics + recent resumes grid
│   ├── studio/
│   │   └── [resumeId]/page.tsx        ← Split-screen resume builder
│   ├── jd/
│   │   └── [jdId]/page.tsx            ← JD analyzer: score ring + skills delta
│   └── interview/
│       └── [sessionId]/page.tsx       ← Prep questions viewer
├── components/
│   ├── ui/
│   │   ├── Button.tsx                 ← Primary/ghost variants
│   │   ├── Card.tsx                   ← White card with border + shadow
│   │   ├── Input.tsx                  ← Styled text input
│   │   ├── Slider.tsx                 ← Radix UI slider (humanize control)
│   │   ├── Badge.tsx                  ← Pill badge (matched/missing skills)
│   │   └── ScoreRing.tsx              ← SVG circular progress ring
│   ├── layout/
│   │   ├── Sidebar.tsx                ← Fixed 280px nav sidebar
│   │   └── TopNav.tsx                 ← Mobile top bar
│   ├── resume/
│   │   ├── EditorPanel.tsx            ← Left panel: tabbed form editor
│   │   ├── PreviewPanel.tsx           ← Right panel: PDF iframe + controls
│   │   ├── SkillsDelta.tsx            ← Matched (green) / Missing (red) chip lists
│   │   └── HumanizeSlider.tsx         ← Labeled slider 0–100
│   └── interview/
│       ├── QuestionCard.tsx           ← Single question + answer framework card
│       └── TopicList.tsx              ← Sidebar list of topics with completion dots
├── lib/
│   ├── api-client.ts                  ← Typed fetch wrapper → FastAPI
│   └── supabase.ts                    ← Browser + server Supabase clients
├── stores/
│   ├── resume-store.ts                ← Zustand: content, isDirty, auto-save
│   └── tailoring-store.ts             ← Zustand: jdText, session, humanizeLevel
├── design-refs/                       ← HTML reference screens (read-only, committed)
│   ├── dashboard.html
│   ├── resume_studio.html
│   ├── jd_analyzer.html
│   └── interview_center.html
├── middleware.ts
├── tailwind.config.ts
├── next.config.ts
└── package.json
```

---

### Task 1: Next.js scaffold + Tailwind design tokens

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/design-refs/` (copy HTML files from Stitch export)

- [ ] **Step 1: Scaffold Next.js app**

```bash
cd apps && npx create-next-app@latest web \
  --typescript --tailwind --app --no-src-dir \
  --import-alias "@/*" --no-eslint
```

- [ ] **Step 2: Install dependencies**

```bash
cd apps/web && npm install \
  @supabase/supabase-js @supabase/ssr \
  @tanstack/react-query \
  zustand \
  @phosphor-icons/react \
  @radix-ui/react-slider @radix-ui/react-tabs @radix-ui/react-collapsible \
  @radix-ui/react-dialog @radix-ui/react-toast
```

- [ ] **Step 3: Copy design reference files**

```bash
cp /tmp/stitch_ui/stitch_modernized_web_interface_redesign/dashboard_career_copilot/code.html \
   apps/web/design-refs/dashboard.html
cp /tmp/stitch_ui/stitch_modernized_web_interface_redesign/resume_studio_career_copilot/code.html \
   apps/web/design-refs/resume_studio.html
cp /tmp/stitch_ui/stitch_modernized_web_interface_redesign/jd_analyzer_career_copilot/code.html \
   apps/web/design-refs/jd_analyzer.html
cp /tmp/stitch_ui/stitch_modernized_web_interface_redesign/interview_center_career_copilot/code.html \
   apps/web/design-refs/interview_center.html
```

- [ ] **Step 4: Replace tailwind.config.ts with design tokens**

`apps/web/tailwind.config.ts`:
```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "primary": "#000a56",
        "surface-container": "#eaedff",
        "tertiary-container": "#292c2e",
        "tertiary-fixed": "#e1e3e5",
        "background": "#faf8ff",
        "primary-container": "#142175",
        "surface-container-high": "#e1e7ff",
        "inverse-on-surface": "#eef0ff",
        "tertiary-fixed-dim": "#c5c7c9",
        "inverse-primary": "#bcc3ff",
        "on-tertiary-container": "#919395",
        "on-error": "#ffffff",
        "primary-fixed-dim": "#bcc3ff",
        "secondary": "#505f76",
        "on-primary-fixed": "#000d60",
        "on-tertiary": "#ffffff",
        "error": "#ba1a1a",
        "surface-dim": "#d2d9f4",
        "on-primary-fixed-variant": "#333f91",
        "on-background": "#131b2e",
        "error-container": "#ffdad6",
        "on-surface-variant": "#454651",
        "surface-tint": "#4b57aa",
        "outline-variant": "#c6c5d3",
        "surface-container-low": "#f2f3ff",
        "secondary-fixed-dim": "#b8c7e2",
        "surface-bright": "#faf8ff",
        "on-error-container": "#93000a",
        "on-tertiary-fixed": "#191c1e",
        "secondary-container": "#d4e3ff",
        "on-primary": "#ffffff",
        "surface-container-highest": "#dae2fc",
        "on-surface": "#131b2e",
        "on-primary-container": "#818de4",
        "primary-fixed": "#dfe0ff",
        "surface": "#faf8ff",
        "on-tertiary-fixed-variant": "#444749",
        "on-secondary-fixed-variant": "#39485e",
        "on-secondary": "#ffffff",
        "surface-container-lowest": "#ffffff",
        "inverse-surface": "#283044",
        "surface-variant": "#dae2fc",
        "outline": "#767682",
        "success-accent": "#4b57aa",
        "tertiary": "#151819",
        "on-secondary-container": "#56657c",
        "secondary-fixed": "#d4e3ff",
        "on-secondary-fixed": "#0c1c30",
      },
      borderRadius: {
        DEFAULT: "0.25rem",
        lg: "0.5rem",
        xl: "0.75rem",
        "2xl": "1rem",
        full: "9999px",
      },
      spacing: {
        lg: "24px",
        gutter: "24px",
        xl: "32px",
        sm: "8px",
        md: "16px",
        xxl: "48px",
        xs: "4px",
        "sidebar-width": "280px",
      },
      fontSize: {
        "headline-xl": ["36px", { lineHeight: "1.2", fontWeight: "700", letterSpacing: "-0.02em" }],
        "headline-lg": ["28px", { lineHeight: "1.3", fontWeight: "600" }],
        "headline-md": ["22px", { lineHeight: "1.4", fontWeight: "600" }],
        "body-lg": ["18px", { lineHeight: "1.6", fontWeight: "400" }],
        "body-md": ["16px", { lineHeight: "1.6", fontWeight: "400" }],
        "body-sm": ["14px", { lineHeight: "1.5", fontWeight: "400" }],
        "label-md": ["14px", { lineHeight: "1.2", fontWeight: "600", letterSpacing: "0.05em" }],
        "label-sm": ["12px", { lineHeight: "1.2", fontWeight: "500" }],
        "caption": ["10px", { lineHeight: "1.2", fontWeight: "600" }],
      },
    },
  },
  plugins: [],
};
export default config;
```

- [ ] **Step 5: Create root layout with Hanken Grotesk and providers**

`apps/web/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import { Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-hanken",
});

export const metadata: Metadata = {
  title: "Career Copilot",
  description: "AI-powered resume tailoring and interview prep",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={hanken.variable}>
      <body className="bg-background text-on-background font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 6: Create providers.tsx (React Query)**

`apps/web/app/providers.tsx`:
```tsx
"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000 } },
  }));
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 7: Add font to globals.css**

`apps/web/app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  font-family: var(--font-hanken), sans-serif;
}
```

- [ ] **Step 8: Verify dev server starts**

```bash
cd apps/web && npm run dev
```
Open `http://localhost:3000` — should show default Next.js page with no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/web/
git commit -m "feat(web): scaffold Next.js 14 app with design token Tailwind config"
```

---

### Task 2: Supabase auth integration

**Files:**
- Create: `apps/web/lib/supabase.ts`
- Create: `apps/web/middleware.ts`
- Create: `apps/web/app/(auth)/login/page.tsx`
- Create: `apps/web/app/(auth)/register/page.tsx`
- Create: `apps/web/app/(auth)/callback/route.ts`
- Create: `apps/web/.env.local` (from `.env.example`)

**Interfaces:**
- Produces: `createBrowserClient()` — used in client components
- Produces: `createServerClient()` — used in server components and middleware

- [ ] **Step 1: Set up .env.local**

Copy `.env.example` to `apps/web/.env.local` and fill in:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_API_URL=http://localhost:8000
```

- [ ] **Step 2: Create supabase.ts**

`apps/web/lib/supabase.ts`:
```typescript
import { createBrowserClient as _createBrowserClient } from "@supabase/ssr";

export function createBrowserClient() {
  return _createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 3: Create middleware.ts for session refresh**

`apps/web/middleware.ts`:
```typescript
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 4: Create OAuth callback route**

`apps/web/app/(auth)/callback/route.ts`:
```typescript
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (cs) => cs.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
        },
      }
    );
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL("/dashboard", request.url));
}
```

- [ ] **Step 5: Create login page**

`apps/web/app/(auth)/login/page.tsx`:
```tsx
"use client";
import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();
  const supabase = createBrowserClient();

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError(error.message); return; }
    router.push("/dashboard");
  }

  async function handleOAuth(provider: "google" | "linkedin_oidc" | "github") {
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-gutter">
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-lg p-xl w-full max-w-md">
        <div className="flex items-center gap-md mb-xl">
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
            <span className="text-on-primary text-lg font-bold">C</span>
          </div>
          <h1 className="text-headline-md text-on-surface font-bold">Career Copilot</h1>
        </div>
        <h2 className="text-headline-lg text-on-surface mb-md">Sign in</h2>
        {error && <p className="text-error text-body-sm mb-md">{error}</p>}
        <form onSubmit={handleEmailLogin} className="flex flex-col gap-md mb-lg">
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="Email" required
            className="w-full px-md py-md rounded-lg border border-outline-variant bg-surface text-on-surface text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Password" required
            className="w-full px-md py-md rounded-lg border border-outline-variant bg-surface text-on-surface text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button type="submit" className="w-full py-md rounded-lg font-label-md text-label-md text-on-primary bg-gradient-to-b from-primary-container to-primary shadow-md hover:shadow-lg transition-all">
            Sign in with Email
          </button>
        </form>
        <div className="flex flex-col gap-sm">
          {(["google", "github", "linkedin_oidc"] as const).map(p => (
            <button key={p} onClick={() => handleOAuth(p)}
              className="w-full py-md rounded-lg border border-outline-variant text-on-surface-variant text-label-md font-label-md hover:bg-surface-container-low transition-colors capitalize">
              Continue with {p === "linkedin_oidc" ? "LinkedIn" : p}
            </button>
          ))}
        </div>
        <p className="text-body-sm text-on-surface-variant mt-lg text-center">
          No account? <a href="/register" className="text-primary font-semibold">Register</a>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create register page**

`apps/web/app/(auth)/register/page.tsx`:
```tsx
"use client";
import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const supabase = createBrowserClient();

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: name } },
    });
    if (error) { setError(error.message); return; }
    setSuccess(true);
  }

  if (success) return (
    <div className="min-h-screen bg-background flex items-center justify-center p-gutter">
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-lg p-xl text-center max-w-md w-full">
        <p className="text-headline-md text-on-surface font-bold mb-sm">Check your email</p>
        <p className="text-body-md text-on-surface-variant">We sent a confirmation link to <strong>{email}</strong>.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-gutter">
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-lg p-xl w-full max-w-md">
        <h2 className="text-headline-lg text-on-surface mb-md font-bold">Create account</h2>
        {error && <p className="text-error text-body-sm mb-md">{error}</p>}
        <form onSubmit={handleRegister} className="flex flex-col gap-md">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" required
            className="w-full px-md py-md rounded-lg border border-outline-variant bg-surface text-on-surface text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" required
            className="w-full px-md py-md rounded-lg border border-outline-variant bg-surface text-on-surface text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password (min 8 chars)" minLength={8} required
            className="w-full px-md py-md rounded-lg border border-outline-variant bg-surface text-on-surface text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30" />
          <button type="submit" className="w-full py-md rounded-lg font-label-md text-label-md text-on-primary bg-gradient-to-b from-primary-container to-primary shadow-md hover:shadow-lg transition-all">
            Create Account
          </button>
        </form>
        <p className="text-body-sm text-on-surface-variant mt-lg text-center">
          Have an account? <a href="/login" className="text-primary font-semibold">Sign in</a>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Enable OAuth providers in Supabase dashboard**

In Supabase dashboard → Authentication → Providers:
- Enable Google (add Client ID + Secret from Google Cloud Console)
- Enable GitHub (add Client ID + Secret from GitHub OAuth Apps)
- Enable LinkedIn OIDC (add Client ID + Secret from LinkedIn Developer Portal)

Set callback URL in each provider: `https://<your-project>.supabase.co/auth/v1/callback`

- [ ] **Step 8: Test login flow manually**

```bash
cd apps/web && npm run dev
```
1. Open `http://localhost:3000/login`
2. Register a test account at `/register`
3. Confirm email and sign in — should redirect to `/dashboard` (404 for now)
4. Verify session cookie is set in browser DevTools

- [ ] **Step 9: Commit**

```bash
git add apps/web/lib/ apps/web/middleware.ts apps/web/app/\(auth\)/ apps/web/.env.local
git commit -m "feat(web): add Supabase auth — email + Google + GitHub + LinkedIn"
```

---

### Task 3: API client + Zustand stores

**Files:**
- Create: `apps/web/lib/api-client.ts`
- Create: `apps/web/stores/resume-store.ts`
- Create: `apps/web/stores/tailoring-store.ts`

**Interfaces:**
- Produces: `apiClient.get/post/patch/delete(path, body?)` — used by all pages and stores
- Produces: `useResumeStore` — used by EditorPanel, PreviewPanel
- Produces: `useTailoringStore` — used by EditorPanel, PreviewPanel, JD page

- [ ] **Step 1: Create api-client.ts**

`apps/web/lib/api-client.ts`:
```typescript
import { createBrowserClient } from "@/lib/supabase";

const BASE = process.env.NEXT_PUBLIC_API_URL!;

async function getToken(): Promise<string> {
  const supabase = createBrowserClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return session.access_token;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Request failed");
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const apiClient = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  delete: (path: string) => request<void>("DELETE", path),
};
```

- [ ] **Step 2: Initialize packages/types**

```bash
mkdir -p packages/types
```

`packages/types/package.json`:
```json
{
  "name": "@career-copilot/types",
  "version": "0.1.0",
  "main": "./index.ts",
  "types": "./index.ts",
  "private": true
}
```

Add to `apps/web/package.json` dependencies:
```json
"@career-copilot/types": "*"
```

- [ ] **Step 3: Create shared types**

`packages/types/index.ts`:
```typescript
export interface ResumeContent {
  contact: { name: string; email: string; phone: string; location: string };
  experience: Array<{ company: string; title: string; dates: string; bullets: string[] }>;
  education: Array<{ school: string; degree: string; dates: string }>;
  skills: string[];
}

export interface Resume {
  id: string;
  user_id: string;
  title: string;
  content: ResumeContent;
  template_id: "ats_clean" | "ats_modern";
  pdf_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface TailorOut {
  session_id: string;
  ats_score: number;
  matched_skills: string[];
  missing_skills: string[];
  tailored_content: ResumeContent;
  questions: PrepQuestionOut[];
}

export interface PrepQuestionOut {
  id: string;
  session_id: string;
  topic: string;
  question: string;
  answer_framework: string;
  is_gap_based: boolean;
  order_index: number;
}
```

- [ ] **Step 3: Create resume-store.ts**

`apps/web/stores/resume-store.ts`:
```typescript
import { create } from "zustand";
import { apiClient } from "@/lib/api-client";
import type { Resume, ResumeContent } from "@career-copilot/types";

interface ResumeState {
  resumeId: string | null;
  content: ResumeContent;
  templateId: "ats_clean" | "ats_modern";
  isDirty: boolean;
  pdfSignedUrl: string | null;
  _saveTimer: ReturnType<typeof setTimeout> | null;
  setResume: (resume: Resume) => void;
  updateSection: (section: keyof ResumeContent, data: unknown) => void;
  setTemplate: (id: "ats_clean" | "ats_modern") => void;
  saveResume: () => Promise<void>;
  generatePdf: () => Promise<void>;
}

const EMPTY_CONTENT: ResumeContent = {
  contact: { name: "", email: "", phone: "", location: "" },
  experience: [],
  education: [],
  skills: [],
};

export const useResumeStore = create<ResumeState>((set, get) => ({
  resumeId: null,
  content: EMPTY_CONTENT,
  templateId: "ats_clean",
  isDirty: false,
  pdfSignedUrl: null,
  _saveTimer: null,

  setResume: (resume) => set({
    resumeId: resume.id,
    content: resume.content as ResumeContent,
    templateId: resume.template_id,
    isDirty: false,
  }),

  updateSection: (section, data) => {
    set(s => ({ content: { ...s.content, [section]: data }, isDirty: true }));
    // debounced auto-save
    const prev = get()._saveTimer;
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => get().saveResume(), 2000);
    set({ _saveTimer: timer });
  },

  setTemplate: (id) => set({ templateId: id, isDirty: true }),

  saveResume: async () => {
    const { resumeId, content, templateId } = get();
    if (!resumeId) return;
    await apiClient.patch(`/resumes/${resumeId}`, { content, template_id: templateId });
    set({ isDirty: false });
  },

  generatePdf: async () => {
    const { resumeId } = get();
    if (!resumeId) return;
    const { signed_url } = await apiClient.post<{ signed_url: string }>(`/resumes/${resumeId}/pdf`, {});
    set({ pdfSignedUrl: signed_url });
  },
}));
```

- [ ] **Step 4: Create tailoring-store.ts**

`apps/web/stores/tailoring-store.ts`:
```typescript
import { create } from "zustand";
import { apiClient } from "@/lib/api-client";
import type { TailorOut } from "@career-copilot/types";
import { useResumeStore } from "./resume-store";

interface TailoringState {
  jdId: string | null;
  jdText: string;
  sessionId: string | null;
  atsScore: number | null;
  matchedSkills: string[];
  missingSkills: string[];
  humanizeLevel: number;
  isLoading: boolean;
  error: string | null;
  setJdText: (text: string) => void;
  setJdId: (id: string) => void;
  setHumanizeLevel: (level: number) => void;
  runTailoring: () => Promise<void>;
}

export const useTailoringStore = create<TailoringState>((set, get) => ({
  jdId: null,
  jdText: "",
  sessionId: null,
  atsScore: null,
  matchedSkills: [],
  missingSkills: [],
  humanizeLevel: 50,
  isLoading: false,
  error: null,

  setJdText: (text) => set({ jdText: text }),
  setJdId: (id) => set({ jdId: id }),
  setHumanizeLevel: (level) => set({ humanizeLevel: level }),

  runTailoring: async () => {
    const { jdId, humanizeLevel } = get();
    const resumeId = useResumeStore.getState().resumeId;
    if (!resumeId || !jdId) return;

    set({ isLoading: true, error: null });
    try {
      const result = await apiClient.post<TailorOut>("/ai/tailor", {
        resume_id: resumeId,
        jd_id: jdId,
        humanize_level: humanizeLevel,
      });
      set({
        sessionId: result.session_id,
        atsScore: result.ats_score,
        matchedSkills: result.matched_skills,
        missingSkills: result.missing_skills,
      });
      // update editor with tailored content + regenerate PDF
      useResumeStore.getState().updateSection("experience", result.tailored_content.experience);
      await useResumeStore.getState().generatePdf();
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : "Tailoring failed" });
    } finally {
      set({ isLoading: false });
    }
  },
}));
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/api-client.ts apps/web/stores/ packages/types/
git commit -m "feat(web): add typed API client and Zustand stores"
```

---

### Task 4: Layout components (Sidebar + TopNav)

**Files:**
- Create: `apps/web/components/layout/Sidebar.tsx`
- Create: `apps/web/components/layout/TopNav.tsx`
- Create: `apps/web/app/dashboard/layout.tsx` (authenticated shell)

**Reference:** `design-refs/dashboard.html` lines 108–161 (sidebar), 163–180 (mobile top nav)

- [ ] **Step 1: Create Sidebar.tsx**

`apps/web/components/layout/Sidebar.tsx`:
```tsx
"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  SquaresFour, FileDashed, FileText, Brain, Gear, Headset, RocketLaunch
} from "@phosphor-icons/react";
import { createBrowserClient } from "@/lib/supabase";

const NAV = [
  { href: "/dashboard", icon: SquaresFour, label: "Dashboard" },
  { href: "/resumes", icon: FileText, label: "Resume Builder" },
  { href: "/jd", icon: FileDashed, label: "JD Analyzer" },
  { href: "/interview", icon: Brain, label: "Interview Center" },
];

const BOTTOM = [
  { href: "/settings", icon: Gear, label: "Settings" },
  { href: "/support", icon: Headset, label: "Support" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createBrowserClient();

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  function NavItem({ href, icon: Icon, label }: { href: string; icon: typeof SquaresFour; label: string }) {
    const active = pathname === href || pathname.startsWith(href + "/");
    return (
      <Link href={href}
        className={`flex items-center gap-md px-md py-md rounded-xl text-label-md font-label-md transition-all duration-300 ${
          active
            ? "bg-secondary-container text-primary font-bold shadow-sm"
            : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/40"
        }`}>
        <Icon size={24} weight={active ? "fill" : "regular"} />
        <span>{label}</span>
      </Link>
    );
  }

  return (
    <aside className="hidden md:flex flex-col p-md gap-sm bg-surface-container-lowest/80 backdrop-blur-xl h-screen w-sidebar-width left-0 fixed border-r border-outline-variant/20 shadow-sm z-50">
      <div className="flex items-center gap-md px-md py-lg mb-md">
        <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center shadow-lg shadow-primary/20">
          <RocketLaunch size={20} weight="fill" className="text-on-primary" />
        </div>
        <div>
          <p className="text-headline-md font-black text-primary">Career Copilot</p>
          <p className="text-caption text-secondary uppercase tracking-wider">Pro</p>
        </div>
      </div>
      <nav className="flex-1 flex flex-col gap-sm">
        {NAV.map(item => <NavItem key={item.href} {...item} />)}
      </nav>
      <div className="mt-auto flex flex-col gap-sm pb-md">
        <button onClick={signOut}
          className="w-full py-md rounded-xl text-label-md font-label-md text-on-primary bg-gradient-to-b from-primary-container to-primary shadow-md hover:shadow-lg transition-all mb-md">
          Sign Out
        </button>
        {BOTTOM.map(item => <NavItem key={item.href} {...item} />)}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Create TopNav.tsx (mobile)**

`apps/web/components/layout/TopNav.tsx`:
```tsx
"use client";
import { Bell, List, RocketLaunch } from "@phosphor-icons/react";

export function TopNav() {
  return (
    <header className="md:hidden flex justify-between items-center w-full px-lg h-16 bg-surface/80 backdrop-blur-md sticky top-0 z-40 border-b border-outline-variant/30 shadow-sm">
      <div className="flex items-center gap-sm">
        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shadow-lg shadow-primary/20">
          <RocketLaunch size={18} weight="fill" className="text-on-primary" />
        </div>
        <span className="text-headline-md font-bold text-primary">Career Copilot</span>
      </div>
      <div className="flex items-center gap-md">
        <button className="text-on-surface-variant hover:bg-surface-container-high/50 p-sm rounded-full transition-colors">
          <Bell size={24} />
        </button>
        <button className="text-on-surface-variant hover:bg-surface-container-high/50 p-sm rounded-full transition-colors">
          <List size={24} />
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: Create authenticated app shell layout**

`apps/web/app/(app)/layout.tsx`:
```tsx
import { Sidebar } from "@/components/layout/Sidebar";
import { TopNav } from "@/components/layout/TopNav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background text-on-background h-full flex flex-col md:flex-row overflow-hidden">
      <Sidebar />
      <main className="flex-1 md:ml-[280px] flex flex-col h-screen overflow-y-auto w-full">
        <TopNav />
        {children}
      </main>
    </div>
  );
}
```

Move dashboard, studio, jd, interview routes under `app/(app)/` to use this layout.

- [ ] **Step 4: Verify layout renders correctly**

```bash
cd apps/web && npm run dev
```
Sign in and navigate to `/dashboard` — sidebar should appear on desktop, top nav on mobile.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/layout/ apps/web/app/\(app\)/
git commit -m "feat(web): add Sidebar and TopNav layout shell"
```

---

### Task 5: Dashboard page

**Files:**
- Create: `apps/web/app/(app)/dashboard/page.tsx`
- Create: `apps/web/components/ui/Card.tsx`
- Create: `apps/web/components/ui/ScoreRing.tsx`

**Reference:** `design-refs/dashboard.html` — bento grid with 4 metric cards + JD input CTA

- [ ] **Step 1: Create Card.tsx**

`apps/web/components/ui/Card.tsx`:
```tsx
import { cn } from "@/lib/utils";

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      "bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 hover:shadow-xl hover:shadow-on-surface/10 transition-shadow",
      className
    )}>
      {children}
    </div>
  );
}
```

Create `apps/web/lib/utils.ts`:
```typescript
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

```bash
cd apps/web && npm install clsx tailwind-merge
```

- [ ] **Step 2: Create ScoreRing.tsx**

`apps/web/components/ui/ScoreRing.tsx`:
```tsx
export function ScoreRing({ score, size = 80 }: { score: number; size?: number }) {
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="#eaedff" strokeWidth={10} fill="none" />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        stroke="#000a56" strokeWidth={10} fill="none"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle"
        className="text-headline-md fill-on-surface font-bold" fontSize={size / 4}>
        {score}
      </text>
    </svg>
  );
}
```

- [ ] **Step 3: Create dashboard page**

`apps/web/app/(app)/dashboard/page.tsx`:
```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileDashed, Brain, Heartbeat, Briefcase } from "@phosphor-icons/react";
import { Card } from "@/components/ui/Card";
import { apiClient } from "@/lib/api-client";
import type { Resume } from "@career-copilot/types";

export default function DashboardPage() {
  const router = useRouter();
  const [jdText, setJdText] = useState("");
  const { data: resumes = [] } = useQuery({
    queryKey: ["resumes"],
    queryFn: () => apiClient.get<Resume[]>("/resumes"),
  });

  async function handleStartTailoring() {
    if (!jdText.trim()) return;
    const jd = await apiClient.post<{ id: string }>("/jd", { raw_text: jdText });
    router.push(`/jd/${jd.id}`);
  }

  async function createNewResume() {
    const resume = await apiClient.post<Resume>("/resumes", { title: "Untitled Resume", content: {} });
    router.push(`/studio/${resume.id}`);
  }

  const metrics = [
    { label: "Profile Health", value: "92", badge: "Excellent", icon: Heartbeat, barWidth: "92%" },
    { label: "Tailored Resumes", value: String(resumes.length), badge: "Versions saved", icon: FileDashed, barWidth: null },
    { label: "Active Applications", value: "—", badge: "Track in V2", icon: Briefcase, barWidth: null },
    { label: "Interview Readiness", value: "—", badge: "After tailoring", icon: Brain, barWidth: null },
  ];

  return (
    <div className="max-w-[1440px] w-full mx-auto p-gutter pb-xxl flex flex-col gap-xl">
      <section className="pt-xl pb-md">
        <h1 className="text-headline-xl text-on-surface mb-sm">Welcome back!</h1>
        <p className="text-body-lg text-on-surface-variant">Paste a job description to start tailoring your resume.</p>
      </section>

      {/* JD input CTA */}
      <Card className="flex flex-col gap-md">
        <p className="text-label-md text-on-surface-variant uppercase tracking-wider">Start Tailoring</p>
        <textarea
          value={jdText} onChange={e => setJdText(e.target.value)}
          placeholder="Paste the job description here…"
          rows={5}
          className="w-full px-md py-md rounded-lg border border-outline-variant bg-surface text-on-surface text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
        />
        <div className="flex gap-md">
          <button onClick={handleStartTailoring}
            className="px-xl py-md rounded-lg text-label-md font-label-md text-on-primary bg-gradient-to-b from-primary-container to-primary shadow-md hover:shadow-lg transition-all">
            Analyze JD
          </button>
          <button onClick={createNewResume}
            className="px-xl py-md rounded-lg text-label-md font-label-md text-on-surface-variant border border-outline-variant hover:bg-surface-container-low transition-colors">
            New Resume
          </button>
        </div>
      </Card>

      {/* Metrics bento */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-gutter">
        {metrics.map(({ label, value, badge, icon: Icon, barWidth }) => (
          <Card key={label} className="flex flex-col justify-between h-32 relative overflow-hidden">
            <div className="flex justify-between items-start">
              <span className="text-label-md text-on-surface-variant">{label}</span>
              <div className="w-8 h-8 rounded-full bg-secondary-container/50 flex items-center justify-center">
                <Icon size={20} weight="fill" className="text-primary" />
              </div>
            </div>
            <div className="flex items-baseline gap-sm">
              <span className="text-headline-xl text-on-surface">{value}</span>
              <span className="text-label-sm text-success-accent">{badge}</span>
            </div>
            {barWidth && (
              <div className="absolute bottom-0 left-0 w-full h-1 bg-surface-variant">
                <div className="h-full bg-primary rounded-r-full" style={{ width: barWidth }} />
              </div>
            )}
          </Card>
        ))}
      </section>

      {/* Recent resumes */}
      {resumes.length > 0 && (
        <section>
          <h2 className="text-headline-md text-on-surface mb-lg">Recent Resumes</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">
            {resumes.map(r => (
              <Card key={r.id} className="cursor-pointer hover:border-primary/30 transition-colors"
                onClick={() => router.push(`/studio/${r.id}`)}>
                <p className="text-label-md text-on-surface font-semibold mb-sm">{r.title}</p>
                <p className="text-body-sm text-on-surface-variant">{r.template_id}</p>
                <p className="text-caption text-on-surface-variant mt-sm">{new Date(r.updated_at).toLocaleDateString()}</p>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify dashboard renders**

```bash
cd apps/web && npm run dev
```
Sign in → `/dashboard`. Bento grid should show. JD input should be visible.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/\(app\)/dashboard/ apps/web/components/ui/
git commit -m "feat(web): add dashboard page with bento metrics and JD input"
```

---

### Task 6: Resume Studio page

**Files:**
- Create: `apps/web/app/(app)/studio/[resumeId]/page.tsx`
- Create: `apps/web/components/resume/EditorPanel.tsx`
- Create: `apps/web/components/resume/PreviewPanel.tsx`
- Create: `apps/web/components/resume/SkillsDelta.tsx`
- Create: `apps/web/components/resume/HumanizeSlider.tsx`

**Reference:** `design-refs/resume_studio.html`

- [ ] **Step 1: Create HumanizeSlider.tsx**

`apps/web/components/resume/HumanizeSlider.tsx`:
```tsx
"use client";
import * as RadixSlider from "@radix-ui/react-slider";
import { useTailoringStore } from "@/stores/tailoring-store";

export function HumanizeSlider() {
  const { humanizeLevel, setHumanizeLevel } = useTailoringStore();
  return (
    <div className="flex flex-col gap-sm">
      <div className="flex justify-between">
        <span className="text-label-md text-on-surface-variant">Humanize Level</span>
        <span className="text-label-md text-primary font-bold">{humanizeLevel}</span>
      </div>
      <div className="flex items-center justify-between text-caption text-on-surface-variant mb-xs">
        <span>Natural</span><span>ATS Max</span>
      </div>
      <RadixSlider.Root
        value={[humanizeLevel]} onValueChange={([v]) => setHumanizeLevel(v)}
        min={0} max={100} step={5}
        className="relative flex items-center w-full h-5">
        <RadixSlider.Track className="bg-surface-variant relative grow rounded-full h-2">
          <RadixSlider.Range className="absolute bg-primary rounded-full h-full" />
        </RadixSlider.Track>
        <RadixSlider.Thumb className="block w-5 h-5 bg-primary rounded-full shadow-md focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </RadixSlider.Root>
    </div>
  );
}
```

- [ ] **Step 2: Create SkillsDelta.tsx**

`apps/web/components/resume/SkillsDelta.tsx`:
```tsx
"use client";
import { useTailoringStore } from "@/stores/tailoring-store";
import { CheckCircle, XCircle } from "@phosphor-icons/react";

export function SkillsDelta() {
  const { atsScore, matchedSkills, missingSkills } = useTailoringStore();
  if (atsScore === null) return null;
  return (
    <div className="flex flex-col gap-md">
      <div className="flex items-center justify-between">
        <span className="text-label-md text-on-surface-variant">ATS Score</span>
        <span className="text-headline-md text-primary font-bold">{atsScore}%</span>
      </div>
      {matchedSkills.length > 0 && (
        <div>
          <p className="text-label-sm text-on-surface-variant mb-sm">Matched</p>
          <div className="flex flex-wrap gap-sm">
            {matchedSkills.map(s => (
              <span key={s} className="flex items-center gap-xs px-sm py-xs rounded-full bg-[#e6f4ea] text-[#1e7e34] text-label-sm">
                <CheckCircle size={12} weight="fill" />{s}
              </span>
            ))}
          </div>
        </div>
      )}
      {missingSkills.length > 0 && (
        <div>
          <p className="text-label-sm text-on-surface-variant mb-sm">Missing</p>
          <div className="flex flex-wrap gap-sm">
            {missingSkills.map(s => (
              <span key={s} className="flex items-center gap-xs px-sm py-xs rounded-full bg-error-container text-on-error-container text-label-sm">
                <XCircle size={12} weight="fill" />{s}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create EditorPanel.tsx**

`apps/web/components/resume/EditorPanel.tsx`:
```tsx
"use client";
import * as Tabs from "@radix-ui/react-tabs";
import { useResumeStore } from "@/stores/resume-store";
import { useTailoringStore } from "@/stores/tailoring-store";
import { HumanizeSlider } from "./HumanizeSlider";
import { SkillsDelta } from "./SkillsDelta";

export function EditorPanel() {
  const { content, updateSection } = useResumeStore();
  const { jdText, setJdText, runTailoring, isLoading } = useTailoringStore();

  return (
    <div className="flex flex-col gap-lg h-full overflow-y-auto p-lg">
      <Tabs.Root defaultValue="contact">
        <Tabs.List className="flex gap-sm mb-lg border-b border-outline-variant/20 pb-sm">
          {["contact","experience","education","skills"].map(tab => (
            <Tabs.Trigger key={tab} value={tab}
              className="px-md py-sm rounded-lg text-label-md font-label-md text-on-surface-variant capitalize
                data-[state=active]:bg-secondary-container data-[state=active]:text-primary transition-colors">
              {tab}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="contact" className="flex flex-col gap-md">
          {(["name","email","phone","location"] as const).map(field => (
            <div key={field}>
              <label className="text-label-sm text-on-surface-variant capitalize mb-xs block">{field}</label>
              <input value={content.contact[field]} onChange={e => updateSection("contact", { ...content.contact, [field]: e.target.value })}
                className="w-full px-md py-md rounded-lg border border-outline-variant bg-surface text-on-surface text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          ))}
        </Tabs.Content>

        <Tabs.Content value="experience" className="flex flex-col gap-lg">
          {content.experience.map((job, i) => (
            <div key={i} className="border border-outline-variant/20 rounded-xl p-md flex flex-col gap-sm">
              {(["title","company","dates"] as const).map(f => (
                <input key={f} placeholder={f} value={job[f]}
                  onChange={e => {
                    const updated = [...content.experience];
                    updated[i] = { ...updated[i], [f]: e.target.value };
                    updateSection("experience", updated);
                  }}
                  className="w-full px-md py-sm rounded-lg border border-outline-variant bg-surface text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              ))}
              <textarea placeholder="Bullet points (one per line)"
                value={job.bullets.join("\n")}
                onChange={e => {
                  const updated = [...content.experience];
                  updated[i] = { ...updated[i], bullets: e.target.value.split("\n") };
                  updateSection("experience", updated);
                }}
                rows={4}
                className="w-full px-md py-sm rounded-lg border border-outline-variant bg-surface text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
            </div>
          ))}
          <button onClick={() => updateSection("experience", [...content.experience, { company: "", title: "", dates: "", bullets: [] }])}
            className="text-primary text-label-md font-label-md hover:underline">
            + Add Experience
          </button>
        </Tabs.Content>

        <Tabs.Content value="skills" className="flex flex-col gap-md">
          <label className="text-label-sm text-on-surface-variant">Skills (comma separated)</label>
          <input value={content.skills.join(", ")}
            onChange={e => updateSection("skills", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
            className="w-full px-md py-md rounded-lg border border-outline-variant bg-surface text-on-surface text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </Tabs.Content>

        <Tabs.Content value="education" className="flex flex-col gap-lg">
          {content.education.map((edu, i) => (
            <div key={i} className="border border-outline-variant/20 rounded-xl p-md flex flex-col gap-sm">
              {(["school","degree","dates"] as const).map(f => (
                <input key={f} placeholder={f} value={edu[f]}
                  onChange={e => {
                    const updated = [...content.education];
                    updated[i] = { ...updated[i], [f]: e.target.value };
                    updateSection("education", updated);
                  }}
                  className="w-full px-md py-sm rounded-lg border border-outline-variant bg-surface text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              ))}
            </div>
          ))}
          <button onClick={() => updateSection("education", [...content.education, { school: "", degree: "", dates: "" }])}
            className="text-primary text-label-md font-label-md hover:underline">
            + Add Education
          </button>
        </Tabs.Content>
      </Tabs.Root>

      {/* JD context + AI tools */}
      <div className="border-t border-outline-variant/20 pt-lg flex flex-col gap-md">
        <p className="text-label-md text-on-surface-variant uppercase tracking-wider">JD Context</p>
        <textarea value={jdText} onChange={e => setJdText(e.target.value)}
          placeholder="Paste job description here to tailor…" rows={4}
          className="w-full px-md py-md rounded-lg border border-outline-variant bg-surface text-body-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30" />
        <HumanizeSlider />
        <button onClick={runTailoring} disabled={isLoading || !jdText}
          className="w-full py-md rounded-lg text-label-md font-label-md text-on-primary bg-gradient-to-b from-primary-container to-primary shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed">
          {isLoading ? "Tailoring…" : "Tailor to JD"}
        </button>
        <SkillsDelta />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create PreviewPanel.tsx**

`apps/web/components/resume/PreviewPanel.tsx`:
```tsx
"use client";
import { useResumeStore } from "@/stores/resume-store";
import { useTailoringStore } from "@/stores/tailoring-store";
import { useRouter } from "next/navigation";
import { ArrowSquareOut, DownloadSimple } from "@phosphor-icons/react";

export function PreviewPanel() {
  const { templateId, setTemplate, pdfSignedUrl, generatePdf, isDirty, saveResume } = useResumeStore();
  const { sessionId } = useTailoringStore();
  const router = useRouter();

  return (
    <div className="flex flex-col h-full">
      {/* Controls bar */}
      <div className="flex items-center justify-between p-lg border-b border-outline-variant/20 flex-shrink-0">
        <div className="flex items-center gap-sm">
          {(["ats_clean", "ats_modern"] as const).map(t => (
            <button key={t} onClick={() => setTemplate(t)}
              className={`px-md py-sm rounded-lg text-label-sm font-label-md transition-colors ${
                templateId === t ? "bg-secondary-container text-primary" : "text-on-surface-variant hover:bg-surface-container-low"
              }`}>
              {t === "ats_clean" ? "ATS Clean" : "ATS Modern"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-sm">
          {isDirty && (
            <button onClick={saveResume} className="text-label-sm text-primary hover:underline">Save</button>
          )}
          <button onClick={generatePdf}
            className="flex items-center gap-sm px-md py-sm rounded-lg text-label-sm font-label-md text-on-surface-variant border border-outline-variant hover:bg-surface-container-low transition-colors">
            <DownloadSimple size={16} /> Generate PDF
          </button>
          {sessionId && (
            <button onClick={() => router.push(`/interview/${sessionId}`)}
              className="flex items-center gap-sm px-md py-sm rounded-lg text-label-sm font-label-md text-on-primary bg-primary hover:bg-primary-container transition-colors">
              <ArrowSquareOut size={16} /> Interview Prep
            </button>
          )}
        </div>
      </div>

      {/* PDF Preview */}
      <div className="flex-1 bg-surface-container p-lg overflow-hidden">
        {pdfSignedUrl ? (
          <iframe src={pdfSignedUrl} className="w-full h-full rounded-xl border border-outline-variant/20 shadow-sm bg-white" title="Resume Preview" />
        ) : (
          <div className="w-full h-full rounded-xl border-2 border-dashed border-outline-variant flex items-center justify-center">
            <div className="text-center">
              <p className="text-on-surface-variant text-body-md">No PDF generated yet</p>
              <p className="text-on-surface-variant text-body-sm mt-sm">Click "Generate PDF" or "Tailor to JD" to preview</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create Studio page**

`apps/web/app/(app)/studio/[resumeId]/page.tsx`:
```tsx
"use client";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { use } from "react";
import { EditorPanel } from "@/components/resume/EditorPanel";
import { PreviewPanel } from "@/components/resume/PreviewPanel";
import { useResumeStore } from "@/stores/resume-store";
import { apiClient } from "@/lib/api-client";
import type { Resume } from "@career-copilot/types";

export default function StudioPage({ params }: { params: Promise<{ resumeId: string }> }) {
  const { resumeId } = use(params);
  const setResume = useResumeStore(s => s.setResume);

  const { data: resume } = useQuery({
    queryKey: ["resume", resumeId],
    queryFn: () => apiClient.get<Resume>(`/resumes/${resumeId}`),
  });

  useEffect(() => {
    if (resume) setResume(resume);
  }, [resume, setResume]);

  return (
    <div className="flex h-[calc(100vh-0px)] overflow-hidden">
      <div className="w-[420px] flex-shrink-0 border-r border-outline-variant/20 overflow-y-auto">
        <EditorPanel />
      </div>
      <div className="flex-1 overflow-hidden">
        <PreviewPanel />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Test studio manually**

Create a resume from the dashboard, click into it — editor tabs should appear on the left, PDF placeholder on the right. Type in Contact tab — auto-save should trigger after 2 seconds (check network tab).

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/\(app\)/studio/ apps/web/components/resume/
git commit -m "feat(web): add Resume Studio split-screen builder"
```

---

### Task 7: JD Analyzer page + Interview Center page

**Files:**
- Create: `apps/web/app/(app)/jd/[jdId]/page.tsx`
- Create: `apps/web/app/(app)/interview/[sessionId]/page.tsx`
- Create: `apps/web/components/interview/QuestionCard.tsx`
- Create: `apps/web/components/interview/TopicList.tsx`

**Reference:** `design-refs/jd_analyzer.html`, `design-refs/interview_center.html`

- [ ] **Step 1: Create JD Analyzer page**

`apps/web/app/(app)/jd/[jdId]/page.tsx`:
```tsx
"use client";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { Card } from "@/components/ui/Card";
import { CheckCircle, XCircle } from "@phosphor-icons/react";

interface JDOut {
  id: string;
  raw_text: string;
  parsed: { required_skills: string[]; nice_to_have: string[]; role?: string; company?: string } | null;
}

export default function JDPage({ params }: { params: Promise<{ jdId: string }> }) {
  const { jdId } = use(params);
  const router = useRouter();
  const { data: jd } = useQuery({
    queryKey: ["jd", jdId],
    queryFn: () => apiClient.get<JDOut>(`/jd/${jdId}`),
  });
  const { data: resumes = [] } = useQuery({
    queryKey: ["resumes"],
    queryFn: () => apiClient.get<Array<{ id: string; title: string }>>("/resumes"),
  });

  return (
    <div className="max-w-[1440px] mx-auto p-gutter pb-xxl flex flex-col gap-xl">
      <section className="pt-xl">
        <h1 className="text-headline-xl text-on-surface mb-sm">JD Analysis</h1>
        {jd?.parsed?.role && (
          <p className="text-body-lg text-on-surface-variant">{jd.parsed.role}{jd.parsed.company ? ` at ${jd.parsed.company}` : ""}</p>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-gutter">
        {/* Required skills */}
        <Card className="lg:col-span-2">
          <p className="text-label-md text-on-surface-variant uppercase tracking-wider mb-lg">Required Skills</p>
          <div className="flex flex-wrap gap-sm">
            {jd?.parsed?.required_skills?.map(s => (
              <span key={s} className="flex items-center gap-xs px-md py-sm rounded-full bg-secondary-container text-on-secondary-container text-label-sm">
                <CheckCircle size={14} weight="fill" className="text-primary" />{s}
              </span>
            ))}
          </div>
          {jd?.parsed?.nice_to_have && jd.parsed.nice_to_have.length > 0 && (
            <>
              <p className="text-label-md text-on-surface-variant uppercase tracking-wider mt-lg mb-md">Nice to Have</p>
              <div className="flex flex-wrap gap-sm">
                {jd.parsed.nice_to_have.map(s => (
                  <span key={s} className="px-md py-sm rounded-full border border-outline-variant text-on-surface-variant text-label-sm">{s}</span>
                ))}
              </div>
            </>
          )}
        </Card>

        {/* Action panel */}
        <Card className="flex flex-col gap-md">
          <p className="text-label-md text-on-surface-variant uppercase tracking-wider">Tailor a Resume</p>
          {resumes.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">No resumes yet. Create one first.</p>
          ) : (
            <div className="flex flex-col gap-sm">
              {resumes.map(r => (
                <button key={r.id}
                  onClick={() => router.push(`/studio/${r.id}?jdId=${jdId}`)}
                  className="w-full text-left px-md py-md rounded-xl border border-outline-variant hover:border-primary/40 hover:bg-surface-container-low transition-colors">
                  <p className="text-label-md text-on-surface">{r.title}</p>
                </button>
              ))}
            </div>
          )}
          <button onClick={() => router.push("/dashboard")}
            className="w-full py-md rounded-lg text-label-md font-label-md text-on-surface-variant border border-outline-variant hover:bg-surface-container-low transition-colors mt-auto">
            Back to Dashboard
          </button>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create QuestionCard.tsx**

`apps/web/components/interview/QuestionCard.tsx`:
```tsx
"use client";
import { useState } from "react";
import type { PrepQuestionOut } from "@career-copilot/types";
import { Card } from "@/components/ui/Card";

export function QuestionCard({ question }: { question: PrepQuestionOut }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <Card className="cursor-pointer min-h-[200px] flex flex-col justify-between" onClick={() => setFlipped(f => !f)}>
      <div className="flex items-start justify-between mb-md">
        <span className="px-sm py-xs rounded-full bg-secondary-container text-on-secondary-container text-label-sm">
          {question.topic}
        </span>
        {question.is_gap_based && (
          <span className="px-sm py-xs rounded-full bg-error-container text-on-error-container text-label-sm">Gap</span>
        )}
      </div>
      {flipped ? (
        <div>
          <p className="text-label-md text-primary mb-sm uppercase tracking-wider">Answer Framework</p>
          <p className="text-body-md text-on-surface">{question.answer_framework}</p>
        </div>
      ) : (
        <p className="text-body-lg text-on-surface font-medium">{question.question}</p>
      )}
      <p className="text-caption text-on-surface-variant mt-md text-right">
        {flipped ? "Tap to see question" : "Tap to reveal answer framework"}
      </p>
    </Card>
  );
}
```

- [ ] **Step 3: Create TopicList.tsx**

`apps/web/components/interview/TopicList.tsx`:
```tsx
"use client";
import type { PrepQuestionOut } from "@career-copilot/types";

export function TopicList({ questions, activeIndex, onSelect }: {
  questions: PrepQuestionOut[];
  activeIndex: number;
  onSelect: (i: number) => void;
}) {
  const topics = [...new Set(questions.map(q => q.topic))];
  return (
    <div className="flex flex-col gap-sm">
      {topics.map(topic => {
        const topicQs = questions.filter(q => q.topic === topic);
        const isActive = topicQs.some((q, i) => questions.indexOf(q) === activeIndex);
        return (
          <button key={topic} onClick={() => onSelect(questions.indexOf(topicQs[0]))}
            className={`text-left px-md py-md rounded-xl text-label-md font-label-md transition-colors ${
              isActive ? "bg-secondary-container text-primary" : "text-on-surface-variant hover:bg-surface-container-low"
            }`}>
            <span className="flex items-center gap-sm">
              <span className="w-2 h-2 rounded-full bg-current" />
              {topic}
              <span className="ml-auto text-caption">{topicQs.length}Q</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Create Interview Center page**

`apps/web/app/(app)/interview/[sessionId]/page.tsx`:
```tsx
"use client";
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { QuestionCard } from "@/components/interview/QuestionCard";
import { TopicList } from "@/components/interview/TopicList";
import type { PrepQuestionOut } from "@career-copilot/types";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";

export default function InterviewPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const [activeIndex, setActiveIndex] = useState(0);

  const { data: questions = [] } = useQuery({
    queryKey: ["questions", sessionId],
    queryFn: () => apiClient.get<PrepQuestionOut[]>(`/ai/sessions/${sessionId}/questions`),
  });

  const active = questions[activeIndex];

  return (
    <div className="max-w-[1440px] mx-auto p-gutter pb-xxl flex flex-col gap-xl">
      <section className="pt-xl">
        <h1 className="text-headline-xl text-on-surface mb-sm">Interview Prep</h1>
        <p className="text-body-lg text-on-surface-variant">
          {questions.length} questions tailored to your skill gaps
        </p>
      </section>

      <div className="flex gap-gutter">
        {/* Topic sidebar */}
        <div className="w-64 flex-shrink-0">
          <TopicList questions={questions} activeIndex={activeIndex} onSelect={setActiveIndex} />
        </div>

        {/* Question area */}
        <div className="flex-1 flex flex-col gap-lg">
          {active ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-label-md text-on-surface-variant">
                  Question {activeIndex + 1} of {questions.length}
                </span>
              </div>
              <QuestionCard question={active} />
              <div className="flex items-center justify-between">
                <button onClick={() => setActiveIndex(i => Math.max(0, i - 1))}
                  disabled={activeIndex === 0}
                  className="flex items-center gap-sm px-lg py-md rounded-lg border border-outline-variant text-label-md font-label-md text-on-surface-variant hover:bg-surface-container-low transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  <CaretLeft size={16} /> Previous
                </button>
                <button onClick={() => setActiveIndex(i => Math.min(questions.length - 1, i + 1))}
                  disabled={activeIndex === questions.length - 1}
                  className="flex items-center gap-sm px-lg py-md rounded-lg text-label-md font-label-md text-on-primary bg-primary hover:bg-primary-container transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  Next <CaretRight size={16} />
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-on-surface-variant text-body-md">No questions yet. Run tailoring first.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Test end-to-end flow**

1. Dashboard → paste JD → "Analyze JD" → `/jd/{id}` page shows skills
2. Click "Tailor a Resume" → opens Studio with jdId in URL
3. In Studio, paste JD text + click "Tailor to JD" → score ring updates, PDF generates
4. Click "Interview Prep" → `/interview/{sessionId}` shows flashcard questions
5. Tap a card → flips to answer framework

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/\(app\)/jd/ apps/web/app/\(app\)/interview/ apps/web/components/interview/
git commit -m "feat(web): add JD Analyzer and Interview Center pages"
```

---

### Task 8: Landing page + final wiring

**Files:**
- Create: `apps/web/app/page.tsx` (landing, unauthenticated)
- Modify: `apps/web/next.config.ts` — add API URL env

- [ ] **Step 1: Create landing page**

`apps/web/app/page.tsx`:
```tsx
import Link from "next/link";
import { RocketLaunch, FileText, Brain, ChartLineUp } from "@phosphor-icons/react/dist/ssr";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="flex items-center justify-between px-gutter py-lg max-w-[1440px] mx-auto w-full">
        <div className="flex items-center gap-md">
          <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center">
            <RocketLaunch size={18} weight="fill" className="text-on-primary" />
          </div>
          <span className="text-headline-md font-black text-primary">Career Copilot</span>
        </div>
        <div className="flex items-center gap-md">
          <Link href="/login" className="text-label-md font-label-md text-on-surface-variant hover:text-on-surface transition-colors">Sign in</Link>
          <Link href="/register" className="px-lg py-sm rounded-lg text-label-md font-label-md text-on-primary bg-gradient-to-b from-primary-container to-primary shadow-md hover:shadow-lg transition-all">
            Get Started Free
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center text-center px-gutter py-xxl max-w-[800px] mx-auto">
        <h1 className="text-headline-xl text-on-surface mb-lg">
          Land more interviews with AI-tailored resumes
        </h1>
        <p className="text-body-lg text-on-surface-variant mb-xl max-w-xl">
          Career Copilot tailors your resume to any job description in seconds, calculates your ATS score, and generates interview questions targeting your exact skill gaps.
        </p>
        <Link href="/register"
          className="px-xxl py-lg rounded-xl text-label-md font-label-md text-on-primary bg-gradient-to-b from-primary-container to-primary shadow-lg hover:shadow-xl transition-all text-lg">
          Start for Free — No Credit Card
        </Link>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-gutter mt-xxl w-full">
          {[
            { icon: FileText, title: "ATS-Optimized Resume", desc: "Two clean templates proven to pass applicant tracking systems." },
            { icon: ChartLineUp, title: "JD Tailoring Engine", desc: "Rewrites your bullets to match keywords with a humanize slider." },
            { icon: Brain, title: "Gap-Based Interview Prep", desc: "Questions targeting your missing skills, not generic advice." },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-sm text-left">
              <div className="w-10 h-10 rounded-xl bg-secondary-container flex items-center justify-center mb-md">
                <Icon size={22} weight="fill" className="text-primary" />
              </div>
              <p className="text-label-md font-bold text-on-surface mb-sm">{title}</p>
              <p className="text-body-sm text-on-surface-variant">{desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Update next.config.ts**

`apps/web/next.config.ts`:
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
};
export default nextConfig;
```

- [ ] **Step 3: Full end-to-end smoke test**

```bash
# Terminal 1 — backend
cd apps/api && uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend
cd apps/web && npm run dev
```

Test the full flow:
1. `localhost:3000` — landing page renders
2. Register → email confirmation → login → dashboard
3. Paste a JD → Analyze → JD page shows skills
4. Create resume → studio → fill contact → type JD → Tailor to JD → score appears → PDF generates in iframe
5. Click Interview Prep → flashcards appear → tap to flip

- [ ] **Step 4: Final commit**

```bash
git add apps/web/app/page.tsx apps/web/next.config.ts
git commit -m "feat(web): add landing page and finalize full app wiring"
```

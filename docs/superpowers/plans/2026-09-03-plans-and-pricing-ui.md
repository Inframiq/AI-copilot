# Plans & Pricing UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Free-vs-Premium plans surface — shown as the last step of onboarding for new users and linked from `/account` for everyone — with checkout stubbed until real payments land.

**Architecture:** A static plan catalog (`PLANS`) lives in `apps/api/app/core/credits.py` and is served by a new no-auth `GET /plans`. One shared React component `<PlansComparison>` renders the cards; it owns no navigation or payment logic — each caller passes `onChoosePlan`. "Get Premium" opens `<UpgradeModal>` ("Payments launching soon"). Three surfaces use the component: a new `/plans` page, onboarding step 3, and (as a link) the `/account` upgrade card.

**Tech Stack:** FastAPI + pytest (`apps/api`, run from `apps/api` with `.venv`); Next.js App Router + React Query v5 + Tailwind + vitest/jsdom + Testing Library (`apps/web`, run vitest from `apps/web`); shared types in `packages/types/index.ts`.

**Spec:** `docs/superpowers/specs/2026-09-03-plans-and-pricing-ui-design.md`

## Global Constraints

- **Presentation only.** No Razorpay/Stripe, no webhooks, no orders/payments/waitlist tables, no changes to `spend_credits`, `resolve_subscription`, the `subscriptions` schema, or `GET /me/subscription`.
- **Free plan:** `price_usd: 0`, `period: None`, `credits: PLAN_CREDITS["free"]` (currently 50), `refills: False`, one-time grant.
- **Premium plan:** `price_usd: 5`, `period: "month"`, `credits: PLAN_CREDITS["premium"]` (currently 600), `refills: True`.
- Credit amounts are **always** read from `PLAN_CREDITS` — never hardcode 50 / 600 in `PLANS`.
- `GET /plans` takes **no auth**. The `/plans` *page* is auth-protected via `middleware.ts`.
- Catalog order is exactly `["free", "premium"]`.
- Run backend tests from `apps/api` with the venv active: `.venv/Scripts/python.exe -m pytest <path>`. Run frontend tests from `apps/web`: `npx vitest run <path>`.
- Commit after every task. This repo commits directly to `main`; do not open PRs unless asked.
- Commit message trailer (every commit):
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NogVweog6Sn6YMv724X5tG
  ```

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/app/core/credits.py` | add `PLANS` constant (catalog) |
| `apps/api/app/routers/plans.py` | new — `GET /plans` returning the catalog, no auth |
| `apps/api/app/main.py` | register the plans router |
| `apps/api/tests/test_plans_router.py` | new — contract test for `GET /plans` |
| `packages/types/index.ts` | add `Plan` interface |
| `apps/web/lib/api-client.ts` | add `getPlans()` |
| `apps/web/components/plans/PlansComparison.tsx` | new — the Free/Premium card pair; catalog-driven; `onChoosePlan` callback |
| `apps/web/components/plans/UpgradeModal.tsx` | new — "Payments launching soon" stub modal |
| `apps/web/app/(app)/plans/page.tsx` | new — `/plans` page: header + `<PlansComparison>` + modal |
| `apps/web/middleware.ts` | add `/plans` to `PROTECTED_PREFIXES` |
| `apps/web/app/(app)/onboarding/page.tsx` | add step 3 "Choose your plan" |
| `apps/web/app/(app)/account/page.tsx` | upgrade card becomes a link to `/plans` |
| `apps/web/__tests__/components/PlansComparison.test.tsx` | new |
| `apps/web/__tests__/components/UpgradeModal.test.tsx` | new |
| `apps/web/__tests__/plans-page.test.tsx` | new |
| `apps/web/__tests__/onboarding-page.test.tsx` | new |
| `apps/web/__tests__/account-page.test.tsx` | extend (one added test) |

---

## Task 1: Backend — `PLANS` catalog + `GET /plans`

**Files:**
- Modify: `apps/api/app/core/credits.py` (add `PLANS` after `PLAN_CREDITS`)
- Create: `apps/api/app/routers/plans.py`
- Modify: `apps/api/app/main.py:8` (import) and `:77` (register, after `me.router`)
- Test: `apps/api/tests/test_plans_router.py`

**Interfaces:**
- Consumes: `PLAN_CREDITS` from `app.core.credits` (`{"free": 50, "premium": 600}`)
- Produces:
  - `PLANS: list[dict]` in `app.core.credits` — each dict: `{"id": str, "name": str, "price_usd": int, "period": str | None, "credits": int, "refills": bool, "features": list[str]}`, order `["free", "premium"]`.
  - `GET /plans` → `200 {"plans": PLANS}`, no auth.

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/test_plans_router.py`:

```python
import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.core.credits import PLAN_CREDITS


@pytest.mark.asyncio
async def test_plans_returns_free_then_premium_without_auth():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get("/plans")
    assert r.status_code == 200
    plans = r.json()["plans"]
    assert [p["id"] for p in plans] == ["free", "premium"]

    free = plans[0]
    assert free["price_usd"] == 0
    assert free["period"] is None
    assert free["refills"] is False
    assert free["credits"] == PLAN_CREDITS["free"]
    assert isinstance(free["features"], list) and free["features"]

    premium = plans[1]
    assert premium["price_usd"] == 5
    assert premium["period"] == "month"
    assert premium["refills"] is True
    assert premium["credits"] == PLAN_CREDITS["premium"]
    assert isinstance(premium["features"], list) and premium["features"]
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/api`, venv active): `.venv/Scripts/python.exe -m pytest tests/test_plans_router.py -v`
Expected: FAIL — `404` for `GET /plans` (route not registered), so `r.status_code == 200` fails.

- [ ] **Step 3: Add `PLANS` to `credits.py`**

In `apps/api/app/core/credits.py`, immediately after the `PLAN_CREDITS` definition, add:

```python
# Static catalog served by GET /plans and rendered by the pricing UI.
# Credit amounts come from PLAN_CREDITS above so there's one number to change.
PLANS: list[dict] = [
    {
        "id": "free",
        "name": "Free",
        "price_usd": 0,
        "period": None,
        "credits": PLAN_CREDITS["free"],
        "refills": False,
        "features": [
            "50 credits, one-time",
            "About 5 resume tailors",
            "Cover letters and bullet rewrites",
            "Free JD analysis",
        ],
    },
    {
        "id": "premium",
        "name": "Premium",
        "price_usd": 5,
        "period": "month",
        "credits": PLAN_CREDITS["premium"],
        "refills": True,
        "features": [
            "600 credits every month",
            "About 60 resume tailors",
            "Everything in Free",
            "Priority support",
        ],
    },
]
```

- [ ] **Step 4: Create the router**

Create `apps/api/app/routers/plans.py`:

```python
from fastapi import APIRouter

from app.core.credits import PLANS

router = APIRouter(tags=["plans"])


@router.get("/plans")
async def list_plans():
    """Static plan catalog for the pricing UI. No auth — no user data."""
    return {"plans": PLANS}
```

- [ ] **Step 5: Register the router**

In `apps/api/app/main.py`:
- Line 8 — add `plans` to the import:
  ```python
  from app.routers import resumes, jd, ai, learning, contacts, cover_letters, me, plans
  ```
- After the `app.include_router(me.router)` line (currently line 77), add:
  ```python
  app.include_router(plans.router)
  ```

- [ ] **Step 6: Run test to verify it passes**

Run: `.venv/Scripts/python.exe -m pytest tests/test_plans_router.py -v`
Expected: PASS.

- [ ] **Step 7: Run the full API suite (nothing else should move)**

Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: all pass (previous baseline 363 + 1 new = 364).

- [ ] **Step 8: Commit**

```bash
git add apps/api/app/core/credits.py apps/api/app/routers/plans.py apps/api/app/main.py apps/api/tests/test_plans_router.py
git commit -m "feat(api): GET /plans static catalog (free + premium)"
```

---

## Task 2: `<PlansComparison>` component (+ `Plan` type, `getPlans`)

**Files:**
- Modify: `packages/types/index.ts` (add `Plan` after the `Subscription` interface)
- Modify: `apps/web/lib/api-client.ts` (add `getPlans` in the "Account / credits" section; add `Plan` to the type import)
- Create: `apps/web/components/plans/PlansComparison.tsx`
- Test: `apps/web/__tests__/components/PlansComparison.test.tsx`

**Interfaces:**
- Consumes: `GET /plans` → `{ plans: Plan[] }` (from Task 1)
- Produces:
  - `Plan` interface: `{ id: string; name: string; price_usd: number; period: "month" | null; credits: number; refills: boolean; features: string[] }`
  - `apiClient.getPlans(): Promise<{ plans: Plan[] }>`
  - `<PlansComparison>` — props `{ currentPlan?: string; onChoosePlan: (planId: string) => void; variant?: "full" | "compact" }`. Button label per card: `"Current plan"` (disabled) when `currentPlan === plan.id`, else `"Get Premium"` for `premium`, else `"Continue on Free"`. Renders a two-card skeleton until the catalog loads. React Query key: `["plans"]`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/components/PlansComparison.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({ apiClient: { getPlans: vi.fn() } }));

import { PlansComparison } from "../../components/plans/PlansComparison";
import { apiClient } from "../../lib/api-client";

const CATALOG = {
  plans: [
    { id: "free", name: "Free", price_usd: 0, period: null, credits: 50, refills: false,
      features: ["50 credits, one-time", "About 5 resume tailors", "Cover letters and bullet rewrites", "Free JD analysis"] },
    { id: "premium", name: "Premium", price_usd: 5, period: "month", credits: 600, refills: true,
      features: ["600 credits every month", "About 60 resume tailors", "Everything in Free", "Priority support"] },
  ],
};

function renderIt(extra: { currentPlan?: string; onChoosePlan?: (id: string) => void } = {}) {
  const onChoosePlan = extra.onChoosePlan ?? vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PlansComparison currentPlan={extra.currentPlan} onChoosePlan={onChoosePlan} />
    </QueryClientProvider>
  );
  return { onChoosePlan };
}

describe("PlansComparison", () => {
  beforeEach(() => vi.mocked(apiClient.getPlans).mockReset());

  it("renders both plans from the catalog", async () => {
    vi.mocked(apiClient.getPlans).mockResolvedValue(CATALOG);
    renderIt();
    expect(await screen.findByRole("heading", { name: "Free" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Premium" })).toBeInTheDocument();
    expect(screen.getByText("$5")).toBeInTheDocument();
    expect(screen.getByText("Priority support")).toBeInTheDocument();
  });

  it("fires onChoosePlan with the plan id", async () => {
    vi.mocked(apiClient.getPlans).mockResolvedValue(CATALOG);
    const { onChoosePlan } = renderIt();
    await userEvent.click(await screen.findByRole("button", { name: "Get Premium" }));
    expect(onChoosePlan).toHaveBeenCalledWith("premium");
  });

  it("disables the current plan's button and labels it", async () => {
    vi.mocked(apiClient.getPlans).mockResolvedValue(CATALOG);
    const { onChoosePlan } = renderIt({ currentPlan: "free" });
    const currentBtn = await screen.findByRole("button", { name: "Current plan" });
    expect(currentBtn).toBeDisabled();
    await userEvent.click(currentBtn);
    expect(onChoosePlan).not.toHaveBeenCalled();
    // premium button is still active
    expect(screen.getByRole("button", { name: "Get Premium" })).toBeEnabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/web`): `npx vitest run __tests__/components/PlansComparison.test.tsx`
Expected: FAIL — cannot resolve `../../components/plans/PlansComparison`.

- [ ] **Step 3: Add the `Plan` type**

In `packages/types/index.ts`, directly after the `Subscription` interface, add:

```ts
// GET /plans — static pricing catalog.
export interface Plan {
  id: string;
  name: string;
  price_usd: number;
  period: "month" | null;
  credits: number;
  refills: boolean;
  features: string[];
}
```

- [ ] **Step 4: Add `getPlans` to the API client**

In `apps/web/lib/api-client.ts`:
- Add `Plan` to the big `import type { ... } from "@career-copilot/types"` block (alongside `Subscription`).
- In the `// ── Account / credits ──` section, next to `getSubscription`, add:
  ```ts
  getPlans: (): Promise<{ plans: Plan[] }> =>
    request<{ plans: Plan[] }>("GET", "/plans"),
  ```

- [ ] **Step 5: Create the component**

Create `apps/web/components/plans/PlansComparison.tsx`:

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { Check, Lightning } from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import type { Plan } from "@career-copilot/types";

interface Props {
  currentPlan?: string;
  onChoosePlan: (planId: string) => void;
  variant?: "full" | "compact";
}

export function PlansComparison({ currentPlan, onChoosePlan, variant = "full" }: Props) {
  const { data } = useQuery<{ plans: Plan[] }>({
    queryKey: ["plans"],
    queryFn: () => apiClient.getPlans(),
    staleTime: 5 * 60_000,
  });

  if (!data) {
    return (
      <div className="grid gap-gutter sm:grid-cols-2">
        <div className="h-72 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest animate-pulse" />
        <div className="h-72 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest animate-pulse" />
      </div>
    );
  }

  const compact = variant === "compact";

  return (
    <div className="grid gap-gutter sm:grid-cols-2">
      {data.plans.map((plan) => {
        const isCurrent = currentPlan === plan.id;
        const isPremium = plan.id === "premium";
        const features = compact ? plan.features.slice(0, 3) : plan.features;
        const label = isCurrent
          ? "Current plan"
          : isPremium
          ? "Get Premium"
          : "Continue on Free";

        return (
          <div
            key={plan.id}
            className={`rounded-2xl border p-lg flex flex-col ${
              isPremium
                ? "border-primary/40 bg-primary/[0.03] shadow-lg shadow-primary/5"
                : "border-outline-variant/20 bg-surface-container-lowest"
            }`}
          >
            <div className="flex items-center justify-between gap-sm">
              <h3 className="text-headline-md text-on-surface font-semibold">{plan.name}</h3>
              {isCurrent && (
                <span className="text-caption font-semibold px-sm py-[2px] rounded-full bg-secondary-container text-on-secondary-container">
                  Current plan
                </span>
              )}
            </div>

            <div className="mt-sm flex items-baseline gap-xs">
              <span className="text-headline-xl text-on-surface font-bold">
                {plan.price_usd === 0 ? "Free" : `$${plan.price_usd}`}
              </span>
              {plan.period && (
                <span className="text-body-md text-on-surface-variant">/ {plan.period}</span>
              )}
            </div>
            <p className="text-body-sm text-on-surface-variant mt-xs flex items-center gap-xs">
              <Lightning size={14} weight="fill" className="text-primary" />
              {plan.credits} credits{plan.refills ? " every month" : ", one-time"}
            </p>

            <ul className="mt-md flex flex-col gap-sm flex-1">
              {features.map((f) => (
                <li key={f} className="flex items-start gap-sm text-body-sm text-on-surface">
                  <Check size={16} weight="bold" className="text-success-accent shrink-0 mt-[2px]" />
                  {f}
                </li>
              ))}
            </ul>

            <button
              onClick={() => !isCurrent && onChoosePlan(plan.id)}
              disabled={isCurrent}
              className={`mt-lg py-md rounded-xl text-label-md font-semibold transition-colors ${
                isCurrent
                  ? "bg-surface-container text-on-surface-variant cursor-default"
                  : isPremium
                  ? "bg-primary text-on-primary hover:opacity-90"
                  : "border border-outline-variant/40 text-on-surface hover:bg-surface-container-high/50"
              }`}
            >
              {label}
            </button>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run __tests__/components/PlansComparison.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/types/index.ts apps/web/lib/api-client.ts apps/web/components/plans/PlansComparison.tsx apps/web/__tests__/components/PlansComparison.test.tsx
git commit -m "feat(web): PlansComparison component + Plan type + getPlans"
```

---

## Task 3: `<UpgradeModal>` stub

**Files:**
- Create: `apps/web/components/plans/UpgradeModal.tsx`
- Test: `apps/web/__tests__/components/UpgradeModal.test.tsx`

**Interfaces:**
- Produces: `<UpgradeModal onClose={() => void} />` — a fixed-overlay dialog. Heading text `"Payments are launching soon"`. A `"Got it"` button and an `X` (aria-label `"Close"`), both call `onClose`. Escape key and backdrop click also call `onClose`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/components/UpgradeModal.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { UpgradeModal } from "../../components/plans/UpgradeModal";

describe("UpgradeModal", () => {
  it("shows the coming-soon copy and closes on 'Got it'", async () => {
    const onClose = vi.fn();
    render(<UpgradeModal onClose={onClose} />);
    expect(screen.getByText(/payments are launching soon/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /got it/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<UpgradeModal onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/UpgradeModal.test.tsx`
Expected: FAIL — cannot resolve `../../components/plans/UpgradeModal`.

- [ ] **Step 3: Create the component**

Create `apps/web/components/plans/UpgradeModal.tsx`:

```tsx
"use client";
import { useEffect } from "react";
import { X, Sparkle } from "@phosphor-icons/react";

export function UpgradeModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-on-surface/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-lg pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Payments are launching soon"
          className="pointer-events-auto w-full max-w-[26rem] bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-2xl p-lg"
        >
          <div className="flex items-start justify-between gap-md">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Sparkle size={20} weight="fill" className="text-primary" />
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="text-on-surface-variant hover:bg-surface-container-high/50 p-xs rounded-full transition-colors"
            >
              <X size={18} />
            </button>
          </div>
          <h2 className="text-headline-md text-on-surface font-semibold mt-md">
            Payments are launching soon
          </h2>
          <p className="text-body-sm text-on-surface-variant mt-xs">
            Premium isn&apos;t purchasable yet — you&apos;re on the Free plan for now.
            We&apos;ll let you know the moment it opens.
          </p>
          <button
            onClick={onClose}
            className="mt-lg w-full py-md rounded-xl text-label-md font-semibold bg-primary text-on-primary hover:opacity-90 transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/components/UpgradeModal.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/plans/UpgradeModal.tsx apps/web/__tests__/components/UpgradeModal.test.tsx
git commit -m "feat(web): UpgradeModal 'payments launching soon' stub"
```

---

## Task 4: `/plans` page + middleware guard

**Files:**
- Create: `apps/web/app/(app)/plans/page.tsx`
- Modify: `apps/web/middleware.ts` (`PROTECTED_PREFIXES` — add `"/plans"`)
- Test: `apps/web/__tests__/plans-page.test.tsx`

**Interfaces:**
- Consumes: `<PlansComparison>` (Task 2), `<UpgradeModal>` (Task 3), `apiClient.getSubscription` (existing), `apiClient.getPlans` (Task 2).
- Produces: default-exported `PlansPage` React component at route `/plans`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/plans-page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({
  apiClient: { getPlans: vi.fn(), getSubscription: vi.fn() },
}));

import PlansPage from "../app/(app)/plans/page";
import { apiClient } from "../lib/api-client";

const CATALOG = {
  plans: [
    { id: "free", name: "Free", price_usd: 0, period: null, credits: 50, refills: false, features: ["a", "b", "c", "d"] },
    { id: "premium", name: "Premium", price_usd: 5, period: "month", credits: 600, refills: true, features: ["a", "b", "c", "d"] },
  ],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PlansPage />
    </QueryClientProvider>
  );
}

describe("Plans page", () => {
  beforeEach(() => {
    vi.mocked(apiClient.getPlans).mockResolvedValue(CATALOG);
    vi.mocked(apiClient.getSubscription).mockResolvedValue({
      plan: "free", status: "active", credits_remaining: 50, credits_allotment: 50,
      current_period_end: null, renews: false, costs: {},
    });
  });

  it("opens the upgrade modal when Get Premium is clicked", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Get Premium" }));
    expect(await screen.findByText(/payments are launching soon/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/plans-page.test.tsx`
Expected: FAIL — cannot resolve `../app/(app)/plans/page`.

- [ ] **Step 3: Create the page**

Create `apps/web/app/(app)/plans/page.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { Subscription } from "@career-copilot/types";
import { PlansComparison } from "@/components/plans/PlansComparison";
import { UpgradeModal } from "@/components/plans/UpgradeModal";

export default function PlansPage() {
  const [showUpgrade, setShowUpgrade] = useState(false);
  const { data: sub } = useQuery<Subscription>({
    queryKey: ["subscription"],
    queryFn: () => apiClient.getSubscription(),
  });

  return (
    <div className="max-w-[900px] mx-auto p-gutter pb-xxl flex flex-col gap-section">
      <section className="pt-lg pb-md">
        <h1
          className="text-headline-xl text-on-surface font-bold mb-sm"
          style={{ letterSpacing: "-0.02em" }}
        >
          Plans
        </h1>
        <p className="text-body-lg text-on-surface-variant">
          Pick the plan that fits how much you tailor.
        </p>
      </section>

      <PlansComparison
        variant="full"
        currentPlan={sub?.plan}
        onChoosePlan={(id) => {
          if (id === "premium") setShowUpgrade(true);
        }}
      />

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} />}
    </div>
  );
}
```

- [ ] **Step 4: Add the middleware guard**

In `apps/web/middleware.ts`, add `"/plans"` to the end of the `PROTECTED_PREFIXES` array (it currently ends with `"/account"`):

```ts
const PROTECTED_PREFIXES = ["/dashboard", "/studio", "/jd", "/interview", "/career-path", "/networking", "/analytics", "/profile", "/onboarding", "/account", "/plans"];
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run __tests__/plans-page.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(app)/plans/page.tsx" apps/web/middleware.ts apps/web/__tests__/plans-page.test.tsx
git commit -m "feat(web): /plans page (auth-guarded) with stubbed Get Premium"
```

---

## Task 5: Onboarding step 3 "Choose your plan"

**Files:**
- Modify: `apps/web/app/(app)/onboarding/page.tsx`
- Test: `apps/web/__tests__/onboarding-page.test.tsx`

**Interfaces:**
- Consumes: `<PlansComparison>` (Task 2), `<UpgradeModal>` (Task 3).
- Produces: no exported API change — the page gains a third `step` value `"plan"` reached after the résumé step; both plan buttons end at `finish()` (`queryClient.invalidateQueries(["careerProfile"])` + `router.push("/dashboard")`).

Current relevant shape of `onboarding/page.tsx`:
- `const [step, setStep] = useState<"details" | "resume">("details");`
- `function finish() { queryClient.invalidateQueries({ queryKey: ["careerProfile"] }); router.push("/dashboard"); }`
- `function handleSkip() { setSkipping(true); finish(); }` — the résumé-step "Skip for now" button.
- Inside `handleFile(...)`, on successful parse+upsert: `finish();`
- Render is: `if (step === "details") { return (...) }` then `return (...)` for the résumé step.

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/onboarding-page.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("@/lib/supabase", () => ({
  createBrowserClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: { email: "jane@example.com", user_metadata: { full_name: "Jane" } } },
        }),
    },
  }),
}));
vi.mock("@/lib/career-profile-client", () => ({
  upsertCareerProfile: vi.fn().mockResolvedValue({}),
  setProfileMasterResume: vi.fn(),
  resumeContentToCareerProfileInput: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({
  apiClient: { getPlans: vi.fn(), parseResumeFile: vi.fn() },
}));

import OnboardingPage from "../app/(app)/onboarding/page";
import { apiClient } from "../lib/api-client";

const CATALOG = {
  plans: [
    { id: "free", name: "Free", price_usd: 0, period: null, credits: 50, refills: false, features: ["a", "b", "c", "d"] },
    { id: "premium", name: "Premium", price_usd: 5, period: "month", credits: 600, refills: true, features: ["a", "b", "c", "d"] },
  ],
};

function renderOnboarding() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <OnboardingPage />
    </QueryClientProvider>
  );
}

async function advanceToPlanStep(user: ReturnType<typeof userEvent.setup>) {
  // Step 1 — details. Name/email prefill from the mocked getUser (async effect).
  await screen.findByText("Welcome to Career Copilot");
  await screen.findByDisplayValue("Jane"); // wait for the prefill effect to land
  await user.type(screen.getByPlaceholderText("+1 (555) 000-0000"), "5551234567");
  await user.selectOptions(screen.getByRole("combobox"), "working");
  await user.click(screen.getByRole("button", { name: /^continue$/i }));
  // Step 2 — résumé. Skip.
  await screen.findByText("Upload your resume");
  await user.click(screen.getByRole("button", { name: /skip for now/i }));
}

describe("Onboarding — plan step", () => {
  beforeEach(() => {
    pushMock.mockReset();
    vi.mocked(apiClient.getPlans).mockResolvedValue(CATALOG);
  });

  it("shows the plan cards after the résumé step and finishes on 'Continue on Free'", async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await advanceToPlanStep(user);

    expect(await screen.findByText("Choose your plan")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Continue on Free" }));
    expect(pushMock).toHaveBeenCalledWith("/dashboard");
  });

  it("opens the upgrade modal for 'Get Premium', then finishes on 'Got it'", async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await advanceToPlanStep(user);

    await user.click(await screen.findByRole("button", { name: "Get Premium" }));
    await user.click(await screen.findByRole("button", { name: /got it/i }));
    expect(pushMock).toHaveBeenCalledWith("/dashboard");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/onboarding-page.test.tsx`
Expected: FAIL — after "Skip for now" the page navigates straight to `/dashboard`; `"Choose your plan"` is never found.

- [ ] **Step 3: Add imports + state**

In `apps/web/app/(app)/onboarding/page.tsx`:
- Add to the imports:
  ```tsx
  import { PlansComparison } from "@/components/plans/PlansComparison";
  import { UpgradeModal } from "@/components/plans/UpgradeModal";
  ```
- Change the `step` state type and add modal state (near the top of the component, next to the other `useState` calls):
  ```tsx
  const [step, setStep] = useState<"details" | "resume" | "plan">("details");
  const [showUpgrade, setShowUpgrade] = useState(false);
  ```

- [ ] **Step 4: Route the résumé step to the plan step**

- In `handleSkip`, replace the body so it advances instead of finishing:
  ```tsx
  function handleSkip() {
    setStep("plan");
  }
  ```
  (Delete the now-unused `setSkipping(true)` line here. Leave the `skipping` state and its use in the button label — the button just no longer sets it, which is fine; if `tsc`/lint flags `skipping`/`setSkipping` as unused after this, also remove the `const [skipping, setSkipping] = useState(false);` declaration and the `skipping ? "Skipping…" : "Skip for now"` / `disabled={... || skipping}` references, replacing them with plain `"Skip for now"` and `disabled={uploading}`.)
- Inside `handleFile(...)`, the success path currently ends with `finish();` — change that single call to:
  ```tsx
  setStep("plan");
  ```

- [ ] **Step 5: Render the plan step**

Immediately before the final `return (` (the résumé-step JSX), add a new block:

```tsx
  if (step === "plan") {
    return (
      <div className="min-h-full flex items-center justify-center p-gutter">
        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-xl p-xl max-w-[42rem] w-full">
          <h1 className="text-headline-lg text-on-surface font-bold mb-xs">Choose your plan</h1>
          <p className="text-body-md text-on-surface-variant mb-lg">
            Start free — you can upgrade anytime from Account.
          </p>
          <PlansComparison
            variant="compact"
            onChoosePlan={(id) => (id === "premium" ? setShowUpgrade(true) : finish())}
          />
          {showUpgrade && (
            <UpgradeModal
              onClose={() => {
                setShowUpgrade(false);
                finish();
              }}
            />
          )}
        </div>
      </div>
    );
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run __tests__/onboarding-page.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. (If it flags unused `skipping`/`setSkipping`, apply the cleanup noted in Step 4 and re-run.)

- [ ] **Step 8: Commit**

```bash
git add "apps/web/app/(app)/onboarding/page.tsx" apps/web/__tests__/onboarding-page.test.tsx
git commit -m "feat(web): onboarding step 3 — choose your plan"
```

---

## Task 6: `/account` upgrade card links to `/plans`

**Files:**
- Modify: `apps/web/app/(app)/account/page.tsx` (the "Upgrade — billing not wired yet" block)
- Test: `apps/web/__tests__/account-page.test.tsx` (add one test)

**Interfaces:**
- Consumes: nothing new — `Link` and `ArrowRight` are already imported in this file.
- Produces: no API change. The static "Need more credits?" `<div>` becomes a `<Link href="/plans">`.

- [ ] **Step 1: Write the failing test**

In `apps/web/__tests__/account-page.test.tsx`, add this test inside the `describe("Account page", ...)` block:

```tsx
  it("links the upgrade card to /plans", async () => {
    vi.mocked(apiClient.getSubscription).mockResolvedValue(SUB);
    vi.mocked(getCareerProfile).mockResolvedValue(null);
    renderPage();
    const link = await screen.findByRole("link", { name: /need more credits/i });
    expect(link).toHaveAttribute("href", "/plans");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/account-page.test.tsx`
Expected: FAIL — no `link` with an accessible name matching `/need more credits/i` (it's currently a `<div>`).

- [ ] **Step 3: Convert the card to a link**

In `apps/web/app/(app)/account/page.tsx`, replace the block that currently reads:

```tsx
          {/* Upgrade — billing not wired yet */}
          <div className="bg-surface-container-low rounded-2xl p-lg border border-outline-variant/20 flex items-start gap-md">
            <Info size={20} className="text-on-surface-variant shrink-0 mt-[2px]" />
            <div>
              <p className="text-body-md text-on-surface font-medium">Need more credits?</p>
              <p className="text-body-sm text-on-surface-variant mt-xs">
                Paid plans with a monthly credit refill are coming soon.
              </p>
            </div>
          </div>
```

with:

```tsx
          {/* Upgrade */}
          <Link
            href="/plans"
            className="bg-surface-container-low rounded-2xl p-lg border border-outline-variant/20 flex items-center justify-between gap-md hover:bg-surface-container transition-colors"
          >
            <div className="flex items-start gap-md">
              <Info size={20} className="text-on-surface-variant shrink-0 mt-[2px]" />
              <div>
                <p className="text-body-md text-on-surface font-medium">Need more credits?</p>
                <p className="text-body-sm text-on-surface-variant mt-xs">
                  See plans — Premium refills your credits every month.
                </p>
              </div>
            </div>
            <ArrowRight size={18} className="text-on-surface-variant shrink-0" />
          </Link>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/account-page.test.tsx`
Expected: PASS (6 tests: the 5 existing + the new one).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(app)/account/page.tsx" apps/web/__tests__/account-page.test.tsx
git commit -m "feat(web): /account upgrade card links to /plans"
```

---

## Task 7: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full frontend suite**

Run (from `apps/web`): `npx vitest run`
Expected: all pass. Baseline before this plan was 293 tests / 33 files; after: +3 files (`PlansComparison`, `UpgradeModal`, `plans-page`, `onboarding-page` = +4 files actually) and roughly +11 tests. Confirm 0 failures.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Run the full API suite**

Run (from `apps/api`, venv active): `.venv/Scripts/python.exe -m pytest -q`
Expected: all pass (364).

- [ ] **Step 4: If anything fails**, fix it in place and amend the relevant task's commit or add a `fix:` commit. Do not leave the suite red.

---

## Self-Review

**Spec coverage:**
- §1 backend catalog + `GET /plans` → Task 1. ✓
- §2 `PlansComparison` (props, labels, skeleton, `["plans"]` key) → Task 2. ✓ `UpgradeModal` → Task 3. ✓ `Plan` type + `getPlans` → Task 2. ✓
- §3 Surface A `/plans` page + middleware guard → Task 4. ✓ Surface B onboarding step 3 → Task 5. ✓ Surface C `/account` link → Task 6. ✓
- §4 tests: `test_plans_router` → T1; `PlansComparison.test` → T2; `plans-page.test` → T4; `onboarding-page.test` → T5; `account-page.test` extension → T6; (`UpgradeModal.test` → T3, extra, fine). ✓
- §5 file list → matches the File Structure table. ✓
- §6 out-of-scope — no task touches payments/webhooks/tables/`spend_credits`/`resolve_subscription`/schema/`GET /me/subscription`. ✓
- §7 seams — informational; Task 4 & Task 5 both isolate the `id === "premium"` branch as the single swap point, matching the spec. ✓

**Placeholder scan:** No "TBD/TODO/handle edge cases/similar to Task N". Every code step has a full code block. The one conditional instruction (Task 5 Step 4, remove `skipping` state only if the compiler flags it) states the exact fallback code. ✓

**Type consistency:** `Plan` fields (`id, name, price_usd, period, credits, refills, features`) are identical in the spec, the Python `PLANS` dicts (Task 1), the TS interface (Task 2), and every test fixture. `PlansComparison` props (`currentPlan`, `onChoosePlan`, `variant`) are identical across Task 2's definition and Tasks 4/5's usage. Button labels (`"Get Premium"`, `"Continue on Free"`, `"Current plan"`, `"Got it"`) match between component (T2/T3) and every test that queries them (T2/T4/T5). React Query key `["plans"]` is consistent (T2 component, no other consumer). ✓

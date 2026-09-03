# Plans & Pricing UI — Design

**Date:** 2026-09-03
**Status:** approved (design), pending implementation plan
**Scope:** presentation only — no payment provider, no webhooks, no new tables

## Goal

Give the app a real plans/pricing surface: a Free vs Premium comparison shown
to every new user during onboarding and reachable any time from Account.
Checkout is deliberately stubbed ("Payments launching soon") until Razorpay
integration lands with GST registration. The design leaves clean seams so
that later work slots in behind the existing "Get Premium" button.

## Context (already in place)

- `subscriptions` table: `plan`, `status`, `credits_remaining`,
  `credits_allotment`, `current_period_start/end`, `provider`,
  `provider_subscription_id` (last two unused until billing).
- `app/core/credits.py`: `PLAN_CREDITS = {"free": 50, "premium": 600}`,
  `CREDIT_COSTS`, `resolve_subscription()` (lazy-creates a free row on first
  touch), `spend_credits()`, `subscription_public()`.
- `GET /me/subscription` returns the user's plan + balance + `costs`.
- `/account` page has a static "Need more credits? / Paid plans coming soon"
  card.
- New-user flow: `register` → `/onboarding` (step 1 mandatory details →
  `upsertCareerProfile`; step 2 optional résumé upload) → `/dashboard`. The
  OAuth `callback` and `middleware.ts` gate onboarding on the absence of a
  `career_profiles` row, so anyone with a profile never re-enters it.

## Plan lineup

| | Free | Premium |
|---|---|---|
| Price | $0 | **$5 / month** |
| Credits | 50, one-time (never refills) | 600, refills every 30 days |
| ≈ tailors | 5 | 60 |
| Refill | no (`current_period_end` NULL) | yes (once billing sets the period) |

Credit amounts stay sourced from `PLAN_CREDITS` — one number to change.

## 1. Backend — plan catalog

### `app/core/credits.py` — add `PLANS`

```python
PLANS = [
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

### `app/routers/plans.py` — new router

- `GET /plans` — **no auth** (static catalog, no user data). Returns
  `{"plans": PLANS}`.
- Registered in `app/main.py` alongside the other routers.

`GET /me/subscription` is unchanged. The frontend cross-references
`subscription.plan` against the catalog to mark the current plan.

## 2. Frontend — shared components

### `components/plans/PlansComparison.tsx`

The reusable Free-vs-Premium card pair. Owns no navigation or payment logic —
the caller decides what a plan choice does.

**Props**
- `currentPlan?: string` — highlights the matching card with a "Current plan"
  chip; disables that card's button.
- `onChoosePlan: (planId: string) => void`
- `variant?: "full" | "compact"` — `compact` = tighter padding, first 3
  feature bullets only (onboarding step).

**Behaviour**
- Reads the catalog via `useQuery(["plans"], () => apiClient.getPlans())`.
- Renders a light two-card skeleton until the catalog loads.
- Free card button: `Continue on Free`, or `Current plan` (disabled) when
  `currentPlan === "free"`.
- Premium card button: `Get Premium`, accent-styled, shows `$5 / month` and
  the credit line.
- Both buttons call `onChoosePlan(id)`.

### `components/plans/UpgradeModal.tsx`

The stub shown for "Get Premium".
- Title: "Payments are launching soon"
- Body: "Premium isn't purchasable yet — you're on the Free plan for now.
  We'll let you know the moment it opens."
- Single `Got it` button; `onClose` callback.
- No waitlist capture, no persistence.

### `lib/api-client.ts` / `packages/types/index.ts`

```ts
// packages/types
export interface Plan {
  id: string;
  name: string;
  price_usd: number;
  period: "month" | null;
  credits: number;
  refills: boolean;
  features: string[];
}

// api-client
getPlans: (): Promise<{ plans: Plan[] }> => request("GET", "/plans"),
```

## 3. Frontend — the three surfaces

### Surface A — `/plans` page

`app/(app)/plans/page.tsx` (auth; added to `middleware.ts`
`PROTECTED_PREFIXES`).

- Header ("Plans") + subtitle.
- `useQuery(["subscription"], apiClient.getSubscription)` for `currentPlan`.
- `<PlansComparison variant="full" currentPlan={sub?.plan} onChoosePlan={fn} />`.
- `onChoosePlan("premium")` → open `<UpgradeModal>`.
- `onChoosePlan("free")` → no-op. Every user viewing `/plans` today is on
  Free, so `currentPlan === "free"` renders that card's button as "Current
  plan" (disabled) and the callback never fires. (Downgrade-from-Premium is
  out of scope until billing exists.)

### Surface B — onboarding step 3

`app/(app)/onboarding/page.tsx`.

- `step` union `"details" | "resume"` → `"details" | "resume" | "plan"`.
- After the résumé step (upload **or** skip) → `setStep("plan")` instead of
  `finish()`.
- Renders `<PlansComparison variant="compact" onChoosePlan={fn} />` (no
  `currentPlan` — brand-new user, no subscription row yet).
- `onChoosePlan("free")` → `finish()` (existing: invalidate
  `["careerProfile"]`, `router.push("/dashboard")`).
- `onChoosePlan("premium")` → open `<UpgradeModal>`; its `Got it` → `finish()`.
- Small helper line: "You can upgrade anytime from Account."
- **No backend change.** `resolve_subscription` still lazily creates the free
  `subscriptions` row on the first `/me/subscription` call or first tailor.

### Surface C — `/account`

The "Need more credits? / Paid plans coming soon" card becomes an actionable
**"See plans →"** link to `/plans`. Same card slot, same styling.

## 4. Testing

**Backend**
- `test_plans_router.py`: `GET /plans` returns both plans without auth;
  `premium.credits == PLAN_CREDITS["premium"]`; `premium.price_usd == 5`;
  `free.refills is False`.

**Frontend** (vitest + jsdom, `apiClient` mocked)
- `PlansComparison.test.tsx`: renders both cards from a mocked catalog;
  "Current plan" chip + disabled button on the matching `currentPlan`; each
  active button fires `onChoosePlan` with the correct id.
- `plans-page.test.tsx`: "Get Premium" opens `UpgradeModal`.
- `onboarding-page.test.tsx`: reaching step 3 renders the plan cards;
  "Continue on Free" pushes `/dashboard`; "Get Premium" opens the modal and
  "Got it" then pushes `/dashboard`. (Extend an existing onboarding test if
  one exists; otherwise new file.)
- `account-page.test.tsx`: the upgrade card links to `/plans`.

## 5. Files

| New | Changed |
|---|---|
| `apps/api/app/routers/plans.py` | `apps/api/app/core/credits.py` (`PLANS`) |
| `apps/web/components/plans/PlansComparison.tsx` | `apps/api/app/main.py` (register router) |
| `apps/web/components/plans/UpgradeModal.tsx` | `apps/web/lib/api-client.ts` (`getPlans`) |
| `apps/web/app/(app)/plans/page.tsx` | `packages/types/index.ts` (`Plan`) |
| `apps/api/tests/test_plans_router.py` | `apps/web/middleware.ts` (protect `/plans`) |
| `apps/web/__tests__/components/PlansComparison.test.tsx` | `apps/web/app/(app)/onboarding/page.tsx` (step 3) |
| `apps/web/__tests__/plans-page.test.tsx` | `apps/web/app/(app)/account/page.tsx` (link) |
| `apps/web/__tests__/onboarding-page.test.tsx` (or extend) | |

## 6. Out of scope (explicit)

- Razorpay / Stripe / any payment provider, checkout widgets, order or
  payment tables.
- Webhooks and the plan-upgrade / credit-refill they trigger.
- `billing_intents` / waitlist capture.
- Annual billing, multiple paid tiers, coupons.
- Manual admin "set plan" endpoint — a paying user is flipped today with a
  direct `UPDATE subscriptions SET plan='premium', credits_remaining=600,
  credits_allotment=600, current_period_end=now()+30d`.
- Any change to `spend_credits`, `resolve_subscription`, the `subscriptions`
  schema, or `GET /me/subscription`.

## 7. Seams for the real payment work (later)

- `PlansComparison.onChoosePlan("premium")` is the single call site to swap
  from "open UpgradeModal" to "create a Razorpay order + open checkout".
- `subscriptions.provider` / `provider_subscription_id` columns already exist
  for webhook reconciliation.
- `resolve_subscription` already handles a paid plan's monthly refill when
  `current_period_end` is set — the webhook only needs to set `plan`,
  `credits_*`, and the period dates.

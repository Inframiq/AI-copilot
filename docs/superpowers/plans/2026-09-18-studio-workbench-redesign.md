# Resume Studio Workbench Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat editor/tailoring scroll at `/studio/[resumeId]` with a three-pane workbench — a step spine that makes the tailoring state machine visible, a section rail with completeness indicators, a triage deck for reviewing AI changes one at a time, and a dark preview dock.

**Architecture:** Presentation-layer rewrite only. `stores/resume-store.ts`, `stores/tailoring-store.ts` and `lib/api-client.ts` are not modified — every new component calls the same store actions the old components call. Two new pure modules (`lib/studio-steps.ts`, `lib/section-completeness.ts`) derive display state from existing store values and are unit tested in isolation. The old `EditorPanel` / `BulletReviewPanel` / `PreviewPanel` / `AtsGapFixPanel` are deleted in the final task, after their replacements are wired in.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4 (`@theme` tokens in `app/globals.css`, mirrored in `tailwind.config.ts`), Zustand 5, TanStack Query 5, Radix UI (`react-tabs`, `react-dialog`, `react-slider`, `react-collapsible`), Phosphor Icons, Vitest 3 + Testing Library (jsdom opt-in per file via a `// @vitest-environment jsdom` pragma), **motion (framer-motion) — added in Task 1**.

**Spec:** `docs/superpowers/specs/2026-09-18-studio-redesign-design.md`

## Global Constraints

- **Do not modify** `apps/web/stores/resume-store.ts`, `apps/web/stores/tailoring-store.ts`, or `apps/web/lib/api-client.ts`. If a task appears to need a store change, stop and flag it — the redesign makes existing state visible, it does not alter it.
- Every store action must be called with the **same arguments** the current code passes. Reference implementations: `components/resume/EditorPanel.tsx`, `components/resume/BulletReviewPanel.tsx`, `components/resume/PreviewPanel.tsx`.
- Spacing uses the named scale only: `xs` 4px, `sm` 8px, `md` 16px, `lg`/`gutter` 24px, `xl` 32px, `xxl` 48px, `section` 42px. No arbitrary `p-[13px]`.
- Type uses the named scale only: `text-headline-xl|lg|md`, `text-body-lg|md|sm`, `text-label-md|sm`, `text-caption`, `text-label-caps`. No `text-[15px]`.
- **Accent discipline:** `text-primary` / `bg-primary` indicate *interactive or current state only*. Headings use `text-on-surface` or `text-on-surface-variant`.
- Bullet and summary body text renders at `text-body-md` with `leading-relaxed`. Panel/section titles render at `text-label-caps` in `text-on-surface-variant`.
- Any element displaying a numeric score uses the `tabular` utility class added in Task 1.
- All animation goes through `motion/react`. The app provider wraps children in `<MotionConfig reducedMotion="user">` (Task 1), so no component needs its own reduced-motion branch.
- Run tests from `apps/web`: `npm test`. Single file: `npx vitest run __tests__/<file>`.
- Commit after every task. Commit directly to `main` — no feature branches, no PRs.
- End every commit message with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `apps/web/lib/studio-steps.ts` | Pure: store values → five `StepState`s. No React, no store import. |
| `apps/web/lib/section-completeness.ts` | Pure: `ResumeContent` → per-section completeness ratio. |
| `apps/web/components/studio/StudioShell.tsx` | Three-pane responsive grid; owns the active-section and active-step UI state. |
| `apps/web/components/studio/CommandBar.tsx` | Title inline-edit, save chip, delete, Export. |
| `apps/web/components/studio/spine/AtsRing.tsx` | Animated score ring + count-up + delta chip. |
| `apps/web/components/studio/spine/StepNode.tsx` | One spine node in its four visual states. |
| `apps/web/components/studio/spine/StepSpine.tsx` | Lays out nodes + spring-filled connectors + `AtsRing`. |
| `apps/web/components/studio/rail/CompletenessRing.tsx` | Small `pathLength`-animated ratio ring. |
| `apps/web/components/studio/rail/SectionRow.tsx` | One rail row (+ optional sub-entries, change badge). |
| `apps/web/components/studio/rail/SectionRail.tsx` | Rail container, footer count, hosts `BoostPanel`. |
| `apps/web/components/studio/rail/BoostPanel.tsx` | Relocated ATS gap→fix list. |
| `apps/web/components/studio/canvas/ContactSection.tsx` | Contact fields + photo control. |
| `apps/web/components/studio/canvas/SummarySection.tsx` | Summary textarea + word cap. |
| `apps/web/components/studio/canvas/ExperienceSection.tsx` | Experience entry stack + merge affordance. |
| `apps/web/components/studio/canvas/EducationSection.tsx` | Education entry stack. |
| `apps/web/components/studio/canvas/SkillsSection.tsx` | Chip editor for skills. |
| `apps/web/components/studio/canvas/ExtrasSection.tsx` | Languages, certifications, awards. |
| `apps/web/components/studio/review/ChangeCard.tsx` | One bullet change: importance rail, was/now, inline edit, actions. |
| `apps/web/components/studio/review/SummaryCard.tsx` | Summary as a deck card. |
| `apps/web/components/studio/review/SkillsCard.tsx` | Skills keep/drop + suggested chips as a deck card. |
| `apps/web/components/studio/review/DeckList.tsx` | "See all" list + take-all-remaining. |
| `apps/web/components/studio/review/TriageDeck.tsx` | Queue, stack animation, keyboard, undo. |
| `apps/web/components/studio/preview/PreviewDock.tsx` | Dark desk, cross-fading iframe, zoom. |
| `apps/web/components/studio/preview/DockToolbar.tsx` | Floating segmented toolbar + popover host. |
| `apps/web/components/studio/preview/TemplateGallery.tsx` | Thumbnail template picker. |
| `apps/web/components/studio/preview/TypePopover.tsx` | Typeface specimens + accent swatches. |
| `apps/web/components/studio/preview/SpacingPopover.tsx` | Density preset cards + custom sliders. |

**Modified**

| File | Change |
|---|---|
| `apps/web/app/globals.css` | Add plane + `tabular` tokens. |
| `apps/web/tailwind.config.ts` | Mirror the new color tokens. |
| `apps/web/app/providers.tsx` | Wrap in `<MotionConfig reducedMotion="user">`. |
| `apps/web/app/(app)/studio/[resumeId]/page.tsx` | Render `StudioShell`; drop header/split-pane markup. |
| `apps/web/app/(app)/jd/[jdId]/page.tsx` | Remove the duplicate `Open` button. |
| `apps/web/package.json` | Add `motion`. |

**Deleted (Task 12, after replacements are wired)**

`components/resume/EditorPanel.tsx`, `components/resume/BulletReviewPanel.tsx`, `components/resume/PreviewPanel.tsx`, `components/resume/AtsGapFixPanel.tsx`, `components/resume/HumanizeSlider.tsx`, `__tests__/humanize-slider.test.tsx`.

**Kept and reused:** `components/resume/ImportanceBadge.tsx`, `SkillsDelta.tsx`, `UnderfillWarning.tsx`, `PhotoRequirementModal.tsx`, `ResumePreviewModal.tsx`.

---

### Task 1: Foundation — motion, planes, tabular numerals

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/tailwind.config.ts`
- Modify: `apps/web/app/providers.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: Tailwind classes `bg-desk`, `text-on-desk`, `bg-desk-raised`, `border-desk-line`, and the utility class `tabular`. The `motion/react` package resolvable from `apps/web`. `<MotionConfig reducedMotion="user">` active app-wide.

- [ ] **Step 1: Install motion**

From the repo root (`D:\AI-Copilot`):

```bash
npm install motion -w web
```

- [ ] **Step 2: Verify it resolves**

```bash
cd apps/web && node -e "console.log(require.resolve('motion/package.json'))"
```

Expected: a path under `node_modules/motion`. If it fails, re-run Step 1 from the repo root, not from `apps/web`.

- [ ] **Step 3: Add the plane tokens to globals.css**

Open `apps/web/app/globals.css` and find the `@theme` block containing `--color-surface-container`. Add these lines inside the same block:

```css
  /* Desk — the recessed plane the rendered resume page floats on.
     Deliberately dark: a white page on a near-white background has no
     separation, which is what made the old preview pane read flat. */
  --color-desk: #1a1c22;
  --color-desk-raised: #23262e;
  --color-desk-line: #343842;
  --color-on-desk: #b9bcc6;
```

- [ ] **Step 4: Add the tabular utility to globals.css**

Append to the end of `apps/web/app/globals.css`:

```css
/* Scores and any animated counter — without this, count-up animations
   jitter as glyph widths change between frames. */
.tabular {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
}
```

- [ ] **Step 5: Mirror the tokens in tailwind.config.ts**

In `apps/web/tailwind.config.ts`, inside `theme.extend.colors`, after the `"on-success-container"` entry, add:

```ts
        // Desk plane — keep in sync with app/globals.css @theme.
        "desk": "#1a1c22",
        "desk-raised": "#23262e",
        "desk-line": "#343842",
        "on-desk": "#b9bcc6",
```

- [ ] **Step 6: Wrap the app in MotionConfig**

In `apps/web/app/providers.tsx`, add the import:

```tsx
import { MotionConfig } from "motion/react";
```

Then wrap whatever the component currently returns so `MotionConfig` is the outermost element inside the existing provider tree. For example, if it returns `<QueryClientProvider client={qc}>{children}</QueryClientProvider>`, change it to:

```tsx
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MotionConfig>
```

`reducedMotion="user"` makes every `motion` component in the app respect `prefers-reduced-motion` without per-component branching.

- [ ] **Step 7: Verify the app still builds**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/package.json apps/web/app/globals.css apps/web/tailwind.config.ts apps/web/app/providers.tsx package-lock.json
git commit -m "$(cat <<'EOF'
feat(studio): add motion, desk plane tokens and tabular numerals

Foundation for the studio workbench redesign: the recessed dark "desk"
plane the resume page will float on, a tabular-numerals utility so score
count-ups don't jitter, and MotionConfig reducedMotion="user" so every
animation degrades without per-component branching.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `lib/studio-steps.ts` — derive the step spine's state

**Files:**
- Create: `apps/web/lib/studio-steps.ts`
- Test: `apps/web/__tests__/studio-steps.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `type StepId = "source" | "match" | "review" | "polish" | "export"`
  - `type StepStatus = "done" | "current" | "available" | "locked"`
  - `interface StepInput { jdId: string | null; jdText: string; atsScore: number | null; pendingContent: unknown | null; previewPdfUrl: string | null; pdfSignedUrl: string | null; isDirty: boolean; hasSavedRender: boolean }`
  - `interface Step { id: StepId; label: string; status: StepStatus; lockedReason?: string }`
  - `function deriveSteps(input: StepInput): Step[]` — always returns five steps in fixed order.
  - `function currentStepId(steps: Step[]): StepId`

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/studio-steps.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deriveSteps, currentStepId, type StepInput } from "../lib/studio-steps";

const base: StepInput = {
  jdId: null,
  jdText: "",
  atsScore: null,
  pendingContent: null,
  previewPdfUrl: null,
  pdfSignedUrl: null,
  isDirty: false,
  hasSavedRender: false,
};

const byId = (input: StepInput) =>
  Object.fromEntries(deriveSteps(input).map((s) => [s.id, s.status]));

describe("deriveSteps", () => {
  it("returns the five steps in fixed order", () => {
    expect(deriveSteps(base).map((s) => s.id)).toEqual([
      "source",
      "match",
      "review",
      "polish",
      "export",
    ]);
  });

  it("with nothing done, source is current and everything after it is locked", () => {
    expect(byId(base)).toEqual({
      source: "current",
      match: "locked",
      review: "locked",
      polish: "locked",
      export: "locked",
    });
  });

  it("treats a pasted JD as source-complete, same as one from the analyzer", () => {
    expect(byId({ ...base, jdText: "  Senior Engineer  " }).source).toBe("done");
    expect(byId({ ...base, jdId: "jd-1" }).source).toBe("done");
  });

  it("ignores whitespace-only jdText", () => {
    expect(byId({ ...base, jdText: "   " }).source).toBe("current");
  });

  it("unlocks match once a JD exists, and marks it done once analysis has run", () => {
    expect(byId({ ...base, jdId: "jd-1" }).match).toBe("current");
    expect(byId({ ...base, jdId: "jd-1", atsScore: 72 }).match).toBe("done");
  });

  it("makes review current when tailoring has produced pending content", () => {
    const s = byId({ ...base, jdId: "jd-1", atsScore: 72, pendingContent: {} });
    expect(s.review).toBe("current");
    expect(s.polish).toBe("locked");
  });

  it("unlocks polish and export once a render exists", () => {
    const s = byId({
      ...base,
      jdId: "jd-1",
      atsScore: 72,
      pendingContent: {},
      previewPdfUrl: "https://example.test/a.pdf",
    });
    expect(s.review).toBe("done");
    expect(s.polish).toBe("current");
    expect(s.export).toBe("available");
  });

  it("accepts a plain saved pdf as a render, with no tailoring session", () => {
    expect(byId({ ...base, pdfSignedUrl: "https://example.test/a.pdf" }).polish).toBe("current");
  });

  it("marks export done only when a render is saved and nothing is dirty", () => {
    const rendered = { ...base, pdfSignedUrl: "https://example.test/a.pdf" };
    expect(byId({ ...rendered, hasSavedRender: true, isDirty: true }).export).toBe("available");
    expect(byId({ ...rendered, hasSavedRender: true, isDirty: false }).export).toBe("done");
  });

  it("gives every locked step a reason naming what unlocks it", () => {
    for (const step of deriveSteps(base)) {
      if (step.status === "locked") {
        expect(step.lockedReason, `${step.id} must explain its lock`).toBeTruthy();
      }
    }
  });
});

describe("currentStepId", () => {
  it("returns the step marked current", () => {
    expect(currentStepId(deriveSteps({ ...base, jdId: "jd-1" }))).toBe("match");
  });

  it("falls back to the last done step when nothing is current", () => {
    const steps = deriveSteps({
      ...base,
      jdId: "jd-1",
      atsScore: 72,
      pendingContent: {},
      pdfSignedUrl: "https://example.test/a.pdf",
      hasSavedRender: true,
      isDirty: false,
    });
    expect(currentStepId(steps)).toBe("export");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/web && npx vitest run __tests__/studio-steps.test.ts
```

Expected: FAIL — `Cannot find module '../lib/studio-steps'`.

- [ ] **Step 3: Implement**

Create `apps/web/lib/studio-steps.ts`:

```ts
// Derives the studio step spine's display state from values the stores
// already hold. Deliberately pure and store-free: the spine exposes the
// tailoring flow that EditorPanel used to switch on invisibly
// (hasJdContext / pendingContent / neither), so the derivation is worth
// testing on its own rather than through a component.

export type StepId = "source" | "match" | "review" | "polish" | "export";
export type StepStatus = "done" | "current" | "available" | "locked";

export interface StepInput {
  /** Set when the user arrived from the JD analyzer. */
  jdId: string | null;
  /** Set when the user pasted a JD directly in the studio. */
  jdText: string;
  atsScore: number | null;
  /** tailoring-store's pendingContent — shape is irrelevant here. */
  pendingContent: unknown | null;
  /** Render produced by the tailoring preview. */
  previewPdfUrl: string | null;
  /** Render produced outside tailoring (plain studio preview / export). */
  pdfSignedUrl: string | null;
  isDirty: boolean;
  /** A render has been persisted to the resume, not just held in memory. */
  hasSavedRender: boolean;
}

export interface Step {
  id: StepId;
  label: string;
  status: StepStatus;
  /** Present only when status is "locked" — shown as the node's tooltip. */
  lockedReason?: string;
}

const LABELS: Record<StepId, string> = {
  source: "Source",
  match: "Match",
  review: "Review",
  polish: "Polish",
  export: "Export",
};

export function deriveSteps(input: StepInput): Step[] {
  const hasJd = !!input.jdId || input.jdText.trim().length > 0;
  const hasAnalysis = input.atsScore !== null;
  const hasPending = input.pendingContent !== null;
  const hasRender = !!(input.previewPdfUrl || input.pdfSignedUrl);
  const exported = input.hasSavedRender && !input.isDirty;

  // Each entry: [id, done, unlocked, lockedReason].
  // "review" is done once a render exists — the user has moved past the
  // decision queue — not merely because pending content arrived.
  const raw: Array<[StepId, boolean, boolean, string]> = [
    ["source", hasJd, true, ""],
    ["match", hasAnalysis, hasJd, "Add a job description first"],
    ["review", hasRender, hasPending, "Run Tailor to generate changes"],
    ["polish", exported, hasRender, "Generate a preview first"],
    ["export", exported, hasRender, "Generate a preview first"],
  ];

  // The current step is the furthest unlocked step still outstanding, so
  // opening a already-rendered resume lands on Polish rather than dragging
  // the user back to Source. Export is the exception: a render existing
  // does not mean the review queue is finished, so Export only becomes
  // current once nothing earlier is outstanding.
  const outstanding = raw
    .map(([id], i) => ({ id, i }))
    .filter(({ i }) => raw[i][2] && !raw[i][1]);
  const eligible =
    outstanding.length > 1 && outstanding[outstanding.length - 1].id === "export"
      ? outstanding.slice(0, -1)
      : outstanding;
  const currentIndex = eligible.length > 0 ? eligible[eligible.length - 1].i : -1;

  return raw.map(([id, done, unlocked, lockedReason], i) => {
    if (!unlocked) {
      return { id, label: LABELS[id], status: "locked" as const, lockedReason };
    }
    if (done) return { id, label: LABELS[id], status: "done" as const };
    return {
      id,
      label: LABELS[id],
      status: i === currentIndex ? ("current" as const) : ("available" as const),
    };
  });
}

export function currentStepId(steps: Step[]): StepId {
  const current = steps.find((s) => s.status === "current");
  if (current) return current.id;
  const done = steps.filter((s) => s.status === "done");
  return done.length > 0 ? done[done.length - 1].id : "source";
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run __tests__/studio-steps.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/studio-steps.ts apps/web/__tests__/studio-steps.test.ts
git commit -m "$(cat <<'EOF'
feat(studio): derive step-spine state from existing store values

Pure module mapping jdId/jdText, atsScore, pendingContent and the two
render URLs onto five step states. This is the tailoring flow EditorPanel
used to switch on invisibly, made explicit and testable.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `lib/section-completeness.ts` — rail completeness rings

**Files:**
- Create: `apps/web/lib/section-completeness.ts`
- Test: `apps/web/__tests__/section-completeness.test.ts`

**Interfaces:**
- Consumes: `ResumeContent` from `@career-copilot/types`.
- Produces:
  - `type SectionId = "contact" | "summary" | "experience" | "education" | "skills" | "extras"`
  - `interface SectionState { id: SectionId; label: string; ratio: number; complete: boolean }`
  - `function sectionStates(content: ResumeContent | null): SectionState[]`
  - `function completeCount(states: SectionState[]): { complete: number; total: number }`

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/section-completeness.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sectionStates, completeCount } from "../lib/section-completeness";
import type { ResumeContent } from "@career-copilot/types";

const empty: ResumeContent = {
  contact: { name: "", email: "" },
  experience: [],
  education: [],
  skills: [],
};

const ratios = (c: ResumeContent | null) =>
  Object.fromEntries(sectionStates(c).map((s) => [s.id, s.ratio]));

describe("sectionStates", () => {
  it("returns the six sections in rail order", () => {
    expect(sectionStates(empty).map((s) => s.id)).toEqual([
      "contact",
      "summary",
      "experience",
      "education",
      "skills",
      "extras",
    ]);
  });

  it("reports every section empty for null content", () => {
    for (const s of sectionStates(null)) {
      expect(s.ratio).toBe(0);
      expect(s.complete).toBe(false);
    }
  });

  it("scores contact by how many of its six fields are filled", () => {
    expect(ratios(empty).contact).toBe(0);
    const partial: ResumeContent = {
      ...empty,
      contact: { name: "Jordan", email: "j@example.test", phone: "555" },
    };
    expect(ratios(partial).contact).toBeCloseTo(0.5);
  });

  it("ignores whitespace-only contact fields", () => {
    const c: ResumeContent = { ...empty, contact: { name: "  ", email: "  " } };
    expect(ratios(c).contact).toBe(0);
  });

  it("treats summary as all-or-nothing", () => {
    expect(ratios({ ...empty, summary: "" }).summary).toBe(0);
    expect(ratios({ ...empty, summary: "Engineer." }).summary).toBe(1);
  });

  it("scores experience on entries that have both a role and at least one bullet", () => {
    const one: ResumeContent = {
      ...empty,
      experience: [{ company: "Stripe", title: "SWE", start: "2021", bullets: ["Shipped"] }],
    };
    expect(ratios(one).experience).toBe(1);

    const hollow: ResumeContent = {
      ...empty,
      experience: [{ company: "Stripe", title: "SWE", start: "2021", bullets: [] }],
    };
    expect(ratios(hollow).experience).toBeCloseTo(0.5);
  });

  it("caps skills at eight for a full ring", () => {
    expect(ratios({ ...empty, skills: ["a", "b", "c", "d"] }).skills).toBeCloseTo(0.5);
    expect(ratios({ ...empty, skills: Array(20).fill("x") }).skills).toBe(1);
  });

  it("marks a section complete only at a full ratio", () => {
    const states = sectionStates({ ...empty, summary: "Engineer." });
    expect(states.find((s) => s.id === "summary")!.complete).toBe(true);
    expect(states.find((s) => s.id === "skills")!.complete).toBe(false);
  });
});

describe("completeCount", () => {
  it("counts complete sections against the total", () => {
    expect(completeCount(sectionStates(empty))).toEqual({ complete: 0, total: 6 });
    expect(completeCount(sectionStates({ ...empty, summary: "x" }))).toEqual({
      complete: 1,
      total: 6,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/web && npx vitest run __tests__/section-completeness.test.ts
```

Expected: FAIL — `Cannot find module '../lib/section-completeness'`.

- [ ] **Step 3: Implement**

Create `apps/web/lib/section-completeness.ts`:

```ts
// Drives the section rail's completeness rings. The old tab strip gave no
// signal about what was filled in; these ratios are what replaces that
// silence. Pure and store-free so the thresholds can be tested directly.

import type { ResumeContent } from "@career-copilot/types";

export type SectionId =
  | "contact"
  | "summary"
  | "experience"
  | "education"
  | "skills"
  | "extras";

export interface SectionState {
  id: SectionId;
  label: string;
  /** 0..1 — how filled this section is. */
  ratio: number;
  complete: boolean;
}

/** Skills past this count add no more ring; eight reads as a full set. */
const SKILLS_TARGET = 8;

const filled = (v: string | undefined | null) => !!v && v.trim().length > 0;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function contactRatio(content: ResumeContent): number {
  const c = content.contact;
  const fields = [c.name, c.email, c.phone, c.location, c.linkedin, c.github];
  return fields.filter(filled).length / fields.length;
}

function experienceRatio(content: ResumeContent): number {
  if (content.experience.length === 0) return 0;
  // A role with no bullets is half an entry — it renders as a heading with
  // nothing under it, which is the most common half-finished state.
  const scored = content.experience.map((job) => {
    const hasRole = filled(job.company) || filled(job.title);
    const hasBullets = job.bullets.some(filled);
    return (hasRole ? 0.5 : 0) + (hasBullets ? 0.5 : 0);
  });
  return clamp01(scored.reduce((a, b) => a + b, 0) / content.experience.length);
}

function educationRatio(content: ResumeContent): number {
  if (content.education.length === 0) return 0;
  const scored = content.education.map((e) =>
    filled(e.institution) && filled(e.degree) ? 1 : 0.5
  );
  return clamp01(scored.reduce((a, b) => a + b, 0) / content.education.length);
}

function extrasRatio(content: ResumeContent): number {
  const buckets = [
    (content.languages ?? []).length > 0,
    (content.certifications ?? []).length > 0,
    (content.awards ?? []).length > 0,
  ];
  return buckets.filter(Boolean).length / buckets.length;
}

const LABELS: Record<SectionId, string> = {
  contact: "Contact",
  summary: "Summary",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
  extras: "Extras",
};

export function sectionStates(content: ResumeContent | null): SectionState[] {
  const ratios: Record<SectionId, number> = content
    ? {
        contact: contactRatio(content),
        summary: filled(content.summary) ? 1 : 0,
        experience: experienceRatio(content),
        education: educationRatio(content),
        skills: clamp01(content.skills.filter(filled).length / SKILLS_TARGET),
        extras: extrasRatio(content),
      }
    : { contact: 0, summary: 0, experience: 0, education: 0, skills: 0, extras: 0 };

  return (Object.keys(LABELS) as SectionId[]).map((id) => ({
    id,
    label: LABELS[id],
    ratio: ratios[id],
    complete: ratios[id] >= 1,
  }));
}

export function completeCount(states: SectionState[]): {
  complete: number;
  total: number;
} {
  return {
    complete: states.filter((s) => s.complete).length,
    total: states.length,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run __tests__/section-completeness.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/section-completeness.ts apps/web/__tests__/section-completeness.test.ts
git commit -m "$(cat <<'EOF'
feat(studio): compute per-section completeness for the rail

Ratios driving the rail's completeness rings. Replaces the old tab
strip's total silence about which sections are actually filled in.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The step spine and ATS ring

**Files:**
- Create: `apps/web/components/studio/spine/AtsRing.tsx`
- Create: `apps/web/components/studio/spine/StepNode.tsx`
- Create: `apps/web/components/studio/spine/StepSpine.tsx`
- Test: `apps/web/__tests__/components/step-spine.test.tsx`

**Interfaces:**
- Consumes: `deriveSteps`, `Step`, `StepId`, `StepStatus` from `@/lib/studio-steps` (Task 2); the `tabular` class and `motion/react` from Task 1.
- Produces:
  - `AtsRing({ score, projected, size }: { score: number | null; projected: number | null; size?: number })`
  - `StepNode({ step, index, isActive, onSelect }: { step: Step; index: number; isActive: boolean; onSelect: (id: StepId) => void })`
  - `StepSpine({ steps, activeStep, onSelect, score, projected }: { steps: Step[]; activeStep: StepId; onSelect: (id: StepId) => void; score: number | null; projected: number | null })`

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/components/step-spine.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StepSpine } from "../../components/studio/spine/StepSpine";
import { deriveSteps, type StepInput } from "../../lib/studio-steps";

const base: StepInput = {
  jdId: null,
  jdText: "",
  atsScore: null,
  pendingContent: null,
  previewPdfUrl: null,
  pdfSignedUrl: null,
  isDirty: false,
  hasSavedRender: false,
};

describe("StepSpine", () => {
  it("renders all five step labels", () => {
    render(
      <StepSpine
        steps={deriveSteps(base)}
        activeStep="source"
        onSelect={() => {}}
        score={null}
        projected={null}
      />
    );
    for (const label of ["Source", "Match", "Review", "Polish", "Export"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("disables locked steps and exposes their reason as the accessible name", () => {
    render(
      <StepSpine
        steps={deriveSteps(base)}
        activeStep="source"
        onSelect={() => {}}
        score={null}
        projected={null}
      />
    );
    const review = screen.getByRole("button", { name: /Review/ });
    expect(review).toBeDisabled();
    expect(review).toHaveAccessibleName(/Run Tailor to generate changes/);
  });

  it("calls onSelect for an unlocked step", async () => {
    const onSelect = vi.fn();
    render(
      <StepSpine
        steps={deriveSteps({ ...base, jdId: "jd-1" })}
        activeStep="source"
        onSelect={onSelect}
        score={null}
        projected={null}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /Match/ }));
    expect(onSelect).toHaveBeenCalledWith("match");
  });

  it("marks the active step with aria-current", () => {
    render(
      <StepSpine
        steps={deriveSteps({ ...base, jdId: "jd-1" })}
        activeStep="match"
        onSelect={() => {}}
        score={null}
        projected={null}
      />
    );
    expect(screen.getByRole("button", { name: /Match/ })).toHaveAttribute(
      "aria-current",
      "step"
    );
  });

  it("shows the score and a delta chip when a projection differs", () => {
    render(
      <StepSpine
        steps={deriveSteps(base)}
        activeStep="source"
        onSelect={() => {}}
        score={72}
        projected={81}
      />
    );
    expect(screen.getByLabelText(/ATS match 72%, projected 81%/)).toBeInTheDocument();
    expect(screen.getByText("+9")).toBeInTheDocument();
  });

  it("omits the delta chip when the projection matches the score", () => {
    render(
      <StepSpine
        steps={deriveSteps(base)}
        activeStep="source"
        onSelect={() => {}}
        score={72}
        projected={72}
      />
    );
    expect(screen.queryByText("+0")).not.toBeInTheDocument();
  });

  it("renders no score chip at all before analysis has run", () => {
    render(
      <StepSpine
        steps={deriveSteps(base)}
        activeStep="source"
        onSelect={() => {}}
        score={null}
        projected={null}
      />
    );
    expect(screen.queryByLabelText(/ATS match/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/web && npx vitest run __tests__/components/step-spine.test.tsx
```

Expected: FAIL — cannot resolve `../../components/studio/spine/StepSpine`.

- [ ] **Step 3: Implement AtsRing**

Create `apps/web/components/studio/spine/AtsRing.tsx`:

```tsx
"use client";
import { useEffect } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";

// The ATS score is the single most motivating number in the product; the
// old UI rendered it at 11px in three different places. Here it gets one
// home, at size, with the ring and the number animating to any projected
// value so a decision in the triage deck reads as visible progress.
export function AtsRing({
  score,
  projected,
  size = 52,
}: {
  score: number | null;
  projected: number | null;
  size?: number;
}) {
  const shown = projected ?? score;
  const delta = score !== null && projected !== null ? projected - score : 0;

  const value = useMotionValue(shown ?? 0);
  const spring = useSpring(value, { stiffness: 120, damping: 22 });
  const display = useTransform(spring, (v) => Math.round(v).toString());
  const pathLength = useTransform(spring, (v) => Math.max(0, Math.min(1, v / 100)));

  useEffect(() => {
    if (shown !== null) value.set(shown);
  }, [shown, value]);

  if (shown === null) return null;

  const stroke = shown >= 80 ? "var(--color-success)" : shown >= 60 ? "var(--color-primary)" : "var(--color-error)";
  const r = (size - 6) / 2;

  return (
    <div
      className="flex items-center gap-sm"
      aria-label={
        projected !== null && score !== null && projected !== score
          ? `ATS match ${score}%, projected ${projected}%`
          : `ATS match ${shown}%`
      }
    >
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={3}
            className="stroke-outline-variant/40"
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={3}
            strokeLinecap="round"
            stroke={stroke}
            style={{ pathLength }}
          />
        </svg>
        <motion.span
          className="tabular absolute inset-0 flex items-center justify-center text-label-md font-bold text-on-surface"
        >
          {display}
        </motion.span>
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-label-caps text-on-surface-variant">ATS</span>
        {delta !== 0 && (
          <motion.span
            initial={{ opacity: 0, y: 4, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 28 }}
            className={`tabular text-caption font-bold ${
              delta > 0 ? "text-success" : "text-error"
            }`}
          >
            {delta > 0 ? `+${delta}` : `${delta}`}
          </motion.span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement StepNode**

Create `apps/web/components/studio/spine/StepNode.tsx`:

```tsx
"use client";
import { Check } from "@phosphor-icons/react";
import { motion } from "motion/react";
import type { Step, StepId } from "@/lib/studio-steps";

const DOT: Record<Step["status"], string> = {
  done: "bg-primary text-on-primary border-primary",
  current: "bg-surface text-primary border-primary",
  available: "bg-surface text-on-surface-variant border-outline-variant",
  locked: "bg-surface text-outline border-outline-variant/40 opacity-40",
};

export function StepNode({
  step,
  index,
  isActive,
  onSelect,
}: {
  step: Step;
  index: number;
  isActive: boolean;
  onSelect: (id: StepId) => void;
}) {
  const locked = step.status === "locked";
  return (
    <button
      type="button"
      disabled={locked}
      aria-current={isActive ? "step" : undefined}
      // The locked reason rides in the accessible name so the UI teaches
      // the flow instead of presenting a dead control with no explanation.
      aria-label={locked ? `${step.label} — ${step.lockedReason}` : step.label}
      title={locked ? step.lockedReason : undefined}
      onClick={() => !locked && onSelect(step.id)}
      className={`group flex items-center gap-sm shrink-0 ${
        locked ? "cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      <span
        className={`relative flex items-center justify-center w-7 h-7 rounded-full border-2 text-caption font-bold transition-colors ${DOT[step.status]}`}
      >
        {step.status === "done" ? <Check size={14} weight="bold" /> : index + 1}
        {step.status === "current" && (
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full border-2 border-primary"
            animate={{ scale: [1, 1.35], opacity: [0.5, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
          />
        )}
      </span>
      <span
        className={`text-label-caps whitespace-nowrap transition-colors ${
          isActive
            ? "text-on-surface font-bold"
            : locked
            ? "text-outline"
            : "text-on-surface-variant group-hover:text-on-surface"
        }`}
      >
        {step.label}
      </span>
    </button>
  );
}
```

- [ ] **Step 5: Implement StepSpine**

Create `apps/web/components/studio/spine/StepSpine.tsx`:

```tsx
"use client";
import { motion } from "motion/react";
import type { Step, StepId } from "@/lib/studio-steps";
import { StepNode } from "./StepNode";
import { AtsRing } from "./AtsRing";

export function StepSpine({
  steps,
  activeStep,
  onSelect,
  score,
  projected,
}: {
  steps: Step[];
  activeStep: StepId;
  onSelect: (id: StepId) => void;
  score: number | null;
  projected: number | null;
}) {
  return (
    <div className="flex items-center gap-md px-lg h-16 border-b border-outline-variant/20 bg-surface-container-lowest/80 backdrop-blur-md">
      <nav
        aria-label="Tailoring progress"
        className="flex items-center gap-sm flex-1 min-w-0 overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
      >
        {steps.map((step, i) => (
          <div key={step.id} className="flex items-center gap-sm shrink-0">
            <StepNode
              step={step}
              index={i}
              isActive={step.id === activeStep}
              onSelect={onSelect}
            />
            {i < steps.length - 1 && (
              <span aria-hidden className="relative h-0.5 w-8 sm:w-12 bg-outline-variant/30 rounded-full overflow-hidden">
                <motion.span
                  className="absolute inset-0 origin-left bg-primary rounded-full"
                  initial={false}
                  animate={{ scaleX: step.status === "done" ? 1 : 0 }}
                  transition={{ type: "spring", stiffness: 140, damping: 24 }}
                />
              </span>
            )}
          </div>
        ))}
      </nav>
      <AtsRing score={score} projected={projected} />
    </div>
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run __tests__/components/step-spine.test.tsx
```

Expected: PASS, 7 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/studio/spine apps/web/__tests__/components/step-spine.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio): add the step spine and ATS ring

Makes the tailoring flow visible: five nodes with done/current/available/
locked states, spring-filled connectors, and locked reasons carried in the
accessible name so the UI teaches the flow. The ATS score moves from 11px
caption text into an animated ring with a projected-delta chip.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The section rail

**Files:**
- Create: `apps/web/components/studio/rail/CompletenessRing.tsx`
- Create: `apps/web/components/studio/rail/SectionRow.tsx`
- Create: `apps/web/components/studio/rail/SectionRail.tsx`
- Test: `apps/web/__tests__/components/section-rail.test.tsx`

**Interfaces:**
- Consumes: `sectionStates`, `completeCount`, `SectionId`, `SectionState` from `@/lib/section-completeness` (Task 3).
- Produces:
  - `CompletenessRing({ ratio, size }: { ratio: number; size?: number })`
  - `SectionRow({ state, isActive, entries, pendingChanges, onSelect, onSelectEntry }: { state: SectionState; isActive: boolean; entries?: string[]; pendingChanges?: number; onSelect: (id: SectionId) => void; onSelectEntry?: (id: SectionId, index: number) => void })`
  - `SectionRail({ content, activeSection, onSelect, onSelectEntry, pendingBySection, footer }: { content: ResumeContent | null; activeSection: SectionId; onSelect: (id: SectionId) => void; onSelectEntry?: (id: SectionId, index: number) => void; pendingBySection?: Partial<Record<SectionId, number>>; footer?: React.ReactNode })`

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/components/section-rail.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SectionRail } from "../../components/studio/rail/SectionRail";
import type { ResumeContent } from "@career-copilot/types";

const content: ResumeContent = {
  contact: { name: "Jordan", email: "j@example.test" },
  summary: "Engineer.",
  experience: [
    { company: "Stripe", title: "SWE", start: "2021", bullets: ["Shipped"] },
    { company: "Meta", title: "SWE", start: "2019", bullets: ["Built"] },
  ],
  education: [],
  skills: ["TypeScript"],
};

describe("SectionRail", () => {
  it("renders a row per section", () => {
    render(<SectionRail content={content} activeSection="contact" onSelect={() => {}} />);
    for (const label of ["Contact", "Summary", "Experience", "Education", "Skills", "Extras"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it("selects a section on click", async () => {
    const onSelect = vi.fn();
    render(<SectionRail content={content} activeSection="contact" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /Skills/ }));
    expect(onSelect).toHaveBeenCalledWith("skills");
  });

  it("lists experience entries as sub-rows so a role can be jumped to directly", () => {
    render(<SectionRail content={content} activeSection="experience" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /Stripe/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Meta/ })).toBeInTheDocument();
  });

  it("reports the entry index when a sub-row is clicked", async () => {
    const onSelectEntry = vi.fn();
    render(
      <SectionRail
        content={content}
        activeSection="experience"
        onSelect={() => {}}
        onSelectEntry={onSelectEntry}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /Meta/ }));
    expect(onSelectEntry).toHaveBeenCalledWith("experience", 1);
  });

  it("badges a section with its pending change count", () => {
    render(
      <SectionRail
        content={content}
        activeSection="contact"
        onSelect={() => {}}
        pendingBySection={{ experience: 3 }}
      />
    );
    expect(screen.getByLabelText("3 pending changes")).toBeInTheDocument();
  });

  it("shows the complete-section count in the footer", () => {
    render(<SectionRail content={content} activeSection="contact" onSelect={() => {}} />);
    expect(screen.getByText(/of 6 complete/)).toBeInTheDocument();
  });

  it("marks the active row with aria-current", () => {
    render(<SectionRail content={content} activeSection="skills" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /Skills/ })).toHaveAttribute(
      "aria-current",
      "true"
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/web && npx vitest run __tests__/components/section-rail.test.tsx
```

Expected: FAIL — cannot resolve `SectionRail`.

- [ ] **Step 3: Implement CompletenessRing**

Create `apps/web/components/studio/rail/CompletenessRing.tsx`:

```tsx
"use client";
import { motion } from "motion/react";

export function CompletenessRing({ ratio, size = 16 }: { ratio: number; size?: number }) {
  const r = (size - 3) / 2;
  const full = ratio >= 1;
  return (
    <svg width={size} height={size} className="-rotate-90 shrink-0" aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={2}
        className="stroke-outline-variant/50"
      />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        className={full ? "stroke-success" : "stroke-primary"}
        initial={false}
        animate={{ pathLength: Math.max(0, Math.min(1, ratio)) }}
        transition={{ type: "spring", stiffness: 160, damping: 26 }}
      />
    </svg>
  );
}
```

- [ ] **Step 4: Implement SectionRow**

Create `apps/web/components/studio/rail/SectionRow.tsx`:

```tsx
"use client";
import type { SectionId, SectionState } from "@/lib/section-completeness";
import { CompletenessRing } from "./CompletenessRing";

export function SectionRow({
  state,
  isActive,
  entries,
  pendingChanges,
  onSelect,
  onSelectEntry,
}: {
  state: SectionState;
  isActive: boolean;
  entries?: string[];
  pendingChanges?: number;
  onSelect: (id: SectionId) => void;
  onSelectEntry?: (id: SectionId, index: number) => void;
}) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-current={isActive ? "true" : undefined}
        onClick={() => onSelect(state.id)}
        className={`flex items-center gap-sm px-sm py-sm rounded-lg text-left transition-colors ${
          isActive
            ? "bg-primary/8 text-on-surface font-semibold"
            : "text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
        }`}
      >
        <CompletenessRing ratio={state.ratio} />
        <span className="text-label-md flex-1 min-w-0 truncate">{state.label}</span>
        {!!pendingChanges && pendingChanges > 0 && (
          <span
            aria-label={`${pendingChanges} pending change${pendingChanges === 1 ? "" : "s"}`}
            className="tabular shrink-0 px-xs rounded-full bg-primary text-on-primary text-caption font-bold"
          >
            {pendingChanges}
          </span>
        )}
      </button>

      {entries && entries.length > 0 && (
        <div className="flex flex-col pl-lg">
          {entries.map((label, i) => (
            <button
              key={`${label}-${i}`}
              type="button"
              onClick={() => onSelectEntry?.(state.id, i)}
              className="text-left px-sm py-xs rounded-lg text-caption text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors truncate"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Implement SectionRail**

Create `apps/web/components/studio/rail/SectionRail.tsx`:

```tsx
"use client";
import type React from "react";
import type { ResumeContent } from "@career-copilot/types";
import {
  sectionStates,
  completeCount,
  type SectionId,
} from "@/lib/section-completeness";
import { SectionRow } from "./SectionRow";

export function SectionRail({
  content,
  activeSection,
  onSelect,
  onSelectEntry,
  pendingBySection,
  footer,
}: {
  content: ResumeContent | null;
  activeSection: SectionId;
  onSelect: (id: SectionId) => void;
  onSelectEntry?: (id: SectionId, index: number) => void;
  pendingBySection?: Partial<Record<SectionId, number>>;
  footer?: React.ReactNode;
}) {
  const states = sectionStates(content);
  const { complete, total } = completeCount(states);

  // Sub-rows let the user jump straight to a role instead of scrolling the
  // whole section — the old tab strip could only address a section.
  const entriesFor = (id: SectionId): string[] | undefined => {
    if (!content) return undefined;
    if (id === "experience")
      return content.experience.map((j) => j.company || j.title || "Untitled role");
    if (id === "education")
      return content.education.map((e) => e.institution || e.degree || "Untitled");
    return undefined;
  };

  return (
    <aside className="flex flex-col h-full bg-surface-container-low border-r border-outline-variant/20 overflow-y-auto">
      <nav aria-label="Resume sections" className="flex flex-col gap-xs p-sm flex-1">
        {states.map((state) => (
          <SectionRow
            key={state.id}
            state={state}
            isActive={state.id === activeSection}
            entries={entriesFor(state.id)}
            pendingChanges={pendingBySection?.[state.id]}
            onSelect={onSelect}
            onSelectEntry={onSelectEntry}
          />
        ))}
      </nav>

      <div className="px-md py-sm border-t border-outline-variant/20">
        <p className="tabular text-caption text-on-surface-variant">
          {complete} of {total} complete
        </p>
      </div>

      {footer}
    </aside>
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run __tests__/components/section-rail.test.tsx
```

Expected: PASS, 7 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/studio/rail apps/web/__tests__/components/section-rail.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio): add the section rail with completeness rings

Replaces the seven-trigger tab strip that wrapped to two lines, said
nothing about what was filled in, and could not address an individual
role. Rows carry completeness rings, experience and education expand to
per-entry sub-rows, and rows badge their pending change count.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Canvas sections — port the editor forms

**Files:**
- Create: `apps/web/components/studio/canvas/ContactSection.tsx`
- Create: `apps/web/components/studio/canvas/SummarySection.tsx`
- Create: `apps/web/components/studio/canvas/ExperienceSection.tsx`
- Create: `apps/web/components/studio/canvas/EducationSection.tsx`
- Create: `apps/web/components/studio/canvas/SkillsSection.tsx`
- Create: `apps/web/components/studio/canvas/ExtrasSection.tsx`
- Test: `apps/web/__tests__/components/canvas-sections.test.tsx`
- Reference (do not modify): `apps/web/components/resume/EditorPanel.tsx`

**Interfaces:**
- Consumes: `useResumeStore` (`content`, `updateContent`, `templateId`, `setPhotoModal`); `templateRequiresPhoto` from `@/lib/resume-templates`; `sameCompany` from `@/lib/career-profile-client`.
- Produces: six components, each taking no props and reading the store directly:
  `ContactSection()`, `SummarySection()`, `ExperienceSection({ focusIndex }: { focusIndex?: number })`, `EducationSection({ focusIndex }: { focusIndex?: number })`, `SkillsSection()`, `ExtrasSection()`.
  Also exported from `SummarySection.tsx`: `const SUMMARY_MAX_WORDS = 80`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/components/canvas-sections.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useResumeStore } from "../../stores/resume-store";
import { SummarySection } from "../../components/studio/canvas/SummarySection";
import { SkillsSection } from "../../components/studio/canvas/SkillsSection";
import type { ResumeContent } from "@career-copilot/types";

const content: ResumeContent = {
  contact: { name: "Jordan", email: "j@example.test" },
  summary: "",
  experience: [],
  education: [],
  skills: ["TypeScript"],
};

beforeEach(() => {
  useResumeStore.getState().resetStore();
  useResumeStore.getState().setResume("r1", structuredClone(content), "ats_clean");
});

describe("SummarySection", () => {
  it("writes typed text into the store", async () => {
    render(<SummarySection />);
    await userEvent.type(screen.getByRole("textbox"), "Engineer.");
    expect(useResumeStore.getState().content?.summary).toBe("Engineer.");
  });

  it("caps the summary at 80 words, trimming from the end", async () => {
    render(<SummarySection />);
    const long = Array.from({ length: 90 }, (_, i) => `w${i}`).join(" ");
    await userEvent.click(screen.getByRole("textbox"));
    await userEvent.paste(long);
    const words = (useResumeStore.getState().content?.summary ?? "").split(/\s+/).filter(Boolean);
    expect(words).toHaveLength(80);
    expect(words[0]).toBe("w0");
  });
});

describe("SkillsSection", () => {
  it("renders existing skills as chips", () => {
    render(<SkillsSection />);
    expect(screen.getByText("TypeScript")).toBeInTheDocument();
  });

  it("adds a skill on Enter", async () => {
    render(<SkillsSection />);
    await userEvent.type(screen.getByPlaceholderText(/Add a skill/i), "Go{Enter}");
    expect(useResumeStore.getState().content?.skills).toEqual(["TypeScript", "Go"]);
  });

  it("does not add a duplicate skill", async () => {
    render(<SkillsSection />);
    await userEvent.type(screen.getByPlaceholderText(/Add a skill/i), "typescript{Enter}");
    expect(useResumeStore.getState().content?.skills).toEqual(["TypeScript"]);
  });

  it("removes a skill via its remove button", async () => {
    render(<SkillsSection />);
    await userEvent.click(screen.getByRole("button", { name: /Remove TypeScript/i }));
    expect(useResumeStore.getState().content?.skills).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/web && npx vitest run __tests__/components/canvas-sections.test.tsx
```

Expected: FAIL — cannot resolve the canvas modules.

- [ ] **Step 3: Implement SummarySection**

Create `apps/web/components/studio/canvas/SummarySection.tsx`:

```tsx
"use client";
import { useResumeStore } from "@/stores/resume-store";

// Matches resume_spec.py HARD_LIMITS["summary"]["max_words"] — the backend
// from-scratch generator enforces the same cap.
export const SUMMARY_MAX_WORDS = 80;

export function SummarySection() {
  const content = useResumeStore((s) => s.content);
  const updateContent = useResumeStore((s) => s.updateContent);
  if (!content) return null;

  const words = (content.summary ?? "").trim().split(/\s+/).filter(Boolean);
  const count = words.length;

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    const next = value.trim().split(/\s+/).filter(Boolean);
    // Trim from the end so text already typed at the front is never
    // silently rewritten.
    updateContent({
      summary:
        next.length <= SUMMARY_MAX_WORDS
          ? value
          : next.slice(0, SUMMARY_MAX_WORDS).join(" "),
    });
  }

  return (
    <section className="flex flex-col gap-md">
      <header className="flex items-baseline justify-between gap-sm">
        <h2 className="text-label-caps text-on-surface-variant">Professional Summary</h2>
        <span
          className={`tabular text-caption ${
            count >= SUMMARY_MAX_WORDS ? "text-error font-semibold" : "text-on-surface-variant"
          }`}
        >
          {count} / {SUMMARY_MAX_WORDS} words
        </span>
      </header>
      <textarea
        value={content.summary ?? ""}
        onChange={handleChange}
        rows={7}
        placeholder="Write a compelling professional summary…"
        className="w-full px-md py-md rounded-xl border border-outline-variant/50 bg-surface-container-lowest text-on-surface text-body-md leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
      />
      {count >= SUMMARY_MAX_WORDS && (
        <p className="text-caption text-error">
          A tight, {SUMMARY_MAX_WORDS}-word summary reads stronger on an ATS resume than a long
          one — trim before adding more.
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Implement SkillsSection**

Create `apps/web/components/studio/canvas/SkillsSection.tsx`:

```tsx
"use client";
import { useState } from "react";
import { X } from "@phosphor-icons/react";
import { motion, AnimatePresence } from "motion/react";
import { useResumeStore } from "@/stores/resume-store";

// A chip editor, not the old newline-joined textarea: skills are discrete
// values and editing them as one blob made reordering and de-duping a
// manual text exercise.
export function SkillsSection() {
  const content = useResumeStore((s) => s.content);
  const updateContent = useResumeStore((s) => s.updateContent);
  const [draft, setDraft] = useState("");
  if (!content) return null;

  const skills = content.skills;

  function add() {
    const value = draft.trim();
    setDraft("");
    if (!value) return;
    if (skills.some((s) => s.toLowerCase() === value.toLowerCase())) return;
    updateContent({ skills: [...skills, value] });
  }

  return (
    <section className="flex flex-col gap-md">
      <h2 className="text-label-caps text-on-surface-variant">Skills</h2>

      <div className="flex flex-wrap gap-xs">
        <AnimatePresence initial={false}>
          {skills.map((skill) => (
            <motion.span
              key={skill}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
              className="flex items-center gap-xs pl-sm pr-xs py-xs rounded-full bg-secondary-container text-on-secondary-container text-label-sm"
            >
              {skill}
              <button
                type="button"
                aria-label={`Remove ${skill}`}
                onClick={() =>
                  updateContent({ skills: skills.filter((s) => s !== skill) })
                }
                className="rounded-full p-0.5 hover:bg-error/15 hover:text-error transition-colors"
              >
                <X size={12} weight="bold" />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>
      </div>

      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder="Add a skill and press Enter…"
        className="w-full px-md py-sm rounded-xl border border-outline-variant/50 bg-surface-container-lowest text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
      />
    </section>
  );
}
```

- [ ] **Step 5: Implement the remaining four sections**

Port these from `components/resume/EditorPanel.tsx` verbatim in behavior, changing only presentation per the Global Constraints (section heading → `text-label-caps` `text-on-surface-variant`; body inputs → `text-body-md`; cards → `bg-surface-container-lowest` with `rounded-xl`).

- `ContactSection.tsx` — port the `Contact Tab` block, including the `templateRequiresPhoto(templateId)` photo control and the `CONTACT_FIELDS` map. Keep the `CONTACT_FIELDS` array definition (`name`, `email`, `phone`, `location`, `linkedin`, `github`) exactly as it is today.
- `ExperienceSection.tsx` — port the `Experience Tab` block, including `sameCompany` merge affordance and `mergeExperienceIntoPreviousRole`. Accepts `{ focusIndex }: { focusIndex?: number }` and, when set, scrolls that entry into view with `element.scrollIntoView({ block: "start", behavior: "smooth" })` in an effect keyed on `focusIndex`.
- `EducationSection.tsx` — port the `Education Tab` block. Same `focusIndex` behavior.
- `ExtrasSection.tsx` — port the languages, certifications and awards blocks into one section with three sub-headings.

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run __tests__/components/canvas-sections.test.tsx
```

Expected: PASS, 6 tests.

- [ ] **Step 7: Typecheck**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/studio/canvas apps/web/__tests__/components/canvas-sections.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio): split the editor into focused canvas sections

Ports EditorPanel's seven tab panels into six section components sized for
the workbench canvas, one visible at a time at reading width. Skills moves
from a newline-joined textarea to a chip editor. Store calls are unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `ChangeCard` — one reviewable change

**Files:**
- Create: `apps/web/components/studio/review/ChangeCard.tsx`
- Test: `apps/web/__tests__/components/change-card.test.tsx`
- Reference (do not modify): `apps/web/components/resume/BulletReviewPanel.tsx`

**Interfaces:**
- Consumes: `BulletChange` from `@/stores/tailoring-store`; `ImportanceLevel` (the value type of `bulletImportance`).
- Produces:
  `ChangeCard({ change, importance, decision, landedKeywords, atsDelta, busy, onDecide, onRewrite, onEdit }: { change: BulletChange; importance?: string; decision?: "accept" | "reject"; landedKeywords?: string[]; atsDelta?: number; busy?: "rewrite" | "humanize" | null; onDecide: (d: "accept" | "reject") => void; onRewrite: (mode: "rewrite" | "humanize") => void; onEdit: (text: string) => void })`

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/components/change-card.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChangeCard } from "../../components/studio/review/ChangeCard";
import type { BulletChange } from "../../stores/tailoring-store";

const change: BulletChange = {
  key: "exp0_b0",
  jobIdx: 0,
  bulletIdx: 0,
  jobTitle: "Senior Engineer",
  company: "Stripe",
  original: "Built payment APIs",
  tailored: "Scaled payment APIs to 4M req/s",
};

const noop = () => {};

describe("ChangeCard", () => {
  it("shows both the original and the tailored text", () => {
    render(
      <ChangeCard change={change} onDecide={noop} onRewrite={noop} onEdit={noop} />
    );
    expect(screen.getByText("Built payment APIs")).toBeInTheDocument();
    expect(screen.getByText("Scaled payment APIs to 4M req/s")).toBeInTheDocument();
  });

  it("labels the card with its role and company", () => {
    render(
      <ChangeCard change={change} onDecide={noop} onRewrite={noop} onEdit={noop} />
    );
    expect(screen.getByText(/Stripe/)).toBeInTheDocument();
    expect(screen.getByText(/Senior Engineer/)).toBeInTheDocument();
  });

  it("reports accept and reject through onDecide", async () => {
    const onDecide = vi.fn();
    render(
      <ChangeCard change={change} onDecide={onDecide} onRewrite={noop} onEdit={noop} />
    );
    await userEvent.click(screen.getByRole("button", { name: /Take it/i }));
    expect(onDecide).toHaveBeenCalledWith("accept");
    await userEvent.click(screen.getByRole("button", { name: /Keep mine/i }));
    expect(onDecide).toHaveBeenCalledWith("reject");
  });

  it("reports rewrite and humanize modes through onRewrite", async () => {
    const onRewrite = vi.fn();
    render(
      <ChangeCard change={change} onDecide={noop} onRewrite={onRewrite} onEdit={noop} />
    );
    await userEvent.click(screen.getByRole("button", { name: /Rewrite/i }));
    expect(onRewrite).toHaveBeenCalledWith("rewrite");
    await userEvent.click(screen.getByRole("button", { name: /Humanize/i }));
    expect(onRewrite).toHaveBeenCalledWith("humanize");
  });

  it("turns the tailored text into an editable field and commits on blur", async () => {
    const onEdit = vi.fn();
    render(
      <ChangeCard change={change} onDecide={noop} onRewrite={noop} onEdit={onEdit} />
    );
    await userEvent.click(screen.getByRole("button", { name: /Edit tailored text/i }));
    const box = screen.getByRole("textbox");
    await userEvent.clear(box);
    await userEvent.type(box, "Rewrote it myself");
    await userEvent.tab();
    expect(onEdit).toHaveBeenCalledWith("Rewrote it myself");
  });

  it("disables both rewrite actions while one is in flight", () => {
    render(
      <ChangeCard
        change={change}
        busy="rewrite"
        onDecide={noop}
        onRewrite={noop}
        onEdit={noop}
      />
    );
    expect(screen.getByRole("button", { name: /Rewriting/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Humanize/i })).toBeDisabled();
  });

  it("shows landed keywords and the ATS delta when supplied", () => {
    render(
      <ChangeCard
        change={change}
        landedKeywords={["latency", "scale"]}
        atsDelta={3}
        onDecide={noop}
        onRewrite={noop}
        onEdit={noop}
      />
    );
    expect(screen.getByText("latency")).toBeInTheDocument();
    expect(screen.getByText("ATS +3")).toBeInTheDocument();
  });

  it("renders an importance rail when importance is supplied", () => {
    render(
      <ChangeCard
        change={change}
        importance="high"
        onDecide={noop}
        onRewrite={noop}
        onEdit={noop}
      />
    );
    expect(screen.getByLabelText(/high impact/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/web && npx vitest run __tests__/components/change-card.test.tsx
```

Expected: FAIL — cannot resolve `ChangeCard`.

- [ ] **Step 3: Implement**

Create `apps/web/components/studio/review/ChangeCard.tsx`:

```tsx
"use client";
import { useState } from "react";
import {
  ArrowsClockwise,
  Check,
  PencilSimple,
  Sparkle,
  ArrowUUpLeft,
} from "@phosphor-icons/react";
import type { BulletChange } from "@/stores/tailoring-store";

// Importance was a small corner badge; as a colored left rail it reads at
// a glance while the eye is on the text, which is the point of a queue.
const RAIL: Record<string, string> = {
  high: "bg-primary",
  medium: "bg-secondary",
  low: "bg-outline-variant",
};

export function ChangeCard({
  change,
  importance,
  decision,
  landedKeywords,
  atsDelta,
  busy,
  onDecide,
  onRewrite,
  onEdit,
}: {
  change: BulletChange;
  importance?: string;
  decision?: "accept" | "reject";
  landedKeywords?: string[];
  atsDelta?: number;
  busy?: "rewrite" | "humanize" | null;
  onDecide: (d: "accept" | "reject") => void;
  onRewrite: (mode: "rewrite" | "humanize") => void;
  onEdit: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(change.tailored);

  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== change.tailored) onEdit(next);
  }

  return (
    <article className="relative flex overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-lg">
      {importance && (
        <span
          aria-label={`${importance} impact`}
          className={`w-1.5 shrink-0 ${RAIL[importance.toLowerCase()] ?? RAIL.low}`}
        />
      )}

      <div className="flex-1 min-w-0 flex flex-col gap-md p-lg">
        <header className="flex items-center justify-between gap-sm">
          <p className="text-label-caps text-on-surface-variant truncate">
            {change.company} · {change.jobTitle}
          </p>
          {importance && (
            <span className="text-label-caps text-on-surface-variant shrink-0">
              {importance} impact
            </span>
          )}
        </header>

        <div className="flex flex-col gap-xs">
          <span className="text-label-caps text-on-surface-variant">Was</span>
          <p className="text-body-md leading-relaxed text-on-surface-variant">
            {change.original || <em className="not-italic opacity-50">— empty —</em>}
          </p>
        </div>

        <div className="h-px bg-outline-variant/30" />

        <div className="flex flex-col gap-xs">
          <div className="flex items-center justify-between gap-sm">
            <span className="text-label-caps text-primary">Now</span>
            {!editing && (
              <button
                type="button"
                aria-label="Edit tailored text"
                onClick={() => {
                  setDraft(change.tailored);
                  setEditing(true);
                }}
                className="flex items-center gap-xs text-caption text-on-surface-variant hover:text-primary transition-colors"
              >
                <PencilSimple size={13} />
                Edit
              </button>
            )}
          </div>
          {editing ? (
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(false);
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
              }}
              rows={3}
              className="w-full px-md py-sm rounded-xl border border-primary/50 bg-surface text-body-md leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          ) : (
            <p className="text-body-md leading-relaxed text-on-surface">{change.tailored}</p>
          )}
        </div>

        {(landedKeywords?.length || atsDelta) && (
          <div className="flex items-center gap-xs flex-wrap">
            {landedKeywords?.map((kw) => (
              <span
                key={kw}
                className="px-sm py-0.5 rounded-full bg-primary/10 text-primary text-caption font-medium"
              >
                {kw}
              </span>
            ))}
            {!!atsDelta && (
              <span className="tabular ml-auto text-caption font-bold text-success">
                ATS +{atsDelta}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-sm pt-xs">
          <button
            type="button"
            onClick={() => onDecide("reject")}
            className={`flex items-center gap-xs px-md py-sm rounded-xl text-label-md transition-all ${
              decision === "reject"
                ? "bg-on-surface text-surface"
                : "border border-outline-variant/50 text-on-surface-variant hover:border-on-surface hover:text-on-surface"
            }`}
          >
            <ArrowUUpLeft size={15} />
            Keep mine
          </button>

          <div className="flex items-center gap-xs ml-auto">
            <button
              type="button"
              disabled={!!busy}
              onClick={() => onRewrite("rewrite")}
              title="Re-optimize this bullet for the JD"
              className="flex items-center gap-xs px-sm py-sm rounded-xl text-label-sm text-on-surface-variant hover:text-primary hover:bg-primary/5 transition-all disabled:opacity-40"
            >
              <ArrowsClockwise size={14} className={busy === "rewrite" ? "animate-spin" : ""} />
              {busy === "rewrite" ? "Rewriting…" : "Rewrite"}
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => onRewrite("humanize")}
              title="Make this bullet sound more natural"
              className="flex items-center gap-xs px-sm py-sm rounded-xl text-label-sm text-on-surface-variant hover:text-tertiary hover:bg-tertiary/5 transition-all disabled:opacity-40"
            >
              <Sparkle size={14} className={busy === "humanize" ? "animate-pulse" : ""} />
              {busy === "humanize" ? "Humanizing…" : "Humanize"}
            </button>
          </div>

          <button
            type="button"
            onClick={() => onDecide("accept")}
            className={`flex items-center gap-xs px-md py-sm rounded-xl text-label-md transition-all ${
              decision === "accept"
                ? "bg-primary text-on-primary shadow-sm"
                : "border border-primary/50 text-primary hover:bg-primary/5"
            }`}
          >
            <Check size={15} weight="bold" />
            Take it
          </button>
        </div>
      </div>
    </article>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run __tests__/components/change-card.test.tsx
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/studio/review/ChangeCard.tsx apps/web/__tests__/components/change-card.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio): add ChangeCard for reviewing a single tailored bullet

Importance becomes a colored left rail instead of a corner badge, the
tailored text is editable in place, and the four-button row with its
literal pipe divider becomes a Keep/Take pair with the rewrite actions
between them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `TriageDeck` — the queue

**Files:**
- Create: `apps/web/components/studio/review/DeckList.tsx`
- Create: `apps/web/components/studio/review/TriageDeck.tsx`
- Test: `apps/web/__tests__/components/triage-deck.test.tsx`

**Interfaces:**
- Consumes: `ChangeCard` (Task 7); `BulletChange` from `@/stores/tailoring-store`.
- Produces:
  - `DeckList({ changes, decisions, onJump, onTakeAllRemaining }: { changes: BulletChange[]; decisions: Record<string, "accept" | "reject">; onJump: (index: number) => void; onTakeAllRemaining: () => void })`
  - `TriageDeck({ changes, decisions, importance, busy, onDecide, onRewrite, onEdit, onTakeAllRemaining, onComplete }: { changes: BulletChange[]; decisions: Record<string, "accept" | "reject">; importance?: Record<string, string>; busy?: Record<string, "rewrite" | "humanize" | null>; onDecide: (key: string, d: "accept" | "reject") => void; onRewrite: (change: BulletChange, mode: "rewrite" | "humanize") => void; onEdit: (change: BulletChange, text: string) => void; onTakeAllRemaining: () => void; onComplete?: () => void })`

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/components/triage-deck.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TriageDeck } from "../../components/studio/review/TriageDeck";
import type { BulletChange } from "../../stores/tailoring-store";

const changes: BulletChange[] = [
  {
    key: "exp0_b0",
    jobIdx: 0,
    bulletIdx: 0,
    jobTitle: "Senior Engineer",
    company: "Stripe",
    original: "Built payment APIs",
    tailored: "Scaled payment APIs to 4M req/s",
  },
  {
    key: "exp0_b1",
    jobIdx: 0,
    bulletIdx: 1,
    jobTitle: "Senior Engineer",
    company: "Stripe",
    original: "Worked on the ledger",
    tailored: "Led the ledger migration",
  },
];

function setup(overrides: Partial<React.ComponentProps<typeof TriageDeck>> = {}) {
  const props = {
    changes,
    decisions: {},
    onDecide: vi.fn(),
    onRewrite: vi.fn(),
    onEdit: vi.fn(),
    onTakeAllRemaining: vi.fn(),
    ...overrides,
  };
  render(<TriageDeck {...props} />);
  return props;
}

describe("TriageDeck", () => {
  it("starts on the first change and reports the position", () => {
    setup();
    expect(screen.getByText(/change 1 of 2/i)).toBeInTheDocument();
    expect(screen.getByText("Scaled payment APIs to 4M req/s")).toBeInTheDocument();
  });

  it("advances to the next change after a decision", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: /Take it/i }));
    expect(props.onDecide).toHaveBeenCalledWith("exp0_b0", "accept");
    expect(await screen.findByText(/change 2 of 2/i)).toBeInTheDocument();
  });

  it("accepts with the right arrow key and rejects with the left", async () => {
    const props = setup();
    await userEvent.keyboard("{ArrowRight}");
    expect(props.onDecide).toHaveBeenCalledWith("exp0_b0", "accept");
    await userEvent.keyboard("{ArrowLeft}");
    expect(props.onDecide).toHaveBeenCalledWith("exp0_b1", "reject");
  });

  it("triggers rewrite on R and humanize on H", async () => {
    const props = setup();
    await userEvent.keyboard("r");
    expect(props.onRewrite).toHaveBeenCalledWith(changes[0], "rewrite");
    await userEvent.keyboard("h");
    expect(props.onRewrite).toHaveBeenCalledWith(changes[0], "humanize");
  });

  it("offers an undo after a decision that steps back to that change", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /Take it/i }));
    await userEvent.click(await screen.findByRole("button", { name: /Undo/i }));
    expect(await screen.findByText(/change 1 of 2/i)).toBeInTheDocument();
  });

  it("shows a completion state after the last decision", async () => {
    const onComplete = vi.fn();
    setup({ onComplete });
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{ArrowRight}");
    expect(await screen.findByText(/All changes reviewed/i)).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalled();
  });

  it("switches to the list view and back", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /see all/i }));
    expect(screen.getByRole("button", { name: /Take all remaining/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /back to deck/i }));
    expect(screen.getByText(/change 1 of 2/i)).toBeInTheDocument();
  });

  it("takes all remaining from the list view", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: /see all/i }));
    await userEvent.click(screen.getByRole("button", { name: /Take all remaining/i }));
    expect(props.onTakeAllRemaining).toHaveBeenCalled();
  });

  it("jumps to a change from the list view", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /see all/i }));
    await userEvent.click(screen.getByRole("button", { name: /Led the ledger migration/i }));
    expect(await screen.findByText(/change 2 of 2/i)).toBeInTheDocument();
  });

  it("renders an empty state when there is nothing to review", () => {
    setup({ changes: [] });
    expect(screen.getByText(/already well-aligned/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/web && npx vitest run __tests__/components/triage-deck.test.tsx
```

Expected: FAIL — cannot resolve `TriageDeck`.

- [ ] **Step 3: Implement DeckList**

Create `apps/web/components/studio/review/DeckList.tsx`:

```tsx
"use client";
import { Check, ArrowUUpLeft } from "@phosphor-icons/react";
import type { BulletChange } from "@/stores/tailoring-store";

// The skimmer's path out of the deck, and the only place bulk acceptance
// lives. The old "Accept All" button sat on a screen where every bullet
// already defaulted to accept, so it was a no-op announcing a fact.
export function DeckList({
  changes,
  decisions,
  onJump,
  onTakeAllRemaining,
}: {
  changes: BulletChange[];
  decisions: Record<string, "accept" | "reject">;
  onJump: (index: number) => void;
  onTakeAllRemaining: () => void;
}) {
  const undecided = changes.filter((c) => !(c.key in decisions)).length;

  return (
    <div className="flex flex-col gap-sm">
      {changes.map((change, i) => {
        const decision = decisions[change.key];
        return (
          <button
            key={change.key}
            type="button"
            onClick={() => onJump(i)}
            className="flex items-center gap-md px-md py-sm rounded-xl border border-outline-variant/30 bg-surface-container-lowest text-left hover:border-primary/40 transition-colors"
          >
            <span className="tabular text-caption text-on-surface-variant w-5 shrink-0">
              {i + 1}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-label-caps text-on-surface-variant truncate">
                {change.company} · {change.jobTitle}
              </span>
              <span className="block text-body-sm text-on-surface truncate">
                {change.tailored}
              </span>
            </span>
            {decision === "accept" && (
              <Check size={15} weight="bold" className="text-primary shrink-0" />
            )}
            {decision === "reject" && (
              <ArrowUUpLeft size={15} className="text-on-surface-variant shrink-0" />
            )}
          </button>
        );
      })}

      <button
        type="button"
        onClick={onTakeAllRemaining}
        disabled={undecided === 0}
        className="mt-xs w-full py-sm rounded-xl text-label-md text-primary border border-primary/40 hover:bg-primary/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Take all remaining{undecided > 0 ? ` (${undecided})` : ""}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Implement TriageDeck**

Create `apps/web/components/studio/review/TriageDeck.tsx`:

```tsx
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUUpLeft, ListBullets, CheckCircle } from "@phosphor-icons/react";
import type { BulletChange } from "@/stores/tailoring-store";
import { ChangeCard } from "./ChangeCard";
import { DeckList } from "./DeckList";

type Decision = "accept" | "reject";

export function TriageDeck({
  changes,
  decisions,
  importance,
  busy,
  onDecide,
  onRewrite,
  onEdit,
  onTakeAllRemaining,
  onComplete,
}: {
  changes: BulletChange[];
  decisions: Record<string, Decision>;
  importance?: Record<string, string>;
  busy?: Record<string, "rewrite" | "humanize" | null>;
  onDecide: (key: string, d: Decision) => void;
  onRewrite: (change: BulletChange, mode: "rewrite" | "humanize") => void;
  onEdit: (change: BulletChange, text: string) => void;
  onTakeAllRemaining: () => void;
  onComplete?: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [exitDir, setExitDir] = useState<1 | -1>(1);
  const [lastDecided, setLastDecided] = useState<number | null>(null);
  const [showList, setShowList] = useState(false);
  const completedRef = useRef(false);

  const done = index >= changes.length;

  useEffect(() => {
    if (done && changes.length > 0 && !completedRef.current) {
      completedRef.current = true;
      onComplete?.();
    }
    if (!done) completedRef.current = false;
  }, [done, changes.length, onComplete]);

  const decide = useCallback(
    (d: Decision) => {
      const change = changes[index];
      if (!change) return;
      setExitDir(d === "accept" ? 1 : -1);
      onDecide(change.key, d);
      setLastDecided(index);
      setIndex((i) => i + 1);
    },
    [changes, index, onDecide]
  );

  const undo = useCallback(() => {
    if (lastDecided === null) return;
    setIndex(lastDecided);
    setLastDecided(null);
  }, [lastDecided]);

  useEffect(() => {
    if (showList) return;
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      // Never steal keys from an inline edit.
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      const change = changes[index];
      if (e.key === "ArrowRight") { e.preventDefault(); decide("accept"); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); decide("reject"); }
      else if (e.key.toLowerCase() === "r" && change) { e.preventDefault(); onRewrite(change, "rewrite"); }
      else if (e.key.toLowerCase() === "h" && change) { e.preventDefault(); onRewrite(change, "humanize"); }
      else if (e.key === "Backspace") { e.preventDefault(); undo(); }
      else if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); onTakeAllRemaining(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [changes, index, decide, undo, onRewrite, onTakeAllRemaining, showList]);

  if (changes.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-outline-variant/50 p-xl text-center">
        <p className="text-body-md text-on-surface-variant">
          No changes to review — your resume is already well-aligned with this job description.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex items-center justify-between gap-sm">
        <div className="flex items-center gap-sm min-w-0">
          <p className="tabular text-label-caps text-on-surface-variant whitespace-nowrap">
            {done ? `${changes.length} of ${changes.length} reviewed` : `change ${index + 1} of ${changes.length}`}
          </p>
          <div aria-hidden className="flex items-center gap-1">
            {changes.map((c, i) => (
              <span
                key={c.key}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  i === index ? "bg-primary" : i < index ? "bg-primary/40" : "bg-outline-variant/50"
                }`}
              />
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowList((v) => !v)}
          className="flex items-center gap-xs text-caption text-on-surface-variant hover:text-primary transition-colors shrink-0"
        >
          <ListBullets size={14} />
          {showList ? "back to deck" : "see all"}
        </button>
      </header>

      {showList ? (
        <DeckList
          changes={changes}
          decisions={decisions}
          onJump={(i) => { setIndex(i); setShowList(false); }}
          onTakeAllRemaining={onTakeAllRemaining}
        />
      ) : done ? (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-xl text-center flex flex-col items-center gap-sm">
          <CheckCircle size={32} weight="fill" className="text-primary" />
          <p className="text-body-md font-semibold text-on-surface">All changes reviewed</p>
          <p className="text-body-sm text-on-surface-variant">
            Nothing is saved yet — generate a preview to see the result.
          </p>
        </div>
      ) : (
        <div className="relative">
          {/* Peek cards convey queue depth — you feel how much is left. */}
          {[2, 1].map((offset) =>
            changes[index + offset] ? (
              <div
                key={offset}
                aria-hidden
                className="absolute inset-x-0 top-0 rounded-2xl border border-outline-variant/25 bg-surface-container-lowest h-full"
                style={{
                  transform: `translateY(${offset * 10}px) scale(${1 - offset * 0.04})`,
                  zIndex: -offset,
                }}
              />
            ) : null
          )}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={changes[index].key}
              initial={{ opacity: 0, y: 14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: exitDir * 420, rotate: exitDir * 6 }}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
            >
              <ChangeCard
                change={changes[index]}
                importance={importance?.[changes[index].key]}
                decision={decisions[changes[index].key]}
                busy={busy?.[changes[index].key] ?? null}
                onDecide={decide}
                onRewrite={(mode) => onRewrite(changes[index], mode)}
                onEdit={(text) => onEdit(changes[index], text)}
              />
            </motion.div>
          </AnimatePresence>
        </div>
      )}

      {lastDecided !== null && !showList && (
        <div className="flex items-center justify-between gap-sm px-md py-sm rounded-xl bg-surface-container text-caption text-on-surface-variant">
          <span>
            {decisions[changes[lastDecided]?.key] === "reject"
              ? "Kept your original."
              : "Took the tailored version."}
          </span>
          <button
            type="button"
            onClick={undo}
            className="flex items-center gap-xs text-primary font-semibold hover:underline"
          >
            <ArrowUUpLeft size={13} />
            Undo
          </button>
        </div>
      )}

      {!showList && !done && (
        <p className="text-caption text-on-surface-variant text-center">
          ← keep mine · → take it · R rewrite · H humanize · ⌫ undo · ⇧↵ take all remaining
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run __tests__/components/triage-deck.test.tsx
```

Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/studio/review/DeckList.tsx apps/web/components/studio/review/TriageDeck.tsx apps/web/__tests__/components/triage-deck.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio): add the triage deck for reviewing AI changes

Replaces BulletReviewPanel's flat scroll with a focused queue: one
decision at a time, a real card stack conveying depth, keyboard control,
undo after every decision, and a list view that is the single honest home
for bulk acceptance.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Summary card, skills card, boost panel

**Files:**
- Create: `apps/web/components/studio/review/SummaryCard.tsx`
- Create: `apps/web/components/studio/review/SkillsCard.tsx`
- Create: `apps/web/components/studio/rail/BoostPanel.tsx`
- Test: `apps/web/__tests__/components/review-cards.test.tsx`
- Reference (do not modify): `apps/web/components/resume/BulletReviewPanel.tsx` (`SummaryBlock`, `SkillsBlock`), `apps/web/components/resume/AtsGapFixPanel.tsx`

**Interfaces:**
- Consumes: `ChangeCard`'s visual conventions; `useTailoringStore` for `atsFixes`, `setFixDecision`, `refreshProjectedScore`, `projectedAtsScore`, `fixExperienceIndex`, `setFixExperienceIndex`.
- Produces:
  - `SummaryCard({ original, tailored, decision, busy, error, prompt, setPrompt, onDecide, onRewrite }: { original: string; tailored: string; decision?: "accept" | "reject"; busy: "rewrite" | "humanize" | "custom" | null; error: string | null; prompt: string; setPrompt: (v: string) => void; onDecide: (d: "accept" | "reject") => void; onRewrite: (mode: "rewrite" | "humanize" | "custom") => void })`
  - `SkillsCard({ originalSkills, suggestedSkills, skillFixes, prioritySkills, missingSkills, companyKeywords, decisions, onDecide, onFixDecision, onRefreshProjected, onApply }: …)` — same prop set `SkillsBlock` takes today in `BulletReviewPanel.tsx`, renamed only where the old names were store-action names.
  - `BoostPanel()` — no props; reads the tailoring store directly, as `AtsGapFixPanel` does today.

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/components/review-cards.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SummaryCard } from "../../components/studio/review/SummaryCard";

const noop = () => {};

describe("SummaryCard", () => {
  it("shows only the current summary when nothing changed", () => {
    render(
      <SummaryCard
        original="Engineer with 6 years."
        tailored="Engineer with 6 years."
        busy={null}
        error={null}
        prompt=""
        setPrompt={noop}
        onDecide={noop}
        onRewrite={noop}
      />
    );
    expect(screen.queryByText(/^Was$/i)).not.toBeInTheDocument();
    expect(screen.getByText("Engineer with 6 years.")).toBeInTheDocument();
  });

  it("shows both versions once the summary has been rewritten", () => {
    render(
      <SummaryCard
        original="Engineer with 6 years."
        tailored="Payments engineer with 6 years scaling APIs."
        busy={null}
        error={null}
        prompt=""
        setPrompt={noop}
        onDecide={noop}
        onRewrite={noop}
      />
    );
    expect(screen.getByText("Engineer with 6 years.")).toBeInTheDocument();
    expect(
      screen.getByText("Payments engineer with 6 years scaling APIs.")
    ).toBeInTheDocument();
  });

  it("reports each rewrite mode", async () => {
    const onRewrite = vi.fn();
    render(
      <SummaryCard
        original="A"
        tailored="A"
        busy={null}
        error={null}
        prompt=""
        setPrompt={noop}
        onDecide={noop}
        onRewrite={onRewrite}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /Rewrite/i }));
    expect(onRewrite).toHaveBeenCalledWith("rewrite");
    await userEvent.click(screen.getByRole("button", { name: /Humanize/i }));
    expect(onRewrite).toHaveBeenCalledWith("humanize");
  });

  it("surfaces an error message", () => {
    render(
      <SummaryCard
        original="A"
        tailored="A"
        busy={null}
        error="Rewrite failed"
        prompt=""
        setPrompt={noop}
        onDecide={noop}
        onRewrite={noop}
      />
    );
    expect(screen.getByText("Rewrite failed")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/web && npx vitest run __tests__/components/review-cards.test.tsx
```

Expected: FAIL — cannot resolve `SummaryCard`.

- [ ] **Step 3: Implement SummaryCard**

Create `apps/web/components/studio/review/SummaryCard.tsx`, porting the behavior of `SummaryBlock` in `components/resume/BulletReviewPanel.tsx`:

```tsx
"use client";
import { ArrowsClockwise, Sparkle, PaperPlaneRight } from "@phosphor-icons/react";

export function SummaryCard({
  original,
  tailored,
  decision,
  busy,
  error,
  prompt,
  setPrompt,
  onDecide,
  onRewrite,
}: {
  original: string;
  tailored: string;
  decision?: "accept" | "reject";
  busy: "rewrite" | "humanize" | "custom" | null;
  error: string | null;
  prompt: string;
  setPrompt: (v: string) => void;
  onDecide: (d: "accept" | "reject") => void;
  onRewrite: (mode: "rewrite" | "humanize" | "custom") => void;
}) {
  if (!original.trim() && !tailored.trim()) return null;
  // Unlike bullets, the summary starts identical to the original — there is
  // nothing to review until the user explicitly asks for a rewrite.
  const changed = tailored.trim() !== original.trim();

  return (
    <article className="flex flex-col gap-md rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-lg shadow-sm">
      <h3 className="text-label-caps text-on-surface-variant">Professional Summary</h3>

      {changed && (
        <div className="flex flex-col gap-xs">
          <span className="text-label-caps text-on-surface-variant">Was</span>
          <p className="text-body-md leading-relaxed text-on-surface-variant">{original}</p>
        </div>
      )}

      <div className="flex flex-col gap-xs">
        <span className={`text-label-caps ${changed ? "text-primary" : "text-on-surface-variant"}`}>
          {changed ? "Now" : "Current"}
        </span>
        <p className="text-body-md leading-relaxed text-on-surface">
          {tailored || <em className="not-italic opacity-50">— empty —</em>}
        </p>
      </div>

      {error && <p className="text-caption text-error">{error}</p>}

      <div className="flex items-center gap-sm flex-wrap">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => onRewrite("rewrite")}
          className="flex items-center gap-xs px-sm py-xs rounded-xl text-label-sm text-on-surface-variant hover:text-primary hover:bg-primary/5 transition-all disabled:opacity-40"
        >
          <ArrowsClockwise size={14} className={busy === "rewrite" ? "animate-spin" : ""} />
          {busy === "rewrite" ? "Rewriting…" : "Rewrite"}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => onRewrite("humanize")}
          className="flex items-center gap-xs px-sm py-xs rounded-xl text-label-sm text-on-surface-variant hover:text-tertiary hover:bg-tertiary/5 transition-all disabled:opacity-40"
        >
          <Sparkle size={14} className={busy === "humanize" ? "animate-pulse" : ""} />
          {busy === "humanize" ? "Humanizing…" : "Humanize"}
        </button>
        {changed && (
          <button
            type="button"
            onClick={() => onDecide(decision === "reject" ? "accept" : "reject")}
            className="ml-auto text-caption text-on-surface-variant hover:text-on-surface transition-colors"
          >
            {decision === "reject" ? "Use the rewrite" : "Keep my original"}
          </button>
        )}
      </div>

      <div className="flex items-center gap-sm">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && prompt.trim() && !busy) onRewrite("custom");
          }}
          placeholder="Tell the AI how to rewrite it…"
          className="flex-1 px-md py-sm rounded-xl border border-outline-variant/50 bg-surface text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
        />
        <button
          type="button"
          disabled={!!busy || !prompt.trim()}
          onClick={() => onRewrite("custom")}
          aria-label="Apply custom rewrite"
          className="flex items-center gap-xs px-md py-sm rounded-xl text-label-sm text-primary border border-primary/40 hover:bg-primary/5 transition-all disabled:opacity-40"
        >
          <PaperPlaneRight size={14} className={busy === "custom" ? "animate-pulse" : ""} />
        </button>
      </div>
    </article>
  );
}
```

- [ ] **Step 4: Implement SkillsCard**

Create `apps/web/components/studio/review/SkillsCard.tsx` by porting `SkillsBlock` from `components/resume/BulletReviewPanel.tsx`. Keep every store call and every prop it takes today; change only the presentation to match `SummaryCard` above — `rounded-2xl`, `bg-surface-container-lowest`, `p-lg`, heading as `text-label-caps text-on-surface-variant`, chips as `rounded-full` with `text-label-sm`.

- [ ] **Step 5: Implement BoostPanel**

Create `apps/web/components/studio/rail/BoostPanel.tsx` by porting `components/resume/AtsGapFixPanel.tsx`. Keep its store reads and `setFixDecision` / `refreshProjectedScore` / `setFixExperienceIndex` calls exactly. Presentation changes:

- Heading becomes `BOOST` in `text-label-caps text-on-surface-variant`, with the remaining-points count beside it in the `tabular` class.
- The container is `border-t border-outline-variant/20 p-sm`, sized for the rail's 260px column — fixes stack vertically, one row each, no side-by-side layout.
- Returns `null` when there are no fixes, so the rail footer stays clean.

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run __tests__/components/review-cards.test.tsx
```

Expected: PASS, 4 tests.

- [ ] **Step 7: Typecheck**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/studio/review/SummaryCard.tsx apps/web/components/studio/review/SkillsCard.tsx apps/web/components/studio/rail/BoostPanel.tsx apps/web/__tests__/components/review-cards.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio): port summary, skills and ATS-gap review into the workbench

Summary and skills become deck-shaped cards so the whole review is one
mental model, and the ATS gap→fix list moves into the rail as an ambient
Boost panel rather than another block in a long scroll.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: The preview dock

**Files:**
- Create: `apps/web/components/studio/preview/TemplateGallery.tsx`
- Create: `apps/web/components/studio/preview/SpacingPopover.tsx`
- Create: `apps/web/components/studio/preview/TypePopover.tsx`
- Create: `apps/web/components/studio/preview/DockToolbar.tsx`
- Create: `apps/web/components/studio/preview/PreviewDock.tsx`
- Test: `apps/web/__tests__/components/preview-dock.test.tsx`
- Reference (do not modify): `apps/web/components/resume/PreviewPanel.tsx`

**Interfaces:**
- Consumes: `useResumeStore` (`templateId`, `setTemplateId`, `lineSpacing`, `paragraphSpacing`, `setSpacing`, `fontChoice`, `setFontChoice`, `accentColor`, `setAccentColor`, `pdfSignedUrl`, `previewUnderfilled`); `RESUME_TEMPLATES` from `@/lib/resume-templates`; `UnderfillWarning`.
- Produces:
  - `TemplateGallery({ value, onChange }: { value: string; onChange: (id: string) => void })`
  - `SpacingPopover()`, `TypePopover()` — no props; read and write the resume store directly.
  - `DockToolbar({ onRefresh, isRefreshing, isStale }: { onRefresh: () => void; isRefreshing: boolean; isStale: boolean })`
  - `PreviewDock({ url, isRefreshing, isStale, onRefresh }: { url: string | null; isRefreshing: boolean; isStale: boolean; onRefresh: () => void })`
  - Re-exported from `PreviewDock.tsx`: `const SPACING_PRESETS` and `const FONT_CHOICES`, copied verbatim from `PreviewPanel.tsx` including their comments (the `FONT_CHOICES` keys must stay byte-identical to `FONT_STACKS` in `apps/api/app/services/pdf.py`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/components/preview-dock.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useResumeStore } from "../../stores/resume-store";
import { PreviewDock } from "../../components/studio/preview/PreviewDock";
import { TemplateGallery } from "../../components/studio/preview/TemplateGallery";

beforeEach(() => {
  useResumeStore.getState().resetStore();
  useResumeStore
    .getState()
    .setResume("r1", { contact: { name: "", email: "" }, experience: [], education: [], skills: [] }, "ats_clean");
});

describe("PreviewDock", () => {
  it("shows an empty state with no render yet", () => {
    render(<PreviewDock url={null} isRefreshing={false} isStale={false} onRefresh={() => {}} />);
    expect(screen.getByText(/No preview yet/i)).toBeInTheDocument();
  });

  it("renders the pdf in an iframe once a url exists", () => {
    render(
      <PreviewDock
        url="https://example.test/a.pdf"
        isRefreshing={false}
        isStale={false}
        onRefresh={() => {}}
      />
    );
    expect(screen.getByTitle("Resume preview")).toHaveAttribute(
      "src",
      expect.stringContaining("#toolbar=0")
    );
  });

  it("exposes one refresh control, labelled for the stale state", async () => {
    const onRefresh = vi.fn();
    render(
      <PreviewDock
        url="https://example.test/a.pdf"
        isRefreshing={false}
        isStale
        onRefresh={onRefresh}
      />
    );
    const button = screen.getByRole("button", { name: /Update preview/i });
    await userEvent.click(button);
    expect(onRefresh).toHaveBeenCalled();
  });

  it("does not render a second download control", () => {
    render(
      <PreviewDock
        url="https://example.test/a.pdf"
        isRefreshing={false}
        isStale={false}
        onRefresh={() => {}}
      />
    );
    expect(screen.queryByRole("button", { name: /download/i })).not.toBeInTheDocument();
  });
});

describe("TemplateGallery", () => {
  it("renders a selectable thumbnail per template", async () => {
    const onChange = vi.fn();
    render(<TemplateGallery value="ats_clean" onChange={onChange} />);
    const options = screen.getAllByRole("radio");
    expect(options.length).toBeGreaterThan(1);
    expect(options.find((o) => o.getAttribute("aria-checked") === "true")).toBeTruthy();
    await userEvent.click(options[1]);
    expect(onChange).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd apps/web && npx vitest run __tests__/components/preview-dock.test.tsx
```

Expected: FAIL — cannot resolve `PreviewDock`.

- [ ] **Step 3: Implement TemplateGallery**

Create `apps/web/components/studio/preview/TemplateGallery.tsx`:

```tsx
"use client";
import Image from "next/image";
import { Check } from "@phosphor-icons/react";
import { RESUME_TEMPLATES } from "@/lib/resume-templates";

// A template is chosen by looking at it. The old picker was a native
// <select> while thumbnails sat unused in public/resume-templates/.
export function TemplateGallery({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Resume template" className="grid grid-cols-2 gap-sm">
      {RESUME_TEMPLATES.map((t) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            role="radio"
            aria-checked={selected}
            aria-label={t.label}
            onClick={() => onChange(t.id)}
            className={`relative flex flex-col gap-xs rounded-xl border-2 p-xs transition-all ${
              selected
                ? "border-primary bg-primary/5"
                : "border-outline-variant/40 hover:border-primary/40"
            }`}
          >
            <span className="relative block w-full overflow-hidden rounded-lg bg-white" style={{ aspectRatio: "1 / 1.414" }}>
              <Image
                src={`/resume-templates/${t.id}.png`}
                alt=""
                fill
                sizes="140px"
                className="object-cover object-top"
              />
            </span>
            <span className="text-caption text-on-surface truncate px-xs">{t.label}</span>
            {selected && (
              <span className="absolute top-1 right-1 rounded-full bg-primary text-on-primary p-0.5">
                <Check size={11} weight="bold" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

If a thumbnail file is missing for a template id, add a `onError` fallback that swaps to a neutral placeholder rather than letting Next's `Image` throw — check what exists first:

```bash
ls apps/web/public/resume-templates
```

- [ ] **Step 4: Implement SpacingPopover and TypePopover**

Both read and write the resume store directly, replacing the five equal-weight controls in `PreviewPanel`'s bar.

`SpacingPopover.tsx` renders the three `SPACING_PRESETS` as density cards (a three-line glyph at each preset's actual line height) with the two range inputs revealed under a "Custom" disclosure. Copy `SPACING_PRESETS` verbatim from `PreviewPanel.tsx`, including its comment.

`TypePopover.tsx` renders `FONT_CHOICES` as specimen rows — each label set in its own stack so the choice is visible — plus an accent row with `TEMPLATE_DEFAULT_ACCENT[templateId]` as the fallback value. Copy both `FONT_CHOICES` and `TEMPLATE_DEFAULT_ACCENT` verbatim from `PreviewPanel.tsx`, including their comments; the `FONT_CHOICES` keys must stay identical to `FONT_STACKS` in `apps/api/app/services/pdf.py`.

Each popover uses `@radix-ui/react-dialog` in its non-modal form, or a simple click-outside `useEffect` — do not add a new Radix package.

- [ ] **Step 5: Implement DockToolbar**

Create `apps/web/components/studio/preview/DockToolbar.tsx`: a floating pill (`rounded-full bg-desk-raised border border-desk-line shadow-2xl`) holding four popover triggers — `TextAa` (type), `ArrowsOutLineVertical` (spacing), `Layout` (template gallery), `ArrowsClockwise` (refresh) — and the page/zoom readout. Only **one** refresh control exists; its label is `Update preview` when `isStale`, `Refresh preview` otherwise, and `Refreshing…` when `isRefreshing`. There is no download control here — export lives in `CommandBar`.

- [ ] **Step 6: Implement PreviewDock**

Create `apps/web/components/studio/preview/PreviewDock.tsx`:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { FileText, SpinnerGap } from "@phosphor-icons/react";
import { useResumeStore } from "@/stores/resume-store";
import { UnderfillWarning } from "@/components/resume/UnderfillWarning";
import { DockToolbar } from "./DockToolbar";

// #toolbar=0 hides the browser's own PDF chrome — export lives in the
// command bar, and a second download button there read as a duplicate.
function withHiddenToolbar(url: string): string {
  return url.includes("#") ? url : `${url}#toolbar=0`;
}

export function PreviewDock({
  url,
  isRefreshing,
  isStale,
  onRefresh,
}: {
  url: string | null;
  isRefreshing: boolean;
  isStale: boolean;
  onRefresh: () => void;
}) {
  const previewUnderfilled = useResumeStore((s) => s.previewUnderfilled);
  // Cross-fade: hold the previous frame until the new one paints. The old
  // panel swapped src directly and flashed a blank/dark frame that read as
  // a failure.
  const [shown, setShown] = useState<string | null>(url);
  const [incoming, setIncoming] = useState<string | null>(null);
  const firstRef = useRef(true);

  useEffect(() => {
    if (url === shown) return;
    if (firstRef.current || shown === null) {
      firstRef.current = false;
      setShown(url);
      return;
    }
    setIncoming(url);
  }, [url, shown]);

  return (
    <div className="relative flex flex-col h-full bg-desk">
      <div className="flex-1 overflow-y-auto p-lg">
        {url && <UnderfillWarning show={previewUnderfilled} className="w-full mb-md" />}

        {url ? (
          <div
            className="relative w-full mx-auto max-w-[640px] rounded-lg overflow-hidden shadow-2xl bg-white"
            style={{ aspectRatio: "1 / 1.414" }}
          >
            {shown && (
              <iframe
                key={shown}
                src={withHiddenToolbar(shown)}
                title="Resume preview"
                className="absolute inset-0 w-full h-full"
              />
            )}
            <AnimatePresence>
              {incoming && (
                <motion.iframe
                  key={incoming}
                  src={withHiddenToolbar(incoming)}
                  title="Resume preview (updating)"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.25 }}
                  onLoad={() => {
                    setShown(incoming);
                    setIncoming(null);
                  }}
                  className="absolute inset-0 w-full h-full"
                />
              )}
            </AnimatePresence>
            {isRefreshing && (
              <span className="absolute top-sm right-sm rounded-full bg-desk-raised/90 p-xs">
                <SpinnerGap size={16} className="text-on-desk animate-spin" />
              </span>
            )}
          </div>
        ) : (
          <div
            className="w-full mx-auto max-w-[640px] rounded-lg border-2 border-dashed border-desk-line flex items-center justify-center"
            style={{ aspectRatio: "1 / 1.414" }}
          >
            <div className="text-center px-lg">
              <div className="w-14 h-14 rounded-full bg-desk-raised flex items-center justify-center mx-auto mb-md">
                <FileText size={28} className="text-on-desk" />
              </div>
              <p className="text-body-md font-semibold text-white mb-xs">No preview yet</p>
              <p className="text-body-sm text-on-desk">
                Refresh the preview to render your resume.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="absolute bottom-lg left-1/2 -translate-x-1/2">
        <DockToolbar onRefresh={onRefresh} isRefreshing={isRefreshing} isStale={isStale} />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run __tests__/components/preview-dock.test.tsx
```

Expected: PASS, 5 tests.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/studio/preview apps/web/__tests__/components/preview-dock.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio): add the dark preview dock with a floating toolbar

The page now floats on a recessed graphite desk instead of near-white, the
five equal-weight controls collapse into four popovers on a floating pill,
the template picker becomes a thumbnail gallery, and the iframe cross-fades
instead of flashing blank between renders. One refresh control, no second
download.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: `StudioShell` + `CommandBar` — assemble and wire up

**Files:**
- Create: `apps/web/components/studio/CommandBar.tsx`
- Create: `apps/web/components/studio/StudioShell.tsx`
- Modify: `apps/web/app/(app)/studio/[resumeId]/page.tsx`
- Test: `apps/web/__tests__/studio-resume-page.test.tsx` (update the existing file)

**Interfaces:**
- Consumes: everything built in Tasks 2–10.
- Produces:
  - `CommandBar({ title, isDirty, isSaving, saveError, onRename, onRetrySave, onExport, isExporting, exportError, onDelete, isDeleting }: …)`
  - `StudioShell({ resumeId, resume, careerProfile }: { resumeId: string; resume: Resume | undefined; careerProfile: CareerProfile | null | undefined })` — owns `activeSection` and `activeStep` state, derives steps via `deriveSteps`, and renders `CommandBar` / `StepSpine` / `SectionRail` / canvas-or-deck / `PreviewDock`.

- [ ] **Step 1: Read the existing page test**

```bash
cd apps/web && cat __tests__/studio-resume-page.test.tsx
```

Note which behaviors it asserts (title rename, save states, PDF export, template switching). Every one of these must still hold after the rewrite — they are the regression net for this task.

- [ ] **Step 2: Extend the test with workbench assertions**

Add to `apps/web/__tests__/studio-resume-page.test.tsx` a `describe("studio workbench")` block asserting:

```tsx
  it("renders the step spine", async () => {
    // …existing render helper for the page…
    expect(await screen.findByRole("navigation", { name: /Tailoring progress/i })).toBeInTheDocument();
  });

  it("renders the section rail", async () => {
    expect(await screen.findByRole("navigation", { name: /Resume sections/i })).toBeInTheDocument();
  });

  it("renders the preview dock without a duplicate download button", async () => {
    // Export is the command bar's; the dock must not offer a second one.
    const downloads = await screen.findAllByRole("button", { name: /download|export/i });
    expect(downloads).toHaveLength(1);
  });
```

- [ ] **Step 3: Run it to verify the new assertions fail**

```bash
cd apps/web && npx vitest run __tests__/studio-resume-page.test.tsx
```

Expected: the three new tests FAIL; the pre-existing ones still pass.

- [ ] **Step 4: Implement CommandBar**

Create `apps/web/components/studio/CommandBar.tsx` by porting the header of `app/(app)/studio/[resumeId]/page.tsx`: the inline title edit (`isEditingTitle` / `titleDraft` / `saveTitle` semantics), the save-state chip (`saveError` → retry / `isSaving` → Saving… / `isDirty` → Unsaved / else Saved), the arm-to-confirm delete, and the Export button. Presentation changes per the Global Constraints: title at `text-headline-md text-on-surface` (not `text-primary`), chips at `text-label-caps`. The template `<select>` is **not** ported — template selection now lives in `TemplateGallery` inside the dock. The Preview toggle is **not** ported — the dock is always docked.

- [ ] **Step 5: Implement StudioShell**

Create `apps/web/components/studio/StudioShell.tsx`. It owns two pieces of local UI state — `activeSection: SectionId` and `activeStep: StepId` — and wires the pieces together:

```tsx
  const steps = deriveSteps({
    jdId, jdText, atsScore, pendingContent,
    previewPdfUrl, pdfSignedUrl, isDirty,
    hasSavedRender: !!resume?.pdf_url,
  });
```

- `activeStep` initialises from `currentStepId(steps)` and follows it whenever the derived current step changes and the user has not manually overridden it this render cycle.
- When `activeStep === "review"`, the canvas renders `SummaryCard`, `TriageDeck` and `SkillsCard`; otherwise it renders the canvas section matching `activeSection`.
- `pendingBySection` is computed by counting `bulletChanges` per section — reuse the `bulletChanges` derivation from `BulletReviewPanel.tsx` (the `useMemo` comparing `pendingContent.experience[i].bullets[j]` against `originalContent.experience[i].bullets[j]`), copied verbatim into `StudioShell`.
- All the tailoring handlers (`handleRewriteBullet`, `handleRewriteSummary`, `handleRetailor`, `handleGeneratePreview`, `handleSave`, `handleDownload`, `handleReanalyze`) move here from `BulletReviewPanel.tsx` **unchanged** — same `apiClient` calls, same arguments, same error state.

Layout:

```tsx
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      <CommandBar … />
      <StepSpine steps={steps} activeStep={activeStep} onSelect={setActiveStep} score={atsScore} projected={projectedAtsScore} />
      <div className="flex-1 grid overflow-hidden grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)_minmax(0,44%)]">
        <div className="hidden xl:block overflow-hidden">
          <SectionRail … footer={activeStep === "review" ? <BoostPanel /> : null} />
        </div>
        <main className="overflow-y-auto px-lg py-xl">
          <div className="mx-auto w-full max-w-[720px] flex flex-col gap-xl">{canvas}</div>
        </main>
        <div className="hidden xl:block overflow-hidden">
          <PreviewDock … />
        </div>
      </div>
    </div>
```

- [ ] **Step 6: Rewrite the page to render the shell**

Replace the body of `apps/web/app/(app)/studio/[resumeId]/page.tsx` so it keeps **all** of its current data fetching and effects — the `["resume", resumeId]` query with its `initialData` and `staleTime`, the `["careerProfile"]` query, the `setResume` hydration guard, the `getLatestResumePdf` effect, the `prevTemplateIdRef` photo-prompt effect, the loading and error states, and `<PhotoRequirementModal>` — and replaces only the header + split-pane JSX with:

```tsx
  <StudioShell resumeId={resumeId} resume={resume} careerProfile={careerProfile} />
```

Do not change any query key, `staleTime`, or effect dependency array.

- [ ] **Step 7: Run the full suite**

```bash
cd apps/web && npm test
```

Expected: all tests pass, including the pre-existing studio page assertions.

- [ ] **Step 8: Typecheck and build**

```bash
cd apps/web && npx tsc --noEmit && npm run build
```

Expected: both succeed.

- [ ] **Step 9: Commit**

```bash
git add apps/web/components/studio/CommandBar.tsx apps/web/components/studio/StudioShell.tsx "apps/web/app/(app)/studio/[resumeId]/page.tsx" apps/web/__tests__/studio-resume-page.test.tsx
git commit -m "$(cat <<'EOF'
feat(studio): assemble the workbench and wire it into the studio route

Command bar, step spine, section rail, canvas/deck and preview dock are
now one shell. The route keeps every query, staleTime and effect it had;
only the header and split-pane markup are replaced.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Responsive behavior, JD page cleanup, and removal of the old components

**Files:**
- Modify: `apps/web/components/studio/StudioShell.tsx`
- Modify: `apps/web/app/(app)/jd/[jdId]/page.tsx:~400-430`
- Delete: `apps/web/components/resume/EditorPanel.tsx`
- Delete: `apps/web/components/resume/BulletReviewPanel.tsx`
- Delete: `apps/web/components/resume/PreviewPanel.tsx`
- Delete: `apps/web/components/resume/AtsGapFixPanel.tsx`
- Delete: `apps/web/components/resume/HumanizeSlider.tsx`
- Delete: `apps/web/__tests__/humanize-slider.test.tsx`
- Test: `apps/web/__tests__/jd-detail-page.test.tsx` (update)

**Interfaces:**
- Consumes: everything from Tasks 1–11.
- Produces: no new exports. The studio renders correctly below 1280px, and the JD page offers exactly one `Open` action.

- [ ] **Step 1: Add the responsive layers to StudioShell**

Below `xl` the three-pane grid collapses to one column. Add:

- A `railOpen` state rendering `SectionRail` inside a `@radix-ui/react-dialog` bottom sheet, opened by a rail button in `CommandBar` that is `xl:hidden`.
- A `dockOpen` state rendering `PreviewDock` full-screen in the same dialog primitive, opened by a preview button in `CommandBar` that is `xl:hidden`.
- At `lg`, keep the dock visible but drop the rail: `lg:grid-cols-[minmax(0,1fr)_minmax(0,44%)]`.
- In `TriageDeck`, pin the action row to the bottom of the viewport below `lg` with `sticky bottom-0 bg-surface-container-lowest/95 backdrop-blur-sm py-sm` on the `ChangeCard` action container.

- [ ] **Step 2: Verify the responsive layout by eye**

```bash
cd apps/web && npm run dev
```

Open `/studio/<any resume id>` and check 1440px, 1200px and 390px widths. Confirm: no horizontal page scroll at 390px, the spine scrolls horizontally rather than wrapping, and the rail and dock open as sheets.

- [ ] **Step 3: Write the failing test for the JD page**

Add to `apps/web/__tests__/jd-detail-page.test.tsx`:

```tsx
  it("offers exactly one Open action for the tailored resume", async () => {
    // …existing render helper for the JD detail page, with jdDetails present…
    const opens = await screen.findAllByRole("button", { name: /^Open/i });
    expect(opens).toHaveLength(1);
  });
```

- [ ] **Step 4: Run it to verify it fails**

```bash
cd apps/web && npx vitest run __tests__/jd-detail-page.test.tsx
```

Expected: FAIL — two `Open` buttons found.

- [ ] **Step 5: Remove the duplicate Open button**

In `apps/web/app/(app)/jd/[jdId]/page.tsx`, the "Resume Builder" card renders a `Tailor` / `Open` pair while the "Generated for This JD" card renders its own `Open` for the same `handleOpen`. Delete the `Open` button from the **"Resume Builder"** card, leaving `Tailor` as that card's single full-width action. The `Open` in "Generated for This JD" stays — it sits next to the resume it opens, which the other one did not.

Remove the now-unused `FolderOpen` import only if no other usage remains in the file.

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd apps/web && npx vitest run __tests__/jd-detail-page.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Confirm the old components have no remaining importers**

```bash
cd apps/web && grep -rn "EditorPanel\|BulletReviewPanel\|PreviewPanel\|AtsGapFixPanel\|HumanizeSlider" app components __tests__ --include=*.tsx --include=*.ts
```

Expected: no matches outside the files about to be deleted. If anything else still imports them, fix that importer before continuing.

- [ ] **Step 8: Delete the replaced components**

```bash
cd /d/AI-Copilot && git rm apps/web/components/resume/EditorPanel.tsx apps/web/components/resume/BulletReviewPanel.tsx apps/web/components/resume/PreviewPanel.tsx apps/web/components/resume/AtsGapFixPanel.tsx apps/web/components/resume/HumanizeSlider.tsx apps/web/__tests__/humanize-slider.test.tsx
```

- [ ] **Step 9: Run the full suite, typecheck and build**

```bash
cd apps/web && npm test && npx tsc --noEmit && npm run build
```

Expected: all three succeed. If `npm run build` reports an unused import or a missing module, fix it before committing.

- [ ] **Step 10: Commit**

```bash
git add -A apps/web docs
git commit -m "$(cat <<'EOF'
feat(studio): finish the workbench redesign and remove the old panels

Adds the sub-1280px layers (rail and dock as sheets, sticky deck actions),
drops the duplicate Open button on the JD detail page, and deletes
EditorPanel, BulletReviewPanel, PreviewPanel, AtsGapFixPanel and
HumanizeSlider now that nothing imports them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Spec coverage

| Spec section | Task |
|---|---|
| 1.1 Three planes | 1 (tokens), 10 (desk applied), 11 (canvas/rail applied) |
| 1.2 Accent discipline | Global Constraints; enforced in 4–11 |
| 1.3 Type scale correction | Global Constraints; 4 (ATS ring), 6, 7, 9 |
| 2.1 StepSpine | 2, 4 |
| 2.2 SectionRail | 3, 5; BoostPanel in 9 |
| 2.3 Canvas | 6 |
| 2.4 PreviewDock | 10 |
| 3 TriageDeck | 7, 8; summary/skills cards in 9 |
| 3 "Accept All" removal | 8 (`DeckList` take-all-remaining) |
| 4 Motion | 1 (`MotionConfig`); applied in 4, 5, 6, 8, 10 |
| 5 Component structure | 2–10; deletions in 12 |
| 6 Controls removed | 10 (preview-status button, second regenerate, second download), 8 (Accept All, pipe divider), 11 (Expand-to-edit, HumanizeSlider), 12 (duplicate Open) |
| 7 Responsive | 12 |
| 8 Testing | 2, 3 (pure modules); 4, 5, 6, 7, 8, 9, 10 (components); 11 (page regression) |
| 9 Out of scope | No task touches the sidebar, dashboard, JD analyzer index or interview center |

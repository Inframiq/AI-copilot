# Resume Builder Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the studio workbench with a full-screen, guided Builder that shows one resume section at a time with two-way navigation.

**Architecture:** A new `(builder)` route group gives the Builder a chrome-free layout without changing URLs, so `middleware.ts`'s `/studio` prefix still protects it. The six section editors and `lib/section-completeness.ts` are reused untouched; only the shell, navigation and layout are new. State stays in `resume-store` / `tailoring-store` — no new store.

**Tech Stack:** Next.js App Router, React 19, Zustand, Tailwind v4, Vitest + Testing Library (jsdom via a per-file `// @vitest-environment jsdom` pragma).

**Spec:** `docs/superpowers/specs/2026-09-18-resume-builder-redesign-design.md`

## Global Constraints

- Section IDs are exactly `contact | summary | experience | education | skills | extras`, from `lib/section-completeness.ts`. Never redefine them.
- Do not modify `resume-store`, `tailoring-store`, `apiClient`, any API route, or any Jinja template in this plan. Those belong to the Studio plan.
- Tailwind spacing tokens in this repo are named (`px-md`, `gap-sm`, `py-lg`), not numeric. Inset utilities with these tokens work (`top-md` is used in `dashboard/page.tsx`).
- Every component file gets a matching test at `apps/web/__tests__/components/<Name>.test.tsx` with `// @vitest-environment jsdom` on line 1.
- Run the full suite before each commit: `cd apps/web && npx vitest run && npx tsc --noEmit`. `tsc` reports pre-existing errors in `.next/` and `@vercel/*`; ignore only those.
- Deviation from the spec, agreed: `SectionChain`/`SectionBand` are deleted rather than extended (Task 8). Their section→editor mapping is extracted in Task 1.

---

### Task 1: SectionBody — the section→editor mapping

Extracts the private `bodyFor` switch from `SectionChain` so the Builder can render one section without the accordion.

**Files:**
- Create: `apps/web/components/builder/SectionBody.tsx`
- Test: `apps/web/__tests__/components/SectionBody.test.tsx`

**Interfaces:**
- Consumes: `SectionId` from `@/lib/section-completeness`; the six existing editors in `@/components/studio/canvas/`.
- Produces: `SectionBody({ id, focusIndex })` — renders exactly one section editor.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/studio/canvas/ContactSection", () => ({
  ContactSection: () => <div data-testid="contact" />,
}));
vi.mock("@/components/studio/canvas/SummarySection", () => ({
  SummarySection: () => <div data-testid="summary" />,
}));
vi.mock("@/components/studio/canvas/ExperienceSection", () => ({
  ExperienceSection: ({ focusIndex }: { focusIndex?: number }) => (
    <div data-testid="experience" data-focus={focusIndex ?? ""} />
  ),
}));
vi.mock("@/components/studio/canvas/EducationSection", () => ({
  EducationSection: () => <div data-testid="education" />,
}));
vi.mock("@/components/studio/canvas/SkillsSection", () => ({
  SkillsSection: () => <div data-testid="skills" />,
}));
vi.mock("@/components/studio/canvas/ExtrasSection", () => ({
  ExtrasSection: () => <div data-testid="extras" />,
}));

import { SectionBody } from "../../components/builder/SectionBody";

describe("SectionBody", () => {
  it("renders exactly the editor for the given section", () => {
    render(<SectionBody id="skills" />);
    expect(screen.getByTestId("skills")).toBeTruthy();
    expect(screen.queryByTestId("contact")).toBeNull();
  });

  it("renders each of the six sections", () => {
    for (const id of ["contact", "summary", "experience", "education", "skills", "extras"] as const) {
      const { unmount } = render(<SectionBody id={id} />);
      expect(screen.getByTestId(id)).toBeTruthy();
      unmount();
    }
  });

  it("passes focusIndex through to Experience", () => {
    render(<SectionBody id="experience" focusIndex={2} />);
    expect(screen.getByTestId("experience").getAttribute("data-focus")).toBe("2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/components/SectionBody.test.tsx`
Expected: FAIL — `Cannot find module '../../components/builder/SectionBody'`

- [ ] **Step 3: Write minimal implementation**

```tsx
"use client";
import type { SectionId } from "@/lib/section-completeness";
import { ContactSection } from "@/components/studio/canvas/ContactSection";
import { SummarySection } from "@/components/studio/canvas/SummarySection";
import { ExperienceSection } from "@/components/studio/canvas/ExperienceSection";
import { EducationSection } from "@/components/studio/canvas/EducationSection";
import { SkillsSection } from "@/components/studio/canvas/SkillsSection";
import { ExtrasSection } from "@/components/studio/canvas/ExtrasSection";

/** Renders one section's editor. Extracted from SectionChain's private
 * bodyFor switch so the Builder can show a single section without the
 * accordion; SectionChain is deleted in this plan's last task. */
export function SectionBody({ id, focusIndex }: { id: SectionId; focusIndex?: number }) {
  switch (id) {
    case "contact": return <ContactSection />;
    case "summary": return <SummarySection />;
    case "experience": return <ExperienceSection focusIndex={focusIndex} />;
    case "education": return <EducationSection focusIndex={focusIndex} />;
    case "skills": return <SkillsSection />;
    case "extras": return <ExtrasSection />;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/components/SectionBody.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/builder/SectionBody.tsx apps/web/__tests__/components/SectionBody.test.tsx
git commit -m "feat(builder): extract the section-to-editor mapping"
```

---

### Task 2: SectionStepper

The ✓ / ● / ○ navigation. Clickable in both directions — this is not a locked wizard.

**Files:**
- Create: `apps/web/components/builder/SectionStepper.tsx`
- Test: `apps/web/__tests__/components/SectionStepper.test.tsx`

**Interfaces:**
- Consumes: `sectionStates(content)` from `@/lib/section-completeness`, returning `SectionState[]` where `SectionState = { id, label, ratio, complete }`.
- Produces: `SectionStepper({ content, current, onSelect })`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SectionStepper } from "../../components/builder/SectionStepper";
import type { ResumeContent } from "@career-copilot/types";

const FILLED: ResumeContent = {
  contact: { name: "Jane Doe", email: "jane@example.com", phone: "123", location: "Berlin" },
  summary: "Engineer with six years building payment systems.",
  experience: [],
  education: [],
  skills: [],
};

describe("SectionStepper", () => {
  it("marks a filled section complete", () => {
    render(<SectionStepper content={FILLED} current="experience" onSelect={() => {}} />);
    expect(screen.getByTestId("step-contact").getAttribute("data-state")).toBe("complete");
  });

  it("marks the current section current, even when it is empty", () => {
    render(<SectionStepper content={FILLED} current="experience" onSelect={() => {}} />);
    expect(screen.getByTestId("step-experience").getAttribute("data-state")).toBe("current");
  });

  it("marks an empty, non-current section upcoming", () => {
    render(<SectionStepper content={FILLED} current="experience" onSelect={() => {}} />);
    expect(screen.getByTestId("step-skills").getAttribute("data-state")).toBe("upcoming");
  });

  it("lets you jump backward, not just forward", () => {
    const onSelect = vi.fn();
    render(<SectionStepper content={FILLED} current="skills" onSelect={onSelect} />);
    screen.getByTestId("step-contact").click();
    expect(onSelect).toHaveBeenCalledWith("contact");
  });

  it("lets you jump forward past an incomplete section", () => {
    // Nothing is locked — the spec is explicit that this is not a wizard.
    const onSelect = vi.fn();
    render(<SectionStepper content={FILLED} current="contact" onSelect={onSelect} />);
    screen.getByTestId("step-extras").click();
    expect(onSelect).toHaveBeenCalledWith("extras");
  });

  it("names every step for screen readers", () => {
    render(<SectionStepper content={FILLED} current="contact" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /summary/i })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/components/SectionStepper.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```tsx
"use client";
import { Check } from "@phosphor-icons/react";
import { sectionStates, type SectionId } from "@/lib/section-completeness";
import type { ResumeContent } from "@career-copilot/types";

/** Contact → Summary → … → Extras. Every step is reachable in both
 * directions: the spec is explicit that this must not behave like a locked
 * wizard, so nothing here is ever disabled. */
export function SectionStepper({
  content,
  current,
  onSelect,
}: {
  content: ResumeContent | null;
  current: SectionId;
  onSelect: (id: SectionId) => void;
}) {
  const states = sectionStates(content);
  return (
    <nav
      aria-label="Resume sections"
      className="flex items-center gap-xs overflow-x-auto px-lg py-sm"
    >
      {states.map((state, i) => {
        const status =
          state.id === current ? "current" : state.complete ? "complete" : "upcoming";
        return (
          <div key={state.id} className="flex shrink-0 items-center gap-xs">
            {i > 0 && <span aria-hidden className="h-px w-8 bg-outline-variant/40" />}
            <button
              type="button"
              data-testid={`step-${state.id}`}
              data-state={status}
              aria-current={status === "current" ? "step" : undefined}
              onClick={() => onSelect(state.id)}
              className={`flex items-center gap-xs rounded-full px-sm py-xs text-label-md transition-colors ${
                status === "current"
                  ? "text-primary font-semibold"
                  : status === "complete"
                  ? "text-on-surface-variant hover:text-on-surface"
                  : "text-on-surface-variant/60 hover:text-on-surface-variant"
              }`}
            >
              <span
                aria-hidden
                className={`flex h-5 w-5 items-center justify-center rounded-full border text-caption ${
                  status === "complete"
                    ? "border-success bg-success text-on-success"
                    : status === "current"
                    ? "border-primary text-primary"
                    : "border-outline-variant/60"
                }`}
              >
                {status === "complete" ? <Check size={12} weight="bold" /> : i + 1}
              </span>
              {state.label}
            </button>
          </div>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/components/SectionStepper.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/builder/SectionStepper.tsx apps/web/__tests__/components/SectionStepper.test.tsx
git commit -m "feat(builder): add the clickable section stepper"
```

---

### Task 3: BuilderNav

Previous / Continue, with the last step's primary action becoming Preview Resume.

**Files:**
- Create: `apps/web/components/builder/BuilderNav.tsx`
- Test: `apps/web/__tests__/components/BuilderNav.test.tsx`

**Interfaces:**
- Consumes: `SECTION_ORDER: SectionId[]` — add this export to `lib/section-completeness.ts` in Step 3 if absent.
- Produces: `BuilderNav({ current, onPrevious, onNext, onPreview })`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BuilderNav } from "../../components/builder/BuilderNav";

describe("BuilderNav", () => {
  it("disables Previous on the first section", () => {
    render(<BuilderNav current="contact" onPrevious={() => {}} onNext={() => {}} onPreview={() => {}} />);
    expect(screen.getByRole("button", { name: /previous/i }).hasAttribute("disabled")).toBe(true);
  });

  it("enables Previous once past the first section", () => {
    render(<BuilderNav current="summary" onPrevious={() => {}} onNext={() => {}} onPreview={() => {}} />);
    expect(screen.getByRole("button", { name: /previous/i }).hasAttribute("disabled")).toBe(false);
  });

  it("offers Continue on a middle section", () => {
    render(<BuilderNav current="skills" onPrevious={() => {}} onNext={() => {}} onPreview={() => {}} />);
    expect(screen.getByRole("button", { name: /continue/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /preview resume/i })).toBeNull();
  });

  it("replaces Continue with Preview Resume on the last section", () => {
    render(<BuilderNav current="extras" onPrevious={() => {}} onNext={() => {}} onPreview={() => {}} />);
    expect(screen.getByRole("button", { name: /preview resume/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
  });

  it("calls onPreview from the last section's primary action", () => {
    const onPreview = vi.fn();
    render(<BuilderNav current="extras" onPrevious={() => {}} onNext={() => {}} onPreview={onPreview} />);
    screen.getByRole("button", { name: /preview resume/i }).click();
    expect(onPreview).toHaveBeenCalled();
  });

  it("names the next section so the button says where it goes", () => {
    render(<BuilderNav current="contact" onPrevious={() => {}} onNext={() => {}} onPreview={() => {}} />);
    expect(screen.getByRole("button", { name: /continue/i }).textContent).toMatch(/summary/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/components/BuilderNav.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

First add the order export to `apps/web/lib/section-completeness.ts` (append, do not alter existing exports):

```ts
/** Canonical Builder order. sectionStates() already returns this order; this
 * export exists so navigation can reason about neighbours without depending
 * on array positions. */
export const SECTION_ORDER: SectionId[] = [
  "contact", "summary", "experience", "education", "skills", "extras",
];
```

Then `apps/web/components/builder/BuilderNav.tsx`:

```tsx
"use client";
import { ArrowLeft, ArrowRight, Eye } from "@phosphor-icons/react";
import { SECTION_ORDER, sectionStates, type SectionId } from "@/lib/section-completeness";

const LABEL: Record<SectionId, string> =
  Object.fromEntries(sectionStates(null).map((s) => [s.id, s.label])) as Record<SectionId, string>;

export function BuilderNav({
  current,
  onPrevious,
  onNext,
  onPreview,
}: {
  current: SectionId;
  onPrevious: () => void;
  onNext: () => void;
  onPreview: () => void;
}) {
  const i = SECTION_ORDER.indexOf(current);
  const prev = i > 0 ? SECTION_ORDER[i - 1] : null;
  const next = i < SECTION_ORDER.length - 1 ? SECTION_ORDER[i + 1] : null;

  return (
    <div className="flex items-center justify-between gap-md border-t border-outline-variant/30 px-lg py-md">
      <button
        type="button"
        onClick={onPrevious}
        disabled={!prev}
        className="flex items-center gap-xs rounded-xl px-md py-sm text-label-md text-on-surface-variant transition-colors hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ArrowLeft size={16} />
        {prev ? `Previous: ${LABEL[prev]}` : "Previous"}
      </button>

      {next ? (
        <button
          type="button"
          onClick={onNext}
          className="flex items-center gap-xs rounded-xl bg-primary px-lg py-sm text-label-md text-on-primary shadow-md transition-shadow hover:shadow-lg"
        >
          {`Continue to ${LABEL[next]}`}
          <ArrowRight size={16} />
        </button>
      ) : (
        <button
          type="button"
          onClick={onPreview}
          className="flex items-center gap-xs rounded-xl bg-primary px-lg py-sm text-label-md text-on-primary shadow-md transition-shadow hover:shadow-lg"
        >
          <Eye size={16} />
          Preview Resume
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/components/BuilderNav.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/builder/BuilderNav.tsx apps/web/lib/section-completeness.ts apps/web/__tests__/components/BuilderNav.test.tsx
git commit -m "feat(builder): add section navigation with a preview handoff"
```

---

### Task 4: BuilderHeader

Back, title, and the autosave status the spec asks for where the architecture supports it — `resume-store` already exposes `isDirty`, `isSaving` and `saveError`.

**Files:**
- Create: `apps/web/components/builder/BuilderHeader.tsx`
- Test: `apps/web/__tests__/components/BuilderHeader.test.tsx`

**Interfaces:**
- Consumes: `useResumeStore` fields `isDirty: boolean`, `isSaving: boolean`, `saveError: string | null`.
- Produces: `BuilderHeader({ title, onBack, backLabel })`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { BuilderHeader } from "../../components/builder/BuilderHeader";
import { useResumeStore } from "../../stores/resume-store";

describe("BuilderHeader", () => {
  beforeEach(() => useResumeStore.setState({ isDirty: false, isSaving: false, saveError: null }));

  it("shows the resume title", () => {
    render(<BuilderHeader title="Jane's Resume" onBack={() => {}} backLabel="Back" />);
    expect(screen.getByText("Jane's Resume")).toBeTruthy();
  });

  it("reports saved when there is nothing pending", () => {
    render(<BuilderHeader title="R" onBack={() => {}} backLabel="Back" />);
    expect(screen.getByTestId("save-status").textContent).toMatch(/saved/i);
  });

  it("reports saving while a write is in flight", () => {
    useResumeStore.setState({ isSaving: true });
    render(<BuilderHeader title="R" onBack={() => {}} backLabel="Back" />);
    expect(screen.getByTestId("save-status").textContent).toMatch(/saving/i);
  });

  it("reports unsaved changes when dirty", () => {
    useResumeStore.setState({ isDirty: true });
    render(<BuilderHeader title="R" onBack={() => {}} backLabel="Back" />);
    expect(screen.getByTestId("save-status").textContent).toMatch(/unsaved/i);
  });

  it("surfaces a save error over every other status", () => {
    useResumeStore.setState({ isDirty: true, isSaving: true, saveError: "Network down" });
    render(<BuilderHeader title="R" onBack={() => {}} backLabel="Back" />);
    expect(screen.getByTestId("save-status").textContent).toMatch(/network down/i);
  });

  it("calls onBack with the caller's label", () => {
    const onBack = vi.fn();
    render(<BuilderHeader title="R" onBack={onBack} backLabel="Back to Analyzer" />);
    screen.getByRole("button", { name: /back to analyzer/i }).click();
    expect(onBack).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/components/BuilderHeader.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```tsx
"use client";
import { ArrowLeft, CheckCircle, WarningCircle, CircleNotch } from "@phosphor-icons/react";
import { useResumeStore } from "@/stores/resume-store";

export function BuilderHeader({
  title,
  onBack,
  backLabel,
}: {
  title: string;
  onBack: () => void;
  backLabel: string;
}) {
  const isDirty = useResumeStore((s) => s.isDirty);
  const isSaving = useResumeStore((s) => s.isSaving);
  const saveError = useResumeStore((s) => s.saveError);

  // Error first: a failed write matters more than whatever else is pending.
  const status = saveError
    ? { icon: <WarningCircle size={14} weight="fill" />, text: saveError, tone: "text-error" }
    : isSaving
    ? { icon: <CircleNotch size={14} className="animate-spin" />, text: "Saving…", tone: "text-on-surface-variant" }
    : isDirty
    ? { icon: null, text: "Unsaved changes", tone: "text-on-surface-variant" }
    : { icon: <CheckCircle size={14} weight="fill" />, text: "All changes saved", tone: "text-success" };

  return (
    <header className="flex items-center gap-lg border-b border-outline-variant/30 px-lg py-md">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-xs text-label-md text-on-surface-variant transition-colors hover:text-on-surface"
      >
        <ArrowLeft size={16} />
        {backLabel}
      </button>
      <span aria-hidden className="h-4 w-px bg-outline-variant/40" />
      <h1 className="text-headline-md font-semibold text-on-surface">{title}</h1>
      <span
        data-testid="save-status"
        className={`ml-auto flex items-center gap-xs text-caption ${status.tone}`}
      >
        {status.icon}
        {status.text}
      </span>
    </header>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/components/BuilderHeader.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/builder/BuilderHeader.tsx apps/web/__tests__/components/BuilderHeader.test.tsx
git commit -m "feat(builder): add the builder header with autosave status"
```

---

### Task 5: ContextRail — JD context, Path A only

Renders only when a JD context exists, so Path B stays a clean single column.

**Files:**
- Create: `apps/web/components/builder/ContextRail.tsx`
- Test: `apps/web/__tests__/components/ContextRail.test.tsx`

**Interfaces:**
- Consumes: `useTailoringStore` fields `jdId: string | null`, `jdText: string`, `missingSkills: string[]`, `matchedSkills: string[]`, `atsScore: number | null`, `jdImportance: Record<string, "high"|"medium"|"low">`. Reuses `ImportanceBadge` from `@/components/resume/ImportanceBadge`.
- Produces: `ContextRail()` — self-contained, reads the store directly.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContextRail } from "../../components/builder/ContextRail";
import { useTailoringStore } from "../../stores/tailoring-store";

describe("ContextRail", () => {
  beforeEach(() => useTailoringStore.getState().resetStore());

  it("renders nothing without a JD context (Path B)", () => {
    const { container } = render(<ContextRail />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders once a JD is attached (Path A)", () => {
    useTailoringStore.setState({ jdId: "jd-1", missingSkills: ["Kubernetes"] } as never);
    render(<ContextRail />);
    expect(screen.getByText("Kubernetes")).toBeTruthy();
  });

  it("renders for a pasted JD with no id", () => {
    useTailoringStore.setState({ jdText: "Need Python.", missingSkills: ["Python"] } as never);
    render(<ContextRail />);
    expect(screen.getByText("Python")).toBeTruthy();
  });

  it("shows the ATS score when one has been computed", () => {
    useTailoringStore.setState({ jdId: "jd-1", atsScore: 72 } as never);
    render(<ContextRail />);
    expect(screen.getByTestId("rail-ats").textContent).toContain("72");
  });

  it("omits the score block before any analysis has run", () => {
    useTailoringStore.setState({ jdId: "jd-1", atsScore: null } as never);
    render(<ContextRail />);
    expect(screen.queryByTestId("rail-ats")).toBeNull();
  });

  it("badges a missing keyword with its importance", () => {
    useTailoringStore.setState({
      jdId: "jd-1",
      missingSkills: ["Kubernetes"],
      jdImportance: { kubernetes: "high" },
    } as never);
    render(<ContextRail />);
    expect(screen.getByTestId("importance-badge").getAttribute("data-level")).toBe("high");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/components/ContextRail.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```tsx
"use client";
import { Target } from "@phosphor-icons/react";
import { useTailoringStore } from "@/stores/tailoring-store";
import { ImportanceBadge } from "@/components/resume/ImportanceBadge";

/** JD context beside the Builder. Renders only on Path A (JD Analyzer →
 * Tailor → Builder); Path B gets a single clean column, per the spec. */
export function ContextRail() {
  const jdId = useTailoringStore((s) => s.jdId);
  const jdText = useTailoringStore((s) => s.jdText);
  const missingSkills = useTailoringStore((s) => s.missingSkills);
  const atsScore = useTailoringStore((s) => s.atsScore);
  const jdImportance = useTailoringStore((s) => s.jdImportance);

  if (!jdId && !jdText.trim()) return null;

  return (
    <aside className="flex w-full flex-col gap-md lg:w-80">
      <section className="flex flex-col gap-sm rounded-2xl border border-outline-variant/30 bg-surface p-md">
        <h2 className="flex items-center gap-xs text-label-md font-semibold text-on-surface">
          <Target size={18} className="text-primary" />
          Target JD match
        </h2>
        {atsScore !== null && (
          <p data-testid="rail-ats" className="text-caption text-on-surface-variant">
            Currently matching <strong className="text-on-surface">{atsScore}%</strong> of this job description.
          </p>
        )}
        {missingSkills.length > 0 && (
          <>
            <p className="text-caption text-on-surface-variant">
              Add these to strengthen the match:
            </p>
            <ul className="flex flex-wrap gap-xs">
              {missingSkills.slice(0, 8).map((skill) => (
                <li
                  key={skill}
                  className="flex items-center gap-xs rounded-full border border-outline-variant/40 px-sm py-0.5 text-caption text-on-surface-variant"
                >
                  {skill}
                  {jdImportance[skill.toLowerCase()] && (
                    <ImportanceBadge level={jdImportance[skill.toLowerCase()]} />
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/components/ContextRail.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/builder/ContextRail.tsx apps/web/__tests__/components/ContextRail.test.tsx
git commit -m "feat(builder): add the JD context rail for the tailoring path"
```

---

### Task 6: The chrome-free route group

Gives the Builder the full viewport. URLs are unchanged, so `middleware.ts`'s `/studio` prefix still protects it.

**Files:**
- Create: `apps/web/app/(builder)/layout.tsx`
- Test: `apps/web/__tests__/builder-layout.test.tsx`

**Interfaces:**
- Produces: a layout with no `Sidebar` and no `TopNav`, keeping `PlanTracker` for analytics parity with `(app)/layout.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/analytics/PlanTracker", () => ({ PlanTracker: () => <div /> }));

import BuilderLayout from "../app/(builder)/layout";

describe("(builder) layout", () => {
  it("renders its children", () => {
    render(<BuilderLayout><p>child</p></BuilderLayout>);
    expect(screen.getByText("child")).toBeTruthy();
  });

  it("mounts no app sidebar — the Builder owns the whole viewport", () => {
    const { container } = render(<BuilderLayout><p>child</p></BuilderLayout>);
    expect(container.querySelector("aside")).toBeNull();
  });

  it("mounts no top nav", () => {
    const { container } = render(<BuilderLayout><p>child</p></BuilderLayout>);
    expect(container.querySelector("header")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/builder-layout.test.tsx`
Expected: FAIL — cannot find `../app/(builder)/layout`

- [ ] **Step 3: Write minimal implementation**

```tsx
import { PlanTracker } from "@/components/analytics/PlanTracker";

/** The Builder and Studio own the full viewport — no app sidebar, no top nav.
 * A route group changes no URLs, so middleware.ts's "/studio" prefix still
 * protects everything under here. */
export default function BuilderLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-on-background">
      {children}
      <PlanTracker />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/builder-layout.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(builder)/layout.tsx" apps/web/__tests__/builder-layout.test.tsx
git commit -m "feat(builder): add a chrome-free route group for the builder"
```

---

### Task 7: BuilderShell and the route move

Assembles the pieces and moves `/studio/[resumeId]` into the new group. The route file's existing data loading (`useQuery` for the resume, `setResume`, photo modal) is preserved verbatim — only what it renders changes.

**Files:**
- Create: `apps/web/components/builder/BuilderShell.tsx`
- Create: `apps/web/app/(builder)/studio/[resumeId]/page.tsx` (moved from `(app)/studio/[resumeId]/page.tsx`)
- Delete: `apps/web/app/(app)/studio/[resumeId]/page.tsx`
- Test: `apps/web/__tests__/components/BuilderShell.test.tsx`

**Interfaces:**
- Consumes: `SectionBody`, `SectionStepper`, `BuilderNav`, `BuilderHeader`, `ContextRail` from Tasks 1–5.
- Produces: `BuilderShell({ title, onBack, backLabel, onPreview })`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/builder/SectionBody", () => ({
  SectionBody: ({ id }: { id: string }) => <div data-testid={`body-${id}`} />,
}));

import { BuilderShell } from "../../components/builder/BuilderShell";
import { useResumeStore } from "../../stores/resume-store";
import { useTailoringStore } from "../../stores/tailoring-store";

const CONTENT = {
  contact: { name: "Jane", email: "jane@example.com" },
  experience: [], education: [], skills: [],
};

function renderShell() {
  return render(
    <BuilderShell title="R" onBack={() => {}} backLabel="Back" onPreview={() => {}} />,
  );
}

describe("BuilderShell", () => {
  beforeEach(() => {
    useResumeStore.getState().resetStore();
    useTailoringStore.getState().resetStore();
    useResumeStore.setState({ content: CONTENT } as never);
  });

  it("opens on Contact", () => {
    renderShell();
    expect(screen.getByTestId("body-contact")).toBeTruthy();
  });

  it("shows only one section at a time", () => {
    renderShell();
    expect(screen.queryByTestId("body-skills")).toBeNull();
  });

  it("advances with Continue", () => {
    renderShell();
    screen.getByRole("button", { name: /continue/i }).click();
    expect(screen.getByTestId("body-summary")).toBeTruthy();
  });

  it("goes back with Previous", () => {
    renderShell();
    screen.getByRole("button", { name: /continue/i }).click();
    screen.getByRole("button", { name: /previous/i }).click();
    expect(screen.getByTestId("body-contact")).toBeTruthy();
  });

  it("jumps straight to a section from the stepper", () => {
    renderShell();
    screen.getByTestId("step-extras").click();
    expect(screen.getByTestId("body-extras")).toBeTruthy();
  });

  it("calls onPreview from the last section", () => {
    const onPreview = vi.fn();
    render(<BuilderShell title="R" onBack={() => {}} backLabel="Back" onPreview={onPreview} />);
    screen.getByTestId("step-extras").click();
    screen.getByRole("button", { name: /preview resume/i }).click();
    expect(onPreview).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/components/BuilderShell.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```tsx
"use client";
import { useState } from "react";
import { useResumeStore } from "@/stores/resume-store";
import { SECTION_ORDER, type SectionId } from "@/lib/section-completeness";
import { BuilderHeader } from "./BuilderHeader";
import { SectionStepper } from "./SectionStepper";
import { SectionBody } from "./SectionBody";
import { BuilderNav } from "./BuilderNav";
import { ContextRail } from "./ContextRail";

export function BuilderShell({
  title,
  onBack,
  backLabel,
  onPreview,
}: {
  title: string;
  onBack: () => void;
  backLabel: string;
  onPreview: () => void;
}) {
  const content = useResumeStore((s) => s.content);
  const [current, setCurrent] = useState<SectionId>("contact");
  const i = SECTION_ORDER.indexOf(current);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <BuilderHeader title={title} onBack={onBack} backLabel={backLabel} />
      <SectionStepper content={content} current={current} onSelect={setCurrent} />

      <div className="flex flex-1 flex-col gap-xl overflow-y-auto px-lg py-xl lg:flex-row lg:justify-center">
        <main className="w-full max-w-3xl">
          <SectionBody id={current} />
        </main>
        <ContextRail />
      </div>

      <BuilderNav
        current={current}
        onPrevious={() => i > 0 && setCurrent(SECTION_ORDER[i - 1])}
        onNext={() => i < SECTION_ORDER.length - 1 && setCurrent(SECTION_ORDER[i + 1])}
        onPreview={onPreview}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/components/BuilderShell.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Move the route**

Copy `apps/web/app/(app)/studio/[resumeId]/page.tsx` to `apps/web/app/(builder)/studio/[resumeId]/page.tsx`. Keep every hook, the `useQuery`, `setResume`, and `PhotoRequirementModal` exactly as they are. Replace only the `<StudioShell .../>` render with:

```tsx
<BuilderShell
  title={resume?.title ?? "Resume"}
  backLabel={jdId ? "Back to Analyzer" : "Back to Resumes"}
  onBack={() => router.push(jdId ? `/jd/${jdId}` : "/studio")}
  onPreview={() => router.push(`/studio/${resumeId}/preview`)}
/>
```

Read `jdId` with `const jdId = useTailoringStore((s) => s.jdId);`. Then delete the old file.

- [ ] **Step 6: Run the full suite**

Run: `cd apps/web && npx vitest run && npx tsc --noEmit`
Expected: all green; `tsc` shows only the pre-existing `.next/` and `@vercel/*` errors.

- [ ] **Step 7: Commit**

```bash
git add -A apps/web/app apps/web/components/builder apps/web/__tests__
git commit -m "feat(builder): assemble the builder shell and move the studio route"
```

---

### Task 8: Remove the superseded workbench

Only after Task 7 is green — the Builder must be serving the route before this deletes its predecessor.

**Files:**
- Delete: `apps/web/components/studio/StudioShell.tsx`, `CommandBar.tsx`
- Delete: `apps/web/components/studio/spine/` (3 files), `apps/web/components/studio/rail/` (4 files)
- Delete: `apps/web/components/studio/canvas/SectionChain.tsx`, `SectionBand.tsx`
- Delete: `apps/web/lib/studio-steps.ts`, `apps/web/__tests__/studio-steps.test.ts` (if present)
- Keep: everything in `components/studio/canvas/*Section.tsx`, `components/studio/review/`, `components/studio/preview/`, `SourcePanel.tsx`

- [ ] **Step 1: Confirm nothing still imports them**

```bash
cd apps/web
grep -rn "StudioShell\|CommandBar\|SectionChain\|SectionBand\|studio-steps\|studio/spine\|studio/rail" \
  app components lib stores __tests__ | grep -v node_modules
```
Expected: no results outside the files being deleted. If `preview/PreviewDock` is referenced only by `StudioShell`, leave it — the Studio plan moves it.

- [ ] **Step 2: Delete**

```bash
cd apps/web
git rm components/studio/StudioShell.tsx components/studio/CommandBar.tsx
git rm -r components/studio/spine components/studio/rail
git rm components/studio/canvas/SectionChain.tsx components/studio/canvas/SectionBand.tsx
git rm lib/studio-steps.ts
git rm -f __tests__/studio-steps.test.ts 2>/dev/null || true
```

- [ ] **Step 3: Run the full suite**

Run: `cd apps/web && npx vitest run && npx tsc --noEmit`
Expected: all green. A failure here means something still imported a deleted file — fix the import rather than restoring the file.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(studio): remove the workbench shell superseded by the builder"
```

---

## Self-Review

**Spec coverage.** §1 two-way navigation → Tasks 2, 3, 7. §2 full-screen + both entry paths → Tasks 6, 7. §3 header and stepper → Tasks 2, 4. §4 one section, Previous/Continue/Preview → Tasks 1, 3, 7. §5–10 the six sections → Task 1 (reuses existing editors unchanged). §16 spacing/typography → carried by the components; a dedicated pass is the Studio plan's polish phase. §17 responsive → stepper scrolls (Task 2), rail stacks below `lg` (Tasks 5, 7). §18 preserved → Global Constraints forbid touching stores/APIs; Task 7 keeps the route's data loading verbatim. §22 tailoring → Task 5 rail; the review deck is untouched and wired in the Studio plan.

**Not covered here, by design:** §11–15 (Studio, inline editing, export), §21's preview→builder round trip. Those need the `/html` endpoint and template annotation, and are the second plan.

**Placeholder scan:** none — every step carries runnable code or an exact command.

**Type consistency:** `SectionId` and `sectionStates` come from `lib/section-completeness.ts` throughout; `SECTION_ORDER` is defined once in Task 3 and consumed in Tasks 3 and 7. `BuilderShell`'s four props match the call site in Task 7 Step 5.

**Known gap:** Task 7's test mocks `SectionBody`, so it verifies navigation, not that the real editors mount. That is deliberate — the editors are existing, already-working components and mounting them would pull the whole store graph into a navigation test.

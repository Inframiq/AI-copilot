# Resume Studio — Workbench Redesign

**Date:** 2026-09-18
**Status:** Approved design, ready for implementation plan
**Scope:** `apps/web` — Resume Builder (`/studio/[resumeId]`) and the AI tailoring flow. Presentation layer only; Zustand stores, API client and tailoring state machine behavior are unchanged.

## Problem

The builder and tailoring surfaces read as static and clumsy. Four concrete causes, all verified in the current code:

1. **The tailoring flow is a state machine with no visible state.** `EditorPanel` renders three mutually exclusive modes into one slot — `hasJdContext` → `TailoringForm`, `pendingContent` → `BulletReviewPanel`, else the manual-paste form. The user is never shown which mode they are in, what precedes it, or what comes next.
2. **Everything sits on one visual plane.** `bg-surface` + `border-outline-variant/20` + `rounded-xl` + `shadow-sm` is applied identically to the ATS score card, a text input, a bullet diff and a section header. Nothing recedes, nothing advances.
3. **The type scale is inverted.** The ATS score — the product's central number — renders at `text-caption` (11px) in three separate places with three treatments. Panel titles render at `text-headline-md` (24px), twice the size of the 14px bullet content they label.
4. **Controls are undifferentiated or dishonest.** `PreviewPanel`'s bar carries five unrelated controls at equal weight in one wrapping flex row. Template selection — an inherently visual choice — is a native `<select>` while the thumbnails in `public/resume-templates/` go unused.

## Decisions

| Decision | Choice |
|---|---|
| Structure | Three-pane workbench + horizontal step spine |
| Change review | Triage deck (one decision at a time) with a list escape hatch |
| Motion | `motion/react` (framer-motion), new dependency |
| Scope | Presentation rewrite **plus** decomposition of the two god-components |

## 1. Art direction

Uses the existing "Cobalt & Ink" tokens. No new palette.

### 1.1 Three planes

| Plane | Current | Target | Rationale |
|---|---|---|---|
| Desk (preview background) | `surface-container` `#f0f1f4` | Ink graphite (`inverse-surface` family) | A white page on near-white has no separation. On graphite the page floats. |
| Workspace (canvas) | `surface` `#fcfcfd` | `surface-container-lowest` (pure white) | The active work surface; brightest plane. |
| Rail | `surface` | `surface-container-low` + inset edge | Navigation recedes behind content. |

### 1.2 Accent discipline

Cobalt (`primary`) is currently applied to headings, chips, borders and buttons alike, so it carries no meaning. **New rule: cobalt indicates interactive or current state only.** Section and panel headings move to `on-surface` / `on-surface-variant`.

### 1.3 Type scale correction

| Element | Current | Target |
|---|---|---|
| ATS score | `text-caption` (11px) | 48px, `tabular-nums`, inside an animated ring |
| Panel / section titles | `text-headline-md` (24px), `text-primary` | `text-label-caps` (12px uppercase), `on-surface-variant` |
| Bullet body text | `text-body-sm` (14px) | `text-body-md` (16px), `leading-relaxed` |

Scores and any animated counters use `font-variant-numeric: tabular-nums` so count-up does not jitter.

## 2. Shell

```
CommandBar   56px sticky   back · inline-edit title · save state · Export
StepSpine    64px sticky   (1)-(2)-(3)-(4)-(5) + ATS ring
Rail 260px | Canvas max-w 720 | PreviewDock ~44% (dark)
```

### 2.1 StepSpine

Five nodes. State is **derived** from values the stores already hold; no new state is introduced.

| Step | Derived from | Locked until |
|---|---|---|
| 1 Source | `jdId` or non-empty `jdText` | — |
| 2 Match | `atsScore !== null` | a JD exists |
| 3 Review | `pendingContent !== null` | tailoring has run |
| 4 Polish | `previewPdfUrl` or `pdfSignedUrl` | a render exists |
| 5 Export | saved and not dirty | a render exists |

Node states: **done** (filled, check icon) · **current** (ring with slow pulse) · **available** (outline, clickable) · **locked** (40% ghost, not clickable, tooltip naming what unlocks it). Connectors fill via a spring-driven `scaleX`.

Clicking a done or available node switches the canvas to that step. Locked nodes are inert.

**AtsRing** sits at the spine's right end: 48px tabular number in a `pathLength`-animated ring. When `projectedAtsScore` diverges from `atsScore`, the number counts up and a delta chip springs in.

### 2.2 SectionRail

Replaces the seven-trigger Radix `Tabs.List` in `EditorPanel`.

- One row per section with a completeness ring driven by populated-field count.
- Experience and Education expand to per-entry sub-rows for direct navigation.
- During Review, each row carries a pending-change count badge.
- Footer shows `N of M complete`.
- **BoostPanel** (the relocated `AtsGapFixPanel`) renders at the rail bottom during Review — unclaimed ATS points as an ambient checklist rather than another block in a long scroll.

### 2.3 Canvas

One section at a time at reading width, replacing the stacked wall of inputs. Contact is a two-column form; Experience is an entry stack with bullets as a real list; Skills uses a chip editor rather than a joined textarea. During Review the canvas hosts the TriageDeck.

### 2.4 PreviewDock

The white page on the graphite desk with a real elevation shadow.

The five-control wrapping bar is removed. Its functions move to a floating segmented toolbar pinned bottom-center of the dock, with four popovers:

- **Type + accent** — typeface specimens and accent swatches, replacing a `<select>` and a bare `<input type="color">`.
- **Spacing** — the three presets as visual density cards; sliders available under "custom".
- **Template** — a thumbnail gallery sourced from `public/resume-templates/`, replacing the native `<select>` in the studio header.

Zoom (fit / 100%) and page count sit alongside.

The preview iframe **cross-fades**: the previous frame stays mounted until the new one paints, removing the blank-frame flash the current code documents in a comment.

## 3. TriageDeck

Replaces `BulletReviewPanel`'s flat scroll. Occupies the canvas during Review.

- A real card stack: two peek cards behind at `scale .96` / `.92` with y-offset, conveying queue depth.
- Deciding animates the card out (take: slides right with a cobalt flash; keep: slides left and fades); the next card springs forward.
- Keyboard: `←` keep · `→` take · `R` rewrite · `H` humanize · `Backspace` undo · `Shift+Enter` take all remaining.
- `bulletImportance` renders as a colored left rail on the card (HIGH cobalt / MED muted / LOW hairline) instead of a corner badge.
- The tailored text is click-to-edit in place, wired to the existing `updatePendingBullet`.
- An undo affordance appears after each decision (`Kept your original. Undo`).
- A `see all` toggle flips the stage to a compact list of every change with its current decision. This is the skimming path and the home of **take all remaining**.

Summary and Skills enter the same queue as typed cards (`SummaryCard`, `SkillsCard`), replacing today's summary-above / bullets-middle / skills-below arrangement with one queue and one mental model.

### Why the current "Accept All" button is removed

Every changed bullet already defaults to `accept` in `runTailoring`'s `initialDecisions`, so the button is a no-op that renders as `All Bullets Accepted` — a control whose only function is to state an existing fact. The deck starts at the first change and makes each card a real decision; bulk acceptance becomes the explicit `take all remaining` action in the list view.

## 4. Motion

Library: `motion/react`.

| Surface | Technique |
|---|---|
| Spine connectors | `useSpring` → `scaleX` |
| ATS ring and number | motion value + `useTransform` count-up; `pathLength` stroke |
| Deck transitions | `AnimatePresence mode="popLayout"`; exit `x ±420`, `rotate ±6`; spring `{ stiffness: 380, damping: 32 }` |
| Stack promotion | `layout` on peek cards |
| Rail → canvas | `layoutId` shared element on the section heading |
| Completeness rings | `pathLength` spring |
| Preview swap | cross-fade, previous frame held until the new one paints |

`<MotionConfig reducedMotion="user">` is installed at the app provider, so every animation degrades for users with a reduced-motion preference.

## 5. Component structure

```
components/studio/
  StudioShell.tsx
  CommandBar.tsx
  spine/    StepSpine.tsx  StepNode.tsx  AtsRing.tsx
  rail/     SectionRail.tsx  SectionRow.tsx  CompletenessRing.tsx  BoostPanel.tsx
  canvas/   ContactSection.tsx  SummarySection.tsx  ExperienceSection.tsx
            EducationSection.tsx  SkillsSection.tsx  ExtrasSection.tsx
  review/   TriageDeck.tsx  ChangeCard.tsx  SummaryCard.tsx
            SkillsCard.tsx  DeckList.tsx
  preview/  PreviewDock.tsx  DockToolbar.tsx  TemplateGallery.tsx
            TypePopover.tsx  SpacingPopover.tsx
lib/
  studio-steps.ts            pure step derivation
  section-completeness.ts    pure completeness math
```

`lib/studio-steps.ts` and `lib/section-completeness.ts` are pure functions with no store or React dependency, and are unit tested under `__tests__`.

`components/resume/EditorPanel.tsx` (890 lines), `BulletReviewPanel.tsx` (1107 lines), `PreviewPanel.tsx` and `AtsGapFixPanel.tsx` are replaced by the above and deleted. `HumanizeSlider.tsx`, `ImportanceBadge.tsx`, `SkillsDelta.tsx` and `UnderfillWarning.tsx` are re-homed or absorbed as the new components require.

**Unchanged:** `stores/resume-store.ts`, `stores/tailoring-store.ts`, `lib/api-client.ts`, and every handler's existing call sequence. The redesign makes existing state visible; it does not alter it.

## 6. Controls removed

| Control | Location | Reason |
|---|---|---|
| `Preview up to date` | `PreviewPanel` | A button that is a status label; no action. |
| `Accept All` / `All Bullets Accepted` | `BulletReviewPanel` | No-op in the default state; replaced by `take all remaining`. |
| Second regenerate button | `PreviewPanel` | `handleGeneratePdf` and `handleRegenerateTailoredPreview` are one user intent split by mode; becomes one context-aware refresh. |
| `Download` | `BulletReviewPanel` | Duplicates the header's `Download PDF`; export lives in CommandBar only. |
| Pipe-character divider | `BulletReviewPanel` bullet actions | Literal text used as a separator. |
| `HumanizeSlider` | `TailoringForm` / manual-paste form | Two mental models for one knob; per-card Humanize is the single model. |
| `Expand to edit` collapse | `EditorPanel` header | The rail replaces collapse-based navigation. |
| Duplicate `Open` button | `/jd/[jdId]` | Two adjacent cards issue the same `router.push`. |

## 7. Responsive behavior

- **≥1280px:** full three-pane workbench.
- **1024–1279px:** rail collapses to an icon strip; dock narrows.
- **<1024px:** single column. The spine becomes a horizontally scrollable pill row with a compact score chip; the rail becomes a bottom sheet; the preview dock becomes a full-screen overlay opened from the CommandBar. The TriageDeck is full-width with the action row pinned to the bottom of the viewport.

## 8. Testing

- Unit tests for `studio-steps.ts` (every combination of store state maps to the correct node states, including locked) and `section-completeness.ts`.
- Component tests for `TriageDeck`: keyboard decisions, undo, take-all-remaining, and that each decision calls the existing `setBulletDecision` with the same arguments the current UI does.
- A regression check that the tailoring call sequence (`runTailoring` → `generatePreview` → `saveTailoredResume`) is unchanged.

## 9. Out of scope

Sidebar, dashboard, JD analyzer and interview center keep their current visual language. The only change outside the studio is removing the duplicate `Open` button on `/jd/[jdId]`.

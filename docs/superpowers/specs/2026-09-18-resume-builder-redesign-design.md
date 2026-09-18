# Resume Builder redesign — design

Replaces the studio workbench (merged `bd8faa0`, 2026-09-18) with a guided
section-based Builder and a separate full-page Resume Studio.

Decision on the collision: the workbench is a teammate's work and is being
replaced deliberately, not merged around. Its section editors and tailoring
review survive; its process spine, section rail and always-on preview dock do
not.

## Goals

The Builder should read as assembling a document, not filling a form. The
Studio should read as editing a finished document, not viewing a PDF.

Non-goal: rebuilding backend functionality. Every API, store, template and
export path stays as-is except where noted under *Template annotation*.

## Routing

Two routes over one state. A route group escapes the app chrome without
changing URLs, so `middleware.ts`'s `/studio` prefix still protects both.

```
app/(builder)/layout.tsx                          no Sidebar, no TopNav
app/(builder)/studio/[resumeId]/page.tsx          Builder
app/(builder)/studio/[resumeId]/preview/page.tsx  Studio
```

Both read `resume-store` and `tailoring-store` directly, so navigating between
them loses nothing and needs no new state system.

## Entry paths

Both paths render the same Builder. The difference is context, not layout.

- **Path A — JD Analyzer → Tailor → Builder.** `tailoring-store` already holds
  `jdId`, `jdText`, `atsScore`, `pendingContent`, `atsFixes`, `bulletRationale`.
  The context rail renders only when `jdId || jdText` is set.
- **Path B — Dashboard → Builder.** Same shell, single column, no rail.

`← Back` returns to `/jd/[jdId]` on Path A and `/studio` on Path B.

## Builder

```
BuilderShell
├── BuilderHeader      ← Back · title · autosave status (resume-store isDirty/isSaving)
├── SectionStepper     ✓ done · ● current · ○ upcoming — clickable, scrolls on mobile
├── SectionContent     exactly one section visible
└── BuilderNav         ← Previous · Continue → · Preview Resume → on the last step
```

Section state comes from `lib/section-completeness.ts`, which already defines
the six IDs (`contact | summary | experience | education | skills | extras`)
and a 0..1 fill ratio per section. That is the ✓/●/○ system; it is not rebuilt.

Navigation is free — the stepper is clickable in both directions and nothing is
locked. `SectionChain` gains a single-section mode rather than being replaced;
it already accepts `openSection`.

### Context rail (Path A only)

Mockup #4's right column: *Target JD Match* (missing keywords from
`tailoring-store.missingSkills`, importance badges from `jdImportance`) and a
static *Sheet Preview* thumbnail. The thumbnail is one render, not a live dock —
§11 removes the always-on preview.

## Studio

The document is the interface. Two tabs, because editing and verifying are
different jobs:

| Tab | Renders | Purpose |
|---|---|---|
| **Edit** | `_render_html` output, inline-editable | change copy in place |
| **Preview** | the WeasyPrint PDF | see exactly what exports |

```
ResumeStudio
├── StudioHeader   ← Back to Builder · Edit/Preview tabs · zoom · template · Export PDF
├── ResumeCanvas   the document, hero
└── (Edit tab)     inline editing, no side panels
```

Controls are the merged `preview/TemplateGallery`, `TypePopover` and
`SpacingPopover`, moved here. Export reuses `apiClient.generatePdf`.

### Why inline editing is possible without duplicate templates

`services/pdf.py::_render_html` already returns the complete HTML string and
`generate_pdf` feeds it to WeasyPrint separately. Exposing that step gives the
browser a document that is *by construction* what will be exported — there is
no second React copy of the templates to drift.

New endpoint, mirroring `POST /resumes/{id}/pdf`'s request shape:

```
POST /resumes/{id}/html  ->  { html: str }
```

Same auth, same ownership check, same `PdfGenerateRequest` body (content
override, template, spacing, font, accent). It calls `_render_html` and returns
the string. No new rendering logic.

### Mapping a DOM edit back to the model

The rendered HTML has no idea which model field produced a given node. The five
Jinja templates gain `data-field` attributes on editable text:

```jinja
<td class="btxt" data-field="experience.{{ loop.index0 }}.bullets.{{ bloop.index0 }}">
```

A `contenteditable` region's `data-field` is parsed into a path and written
through `resume-store`'s existing setters, which already autosave. This is the
only change to existing templates, and it is additive — WeasyPrint ignores
unknown attributes, so PDF output is unchanged.

### Isolation and safety

The rendered document carries its own `<style>` including `@page` rules, so it
mounts in a **shadow root** to keep those from leaking into the app's CSS.

The HTML is our own template output, and `pdf.py` already HTML-escapes every
user-supplied value (`_highlight_keywords`, `_email_link`, `_url_link` all
return escaped `Markup`). Injecting it is therefore not an injection sink —
but the endpoint must never echo caller-supplied HTML, only render through the
templates.

## Disposition of the merged workbench

| Merged | Fate |
|---|---|
| `canvas/{Contact,Summary,Experience,Education,Skills,Extras}Section` | keep |
| `lib/section-completeness.ts` | keep |
| `review/{BulletDiff,FactLockNotice,BulletRationaleLine,ChangeCard,TriageDeck,SkillsCard,SummaryCard,DeckList}` | keep — §22 tailoring review |
| `preview/{PreviewDock,TemplateGallery,TypePopover,SpacingPopover,DockToolbar}` | move into Studio; dock's always-on behaviour dropped |
| `canvas/SectionChain` | extend with single-section mode |
| `canvas/SourcePanel` | keep — Path B's JD paste entry |
| `spine/*`, `lib/studio-steps.ts` | delete — process spine replaced by section stepper |
| `rail/{SectionRail,SectionRow,BoostPanel}` | delete — replaced by stepper + context rail |
| `StudioShell`, `CommandBar` | delete — replaced by `BuilderShell` |

## Preserved (§18)

Untouched: `resume-store` autosave, `tailoring-store`, Supabase auth and
storage, the five templates' output, `apiClient.generatePdf`, photo handling
and `PhotoRequirementModal`, `bullet_guard` fact-lock, accept/reject/regenerate,
career profile, validation, every existing API route.

## Testing

- `section-completeness` and any new path-parsing helper: unit tests, pure.
- `SectionStepper`: state per section, clickable both ways.
- `BuilderNav`: first/last step affordances.
- Inline edit: `data-field` path → store write, including a malformed path.
- The four component test files deleted with the workbench are not restored —
  their components are gone — but the behaviours they covered (diff rendering,
  fact-lock notice, rationale line, score display) get tests against the
  surviving `review/*` components, which currently have none.

## Risks

1. **Inline editing is the largest unknown.** Contenteditable over
   template-rendered HTML is feasible but fiddly: caret handling, paste
   sanitisation, and list/bullet structure. The Edit/Preview tab split contains
   the risk — if inline proves unworkable for a section, that section falls
   back to its Builder editor without blocking the rest.
2. **Template annotation touches PDF output files.** Additive only, but
   `test_pdf_ats_text_order.py` and friends must stay green — the memory note
   on this repo is explicit that layout changes need render+extract testing
   with short content.
3. **Replacing a teammate's merged work.** Authorised, but the spec and plan
   they wrote (`docs/superpowers/{specs,plans}/2026-09-18-studio-*`) should be
   left in place as the record of why that shape existed.

## Phases

1. Spec + plan (this document, then the implementation plan)
2. Builder shell, stepper, single-section mode, navigation
3. Studio route, Edit/Preview tabs, `/html` endpoint, template annotation
4. Inline editing and store write-back
5. Wire both entry paths; delete the superseded workbench pieces
6. Polish: spacing, responsive, empty/loading/error states, keyboard

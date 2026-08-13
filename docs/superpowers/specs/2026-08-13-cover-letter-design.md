# Cover Letter generation

## Problem

Career Copilot generates and tailors resumes and preps interview
questions per JD, but there's no way to generate a cover letter. Users
have to write one from scratch outside the app, disconnected from the
resume/JD context the app already has.

## Scope

Add AI-generated, editable, downloadable cover letters, tied to a
resume + JD pair — either reusing an existing tailoring session's
content, or generated standalone.

- Generation reuses the cached JD analysis (`analyze_jd_match`'s
  `JDAnalysis`) and — when a tailoring session is linked — that
  session's tailored resume content, so the letter references the same
  accomplishments the resume highlights. Standalone generation (no
  session) uses the resume's saved content as-is.
- Output is a single block of prose the user can freely rewrite (same
  editing model as the resume's Summary field) — no paragraph-level
  regenerate in v1.
- A humanize/formality slider (reusing the existing `HumanizeSlider`
  component and `humanize_level` pattern) controls tone; a Regenerate
  action re-runs generation with the current resume/JD/level.
- Output: downloadable PDF (new letterhead-style template) and a
  copy-to-clipboard action for pasting into job-portal text fields.
- Surfaced in three places: a new `/cover-letters` page (list +
  standalone create), a "Generate Cover Letter" entry point from the JD
  detail page once a tailoring session exists, and a third row —
  alongside Resume and Interview Practice — in the JD detail page's
  "Generated for This JD" card.
- Sidebar nav entry and placeholder page already shipped
  (`apps/web/components/layout/Sidebar.tsx`,
  `apps/web/app/(app)/cover-letters/page.tsx`) — this spec replaces the
  placeholder with the real feature.

Out of scope for v1: paragraph-level regeneration, multiple saved
drafts/versions per JD, letter templates beyond one layout.

## Data model

New table `cover_letters` (`apps/api/app/db/models.py`), mirroring
`TailoringSession`:

```python
class CoverLetter(Base):
    __tablename__ = "cover_letters"

    id: Mapped[uuid.UUID]
    user_id: Mapped[uuid.UUID]  # indexed, no FK constraint (matches JobDescription/Resume)
    resume_id: Mapped[uuid.UUID]  # FK -> resumes.id, CASCADE
    jd_id: Mapped[uuid.UUID]  # FK -> job_descriptions.id, CASCADE
    tailoring_session_id: Mapped[uuid.UUID | None]  # FK -> tailoring_sessions.id, CASCADE, nullable
    content: Mapped[str | None]  # Text — the letter body
    humanize_level: Mapped[int]  # default 50
    pdf_url: Mapped[str | None]
    status: Mapped[str]  # "pending" / "completed" / "failed", default "pending"
    created_at: Mapped[datetime]
```

`tailoring_session_id` nullable + `ondelete="CASCADE"` — if the linked
session is deleted, the letter goes with it (same as how `PrepQuestion`
cascades off `TailoringSession`). Standalone letters (no session) only
cascade off `resume_id`/`jd_id`.

Alembic migration for the new table.

## Backend

New service function in `apps/api/app/services/tailoring.py`: a
"letter writer" agent (structured Pydantic output, single `body: str`
field — one prose block, not paragraph-split) that takes the cached
`JDAnalysis`, resume content, and `humanize_level`, and returns the
letter body. Prompt: opening paragraph naming the role, 1-2 body
paragraphs mapping specific resume achievements to JD requirements
(pulling from `matched_skills`/JD analysis themes, not inventing
experience — same FACT LOCK constraint Agent 3 already follows), a
closing paragraph. No salutation/company address block generation —
those are boilerplate the user fills in themselves in the free-text
editor (keeps the writer prompt focused, avoids fabricating a hiring
manager's name).

New router `apps/api/app/routers/cover_letters.py` (prefix
`/cover-letters`), following `jd.py`/`resumes.py` conventions
(`get_current_user`, `user_id` ownership filtering,
`@limiter.limit(...)` on the generate endpoint):

- `POST /cover-letters/generate` — body: `resume_id`, `jd_id`,
  `tailoring_session_id?`, `humanize_level`. Creates a `pending` row,
  kicks off generation as a background task (same
  `_run_tailoring_background`-style pattern as `POST /ai/tailor`, since
  this is a real LLM call that can exceed a single request's timeout).
  Returns `{cover_letter_id, status}` immediately.
- `GET /cover-letters/{id}` — poll target; returns status + content
  once completed.
- `GET /cover-letters` — list for the current user (for the
  `/cover-letters` page).
- `GET /jd/{jd_id}/cover-letter` — latest completed cover letter for a
  JD (mirrors `GET /jd/{jd_id}/latest-session`), used by the JD detail
  page's "Generated for This JD" card.
- `PATCH /cover-letters/{id}` — save edited `content`.
- `POST /cover-letters/{id}/pdf` — render + upload PDF (thin wrapper
  around the existing `pdf.py` plumbing with a new template), returns
  `pdf_url`.
- `DELETE /cover-letters/{id}`.

New PDF template `apps/api/templates/cover_letter.html` — prose layout
(header block reusing the contact info already in `resume_content`,
date, body paragraphs, signoff) — reuses the existing Jinja env,
WeasyPrint render call, and Supabase upload path in `pdf.py`, not a
rewrite of that pipeline.

## Frontend

New Zustand store `apps/web/stores/cover-letter-store.ts`, mirroring
`tailoring-store.ts`'s shape: `coverLetterId`, `content`,
`humanizeLevel`, `status`, `isGenerating`, `error`; `generate()`
(POST + poll, same loop pattern as `runTailoring`), `updateContent()`
(debounced autosave, same pattern as `resume-store.ts`'s
`_triggerAutoSave`), `regenerate()`.

New `apiClient` methods (`apps/web/lib/api-client.ts`):
`generateCoverLetter`, `getCoverLetter`, `getCoverLetters`,
`getJdCoverLetter`, `updateCoverLetter`, `generateCoverLetterPdf`,
`deleteCoverLetter`.

`apps/web/app/(app)/cover-letters/page.tsx` replaces the placeholder:
list of previously generated letters (same card-grid pattern as the JD
Analyzer's "Previous Analyses") + a "New Cover Letter" flow (pick a
resume and a JD from existing lists — same selectors already used
elsewhere, e.g. the JD page's resume-override picker).

`apps/web/app/(app)/cover-letters/[id]/page.tsx` — the editor: textarea
bound to `content` (same free-edit + debounced autosave model as the
Summary tab), `HumanizeSlider` control, Regenerate / Download PDF /
Copy Text / Save actions.

`apps/web/app/(app)/jd/[jdId]/page.tsx` — "Generated for This JD" card
gets a third row (Cover Letter), fetched via a `useQuery` on
`getJdCoverLetter(jdId)`, following the same pattern as the existing
Resume/Interview Practice rows: shows title/date if one exists with an
Open link into `/cover-letters/{id}`, or a "Generate" button if not.

## Error handling

Same patterns already established for tailoring: background generation
failure sets `status: "failed"`, surfaced as an error message rather
than failing silently (per the earlier tailoring-failure fix); PDF
generation errors surfaced the same way `handleExportPdf` does on the
resume Studio page; polling has the same bounded-attempts + transient-
failure-tolerance loop as `runTailoring`.

## Testing

- Backend: router tests for `cover_letters.py` following the
  `test_jd_and_tailor_endpoints.py` MagicMock-DB pattern (generate,
  get, list, jd-scoped lookup, ownership checks); a unit test for the
  letter-writer prompt/schema following `test_tailoring.py`'s
  `make_provider_dispatching_by_schema` pattern.
- Frontend: `cover-letter-store.ts` tests mirroring
  `tailoring-store.test.ts`'s generate/poll/save coverage; a page test
  for the JD detail page's new Cover Letter row (same shape as the
  existing `jd-detail-page.test.tsx`).

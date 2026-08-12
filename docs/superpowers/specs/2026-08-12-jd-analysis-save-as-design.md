# JD Analyzer: explicit "Save As" naming with replace confirmation

## Problem

Clicking "Analyze Description" saves the JD under an auto-derived title
(the first line of the pasted text, truncated) with no chance to name it
or notice a naming collision. Renaming only happens after the fact, from
the Previous Analyses list.

## Scope

Add a file-manager-style "Save As" step to the JD Analyzer's primary
"Analyze Description" flow only:

- A new analysis prompts for a name before saving, pre-filled with
  today's auto-derived default.
- If the name collides (case-insensitive, trimmed) with an existing saved
  analysis, ask to replace it or go back and pick a different name.
- Replacing deletes the old entry (and, via existing FK cascade, any
  tailoring sessions built on it) and saves the new one under that name.
- **Reanalyze** (rerunning an existing entry from the list) is unaffected
  — no prompt, since it isn't a new save.
- The existing content-dedup behavior in `POST /jd` (added for the ATS
  determinism fix — identical `raw_text` reuses the existing row
  regardless of requested title) is left as-is: pasting text that exactly
  matches an already-saved JD reuses that entry silently, even if a
  different name was typed for it. Not solved here; user can rename
  afterward via the existing rename UI if they want.

## Frontend

New component `apps/web/components/jd/SaveAnalysisModal.tsx`:
- Two-step modal (`"name" | "confirm-replace"`), mirrors the existing
  centered-card-with-backdrop pattern used by `ResumePreviewModal`.
- Step `name`: text input pre-filled with the caller-supplied default
  name, Save / Cancel.
- On Save: caller checks the trimmed/lowercased name against existing JD
  titles. No match → resolves immediately. Match → step switches to
  `confirm-replace`, showing the matched title and an explicit note that
  replacing removes that entry's tailoring history too. Replace / Cancel
  (Cancel returns to the `name` step, not closing the whole modal).

`apps/web/app/(app)/jd/page.tsx` changes:
- `handleSubmit` no longer calls `createJd` directly. It computes the
  default name (today's first-line logic) and opens
  `SaveAnalysisModal`, stashing the pending `jdText`.
- Modal's confirm callback: if replacing, `apiClient.deleteJd(existingId)`
  first; then `apiClient.createJd({ title: chosenName, raw_text: jdText })`,
  `setJd(jd.id, jdText)`, `runAnalysis(activeResumeId)`, and invalidate the
  `["jds"]` query. Modal-cancel aborts entirely — no request is made,
  same as today's "back out of analyzing" behavior.
- `handleRerunAnalysis` is untouched.

No backend changes — `POST /jd` (title override) and `DELETE /jd/{id}`
already cover everything this needs.

## Testing

- Frontend: a small test for `SaveAnalysisModal` covering the two-step
  flow (no-conflict save, conflict → replace, conflict → cancel returns
  to naming).
- Manual: verify Reanalyze still has no prompt, and that replacing an
  entry actually removes its old tailoring sessions (cascade).

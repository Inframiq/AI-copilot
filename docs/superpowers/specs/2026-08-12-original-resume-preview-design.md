# Original resume as master copy: PDF-only upload, untouched preview

## Problem

Uploading a resume in Profile runs it through AI parsing and the parsed,
structured result is what gets shown back — in Preview (rendered through an
app template) and in the Profile form (auto-saved immediately). Two issues:

1. Preview never shows the file the user actually uploaded — different
   layout, dropped custom sections, reads like an AI-generated resume rather
   than their real one.
2. The Profile form auto-fills from the parse and persists immediately,
   overwriting the saved career profile before the user has reviewed it.

The uploaded file is the user's master copy and must never be altered or
silently overwritten without review.

## Scope

- Restrict resume upload to PDF only (DOCX/DOC dropped — no server-side
  conversion; the user converts before uploading).
- Store the original uploaded PDF bytes untouched in Supabase Storage.
- Preview renders the original file directly, not a re-templated version,
  for any resume that has one.
- Profile form no longer auto-saves on upload; it autosaves when the user
  navigates away from the page, only if currently valid.
- AI parsing into structured `content` is unchanged — still runs on upload,
  still powers Studio editing, ATS scoring, and tailoring.

## Data model

Add to `Resume` (`apps/api/app/db/models.py`):
- `original_file_path: str | None` (Text) — Supabase Storage path,
  `resumes/{user_id}/{resume_id}/original.pdf`.
- `original_file_name: str | None` (String) — original filename, for display.

Alembic migration adds both columns, nullable, no backfill (existing resumes
built in Studio have no original file and keep the template preview).

## Backend changes (`apps/api/app/routers/resumes.py`)

- `_ALLOWED_MIME` / extension check in `/resumes/parse-upload` narrows to
  `application/pdf` / `.pdf` only. Reject `.docx`/`.doc` with 400: "Only PDF
  files are supported. Convert your resume to PDF and re-upload."
- After the existing magic-byte check and before AI parsing, upload
  `raw_bytes` synchronously to `resumes/{user_id}/{resume_id}/original.pdf`
  (upsert). Unlike the best-effort background upload used for generated
  preview PDFs (`_persist_pdf_to_storage`), this is on the request path — if
  it fails, the whole upload fails with a 502 rather than silently losing
  the master copy while still creating a Resume row.
- Persist `original_file_path` / `original_file_name` on the Resume row
  (both the create and the "Replace existing resume" branch).
- New endpoint `GET /resumes/{id}/original` → `{signed_url, file_name}` when
  `original_file_path` is set, 404 otherwise. Same ownership check pattern
  as the other `/resumes/{id}` routes.

Parsing (`parse_resume_text`) and its "keep bullet text verbatim" prompt are
unchanged — `content` still exists to power Studio/tailoring.

## Frontend changes

`apps/web/lib/api-client.ts`:
- `parseResumeFile` accept list narrows to PDF (already enforced
  server-side; client-side check kept in sync so the error surfaces before
  a network round-trip).
- New `getOriginalResumeFile(id)` → calls `GET /resumes/{id}/original`.

`apps/web/app/(app)/profile/page.tsx`:
- File input `accept=".pdf"`, `acceptFile` validation restricted to
  `.pdf`, upload zone copy updated ("PDF only").
- `handleUpload` keeps creating/replacing the Resume row and populating
  form state (contact, experience, education, etc.) but drops the
  immediate `upsertCareerProfile` call.
- New effect: on unmount / route change, call the existing `handleSave()`
  if the form is currently valid (same validity the manual Save button
  already implies). Covers in-app navigation only — not closing the tab
  outright, since a reliable synchronous save on `beforeunload` isn't
  achievable with an async fetch.

`apps/web/components/resume/ResumePreviewModal.tsx`:
- If the resume has `original_file_path`, fetch its signed URL via
  `getOriginalResumeFile` and render that in the iframe instead of calling
  `generatePdf`.
- Resumes without an original file (built from scratch in Studio) keep
  today's template-rendered preview — that already is the user's real
  content.

## Error handling

- Non-PDF upload → 400 from the existing validation path, client shows the
  message inline (already wired via `setError`).
- Original-file storage upload failure → 502, upload fails fast (no Resume
  row left pointing at a missing master file).
- `GET /resumes/{id}/original` on a resume with no original file → 404;
  `ResumePreviewModal` falls back to the template preview path in that case
  rather than erroring.

## Testing

- Backend (`test_resumes_more.py`): `.docx` upload rejected with 400;
  uploaded PDF round-trips byte-for-byte through
  `GET /resumes/{id}/original`; "Replace" overwrites the same storage path
  and the new file's bytes are what comes back afterward.
- Frontend (`api-client.test.ts`): new case for `getOriginalResumeFile`.
- Manual: Profile page autosave-on-navigate-away when valid, and Preview
  modal showing the exact uploaded PDF unchanged.

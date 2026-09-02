# Resume Builder — conditional profile-photo flow

## Problem

The Resume Builder's contact tab shows an **always-visible "Profile Photo"
upload field** (`EditorPanel.tsx`), regardless of whether the selected
template has a photo slot. Three problems:

1. **Photo management is duplicated / misplaced.** The upload lives in the
   Resume Builder, not in "My Profile" — even though My Profile is the
   stated source of truth for the user's career data (contact, headline,
   experience, …). There is no profile photo field in My Profile at all.
2. **The field is noise for most templates.** Only `ats_professional` and
   `ats_sidebar` render a photo. For the other three templates the upload
   field does nothing useful but still occupies the contact tab.
3. **No reuse.** Each resume's photo is uploaded and stored per-resume
   (`avatars/${userId}/${resumeId}.ext`). A user with five resumes uploads
   the same headshot five times; there is no "default" photo.

The user's ask: move photo *management* into My Profile, persist it in
Supabase Storage against the profile, and have the Resume Builder only
**prompt** for a photo when the chosen template actually needs one —
offering the profile photo first, with an option to use a different image
for that one resume without overwriting the profile default.

## Scope

**In scope:**

- New **Profile Photo** field in My Profile (`profile/page.tsx`), stored in
  Supabase Storage and persisted on `career_profiles` via two new columns.
- One migration: `005_career_profile_photo.sql`.
- `lib/photo-upload.ts` — add `uploadProfilePhoto`, keep `uploadResumePhoto`,
  share validation.
- `lib/resume-templates.ts` — declarative `photo` descriptor per template +
  a `templateRequiresPhoto(id)` helper.
- `career-profile-client.ts` — `photo_url` / `photo_path` on `CareerProfile`
  and `CareerProfileInput`.
- A `<PhotoRequirementModal>` in the Resume Builder that fires on template
  selection and walks Case A / Case B / cancel.
- Remove the always-on photo field from `EditorPanel.tsx`; replace with a
  compact read-only photo row shown **only** while a photo template is
  active.
- Per-template `.photo` CSS in `ats_professional.html` / `ats_sidebar.html`
  keeps `object-fit: cover` + explicit box + `border-radius` (shape).

**Out of scope:**

- No image re-encoding / server-side cropping (Pillow) — CSS `object-fit:
  cover` does the shaping with no distortion.
- No interactive crop/zoom widget.
- No new template shapes shipped: `ats_professional` and `ats_sidebar` stay
  **square** (`border-radius: 4px`, as today). The `shape` descriptor makes
  `portrait` / `circle` a one-line change later but nothing uses them yet.
- The studio landing template picker (`studio/page.tsx`) is unchanged —
  it already excludes `ats_sidebar`; `ats_professional` stays in it and the
  prompt handles the photo requirement once the editor opens.
- `resumeContentToCareerProfileInput` does not try to extract a photo from
  an uploaded PDF — profile photo is only ever set explicitly.
- Cover-letter flow untouched.
- No deletion of the Storage object on "Remove" (the key is reused / later
  overwritten) — only the DB columns / `content.contact.photo_url` clear.

## Data model

### `career_profiles` — two new columns

`apps/web/supabase/migrations/005_career_profile_photo.sql`:

```sql
ALTER TABLE career_profiles
  ADD COLUMN IF NOT EXISTS photo_url  text,
  ADD COLUMN IF NOT EXISTS photo_path text;
```

- `photo_url` — public URL of the profile photo in the `avatars` bucket.
  `null` = no profile photo.
- `photo_path` — the Storage object key (`${userId}/profile.<ext>`). Kept
  so a later "Replace" / "Remove" knows the exact object without
  re-deriving the extension. `null` when `photo_url` is `null`.
- Existing rows: both default `NULL`. No backfill.
- RLS unchanged — the existing `career_profiles_own` policy already covers
  the new columns.

### `CareerProfile` / `CareerProfileInput` (`career-profile-client.ts`)

```ts
export interface CareerProfile {
  // …existing…
  photo_url: string | null;
  photo_path: string | null;
}
```

`CareerProfileInput` is `Omit<CareerProfile, "user_id" | "created_at" |
"updated_at">`, so it picks up both fields automatically.
`upsertCareerProfile` passes them straight through in its `upsert({...})`
payload. `handleSave` in `profile/page.tsx` adds `photo_url` / `photo_path`
to the `CareerProfileInput` it builds.

### Two distinct photo values

| | Profile Photo | Resume-specific photo |
|---|---|---|
| Stored at | `career_profiles.photo_url` / `photo_path` | `resume.content.contact.photo_url` |
| Storage key | `avatars/${userId}/profile.<ext>` | `avatars/${userId}/${resumeId}.<ext>` |
| Set from | My Profile only | "Upload a Different Photo" in the modal |
| Lifetime | reused across all resumes | that one resume |
| Overwrites the other? | never (except via the explicit "also save to my profile" checkbox) | never |

`resume.content.contact.photo_url` is the **only** value the PDF templates
read. "Use Profile Photo" copies `profile.photo_url` into it. The profile
value is never read directly at render time.

## Storage — `lib/photo-upload.ts`

Refactor to share validation, add the profile path:

```ts
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

function assertValidPhoto(file: File) {
  if (!ALLOWED_TYPES.includes(file.type)) throw new Error("Photo must be a JPEG, PNG, or WebP image.");
  if (file.size > MAX_PHOTO_BYTES) throw new Error("Photo must be smaller than 5MB.");
}

async function uploadToAvatars(path: string, file: File): Promise<string> {
  const supabase = createBrowserClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase.storage.from("avatars").upload(path, file, {
    upsert: true, contentType: file.type,
  });
  if (error) throw error;
  return supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}

/** Resume-specific photo — keyed by resumeId (unchanged behaviour). */
export async function uploadResumePhoto(resumeId: string, file: File): Promise<string> {
  assertValidPhoto(file);
  const { data: { user } } = await createBrowserClient().auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  return uploadToAvatars(`${user.id}/${resumeId}.${ext}`, file);
}

/** Profile default photo — keyed as "<uid>/profile.<ext>". Returns
 *  { url, path } so the caller can persist both onto career_profiles. */
export async function uploadProfilePhoto(file: File): Promise<{ url: string; path: string }> {
  assertValidPhoto(file);
  const { data: { user } } = await createBrowserClient().auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${user.id}/profile.${ext}`;
  const url = await uploadToAvatars(path, file);
  return { url, path };
}
```

`getUser()` is called twice in each exported fn (once in the wrapper) —
acceptable; the SSR client caches the session. If it grates, thread `user`
through `uploadToAvatars` as a param instead.

Bucket `avatars` must already exist and be public — it does (used today by
`uploadResumePhoto`). No storage-policy change.

## Template descriptor — `lib/resume-templates.ts`

```ts
export type PhotoShape = "square" | "portrait" | "circle";

export const RESUME_TEMPLATES = [
  { id: "ats_clean",        label: "ATS Clean",    description: "…" },
  { id: "ats_modern",       label: "ATS Modern",   description: "…" },
  { id: "ats_sidebar",      label: "Sidebar",      description: "…", photo: { shape: "square" as PhotoShape } },
  { id: "ats_professional", label: "Professional", description: "…", photo: { shape: "square" as PhotoShape } },
  { id: "ats_minimal",      label: "Minimal",      description: "…" },
] as const;

export function templateRequiresPhoto(id: string): boolean {
  return !!RESUME_TEMPLATES.find((t) => t.id === id)?.photo;
}
```

This is the single web-side source of truth for "does this template need a
photo". The API already gates rendering with `{% if contact.photo_url %}`,
so no descriptor needs to cross to Python. The `shape` value is currently
informational on the web side (future thumbnails / copy); each PDF template
encodes its own shape in CSS directly.

## The conditional prompt — `<PhotoRequirementModal>`

New component: `apps/web/components/resume/PhotoRequirementModal.tsx`.
Mounted in `apps/web/app/(app)/studio/[resumeId]/page.tsx`.

### Trigger

In the studio editor page, watch `templateId` (from `useResumeStore`):

```
when templateId changes:
  if templateRequiresPhoto(templateId)
     && !content?.contact.photo_url
     && !modalDismissedForThisTemplate:
        open modal, remember previousTemplateId
```

- If the resume **already** has `content.contact.photo_url`, no prompt —
  switching to a photo template just works, silently.
- Switching **away** to a non-photo template closes the modal if open, with
  no revert (the user chose the non-photo template deliberately).
- `previousTemplateId` is the last template that was **not** blocked by an
  open prompt — used by Cancel to revert.

The studio page loads the career profile once for the modal:

```ts
const { data: profile } = useQuery({
  queryKey: ["careerProfile"],
  queryFn: getCareerProfile,
});
```

(`["careerProfile"]` is already the key `profile/page.tsx` invalidates on
save, so this stays fresh.)

### Case A — `profile?.photo_url` is set

> **This template requires a profile photo.**
> We found a photo in your profile. Would you like to use this photo or
> upload a different one?

Shows the profile photo thumbnail. Actions:

- **Use Profile Photo** —
  `updateContent({ contact: { ...content.contact, photo_url: profile.photo_url } })`,
  close. (`updateContent` already debounce-saves via the resume store.)
- **Upload a Different Photo** — reveals a file input + a checkbox
  **"Also set this as my profile photo"** (default **unchecked**). On file
  pick:
  - `url = await uploadResumePhoto(resumeId, file)`
  - `updateContent({ contact: { ...content.contact, photo_url: url } })`
  - if checkbox checked: `const { url: purl, path } = await uploadProfilePhoto(file)`
    then `upsertCareerProfile({ ...profileInput, photo_url: purl, photo_path: path })`
    and `queryClient.invalidateQueries({ queryKey: ["careerProfile"] })`.
  - close.
- **Cancel** — revert `setTemplateId(previousTemplateId)`, close, mark this
  template dismissed until the resume gains a photo some other way.

### Case B — no `profile?.photo_url`

> **This template requires a profile photo.**
> You don't have a profile photo yet. Please upload one to continue.

Actions:

- **Upload Photo** — file input + checkbox **"Also save to my profile"**,
  default **checked** (the user has no profile photo, so saving it is
  almost always what they want). Same upload logic as Case A's
  "Upload a Different Photo" branch.
- **Open My Profile** — `router.push("/profile")`. The resume's photo state
  is untouched; the modal closes and the template stays selected but
  photo-less (the read-only row in the editor, below, will still say
  "photo required"). Re-entering a photo template later re-triggers the
  prompt since `content.contact.photo_url` is still empty.
- **Cancel** — revert to `previousTemplateId`, close.

### Image validation / errors

All upload errors (`assertValidPhoto` throws, storage failure) render
inline in the modal in `text-error`, matching the current `photoError`
treatment. The modal stays open.

## Remove the always-on field — `EditorPanel.tsx`

Delete:
- the `Profile Photo` block in the contact tab (~lines 238–266),
- `handlePhotoChange`, `isUploadingPhoto`, `photoError` state,
- the `uploadResumePhoto` import (moves to the modal).

Add, in the contact tab, **rendered only when
`templateRequiresPhoto(templateId)`**, a compact read-only row:

- If `content.contact.photo_url`: thumbnail + **Change photo** (re-opens
  the modal via shared state — see below) + **Remove photo**
  (`updateContent({ contact: { ...content.contact, photo_url: undefined } })`).
- If not: a short "This template needs a profile photo — choose one"
  line + a **Choose photo** button that opens the modal.

### Sharing modal open-state between the page and EditorPanel

The modal lives on the studio page. EditorPanel needs to open it too
("Change photo" / "Choose photo"). Options, cheapest first:

1. **Zustand flag on `resume-store`**: `photoModalOpen: boolean`,
   `setPhotoModalOpen(v)`. EditorPanel calls `setPhotoModalOpen(true)`;
   the studio page renders `<PhotoRequirementModal>` when
   `photoModalOpen || autoTriggered`. Chosen — one field, no prop
   drilling, consistent with how the rest of the editor shares state.

The auto-trigger effect also flips this flag, so there is a single
`open` source.

## Image formatting — PDF templates

`apps/api/templates/ats_professional.html` and `ats_sidebar.html`:

```css
.photo {
  width: 76px; height: 76px;   /* portrait would be e.g. 76 x 100 */
  object-fit: cover;           /* fill the box, crop overflow, no stretch */
  border-radius: 4px;          /* 50% => circle */
  flex-shrink: 0;
}
```

This is essentially the current CSS — the spec's requirement ("scale/crop
to the template, preserve aspect ratio, don't distort, support
square/portrait/circular") is met by `object-fit: cover` on a fixed box.
No code change is strictly required here beyond confirming both templates
use `cover` (they do). Documented so the plan verifies it and so the
`shape` descriptor's meaning is written down.

`pdf.py`'s `photo_url` host-sanitization is unchanged and still applies —
both the profile-derived URL and the resume-specific URL are public
`avatars` URLs on the trusted Supabase host.

## Data flow (Case B, "also save" checked)

```
User picks "Sidebar" template
  studio page effect: templateRequiresPhoto("ats_sidebar") && no content photo
    -> resume-store.setPhotoModalOpen(true), previousTemplateId = "ats_clean"
Modal (Case B): "Upload Photo", checkbox checked
  file pick:
    uploadResumePhoto(resumeId, file)      -> avatars/<uid>/<resumeId>.jpg  -> url R
    updateContent({ contact: { ..., photo_url: R } })   -> debounced PATCH /resumes/:id
    uploadProfilePhoto(file)               -> avatars/<uid>/profile.jpg     -> url P, path
    upsertCareerProfile({ ...form, photo_url: P, photo_path })  -> career_profiles row
    queryClient.invalidateQueries(["careerProfile"])
  close modal
Preview / Export:
  PreviewPanel -> apiClient.generatePdf(resumeId, "ats_sidebar", …)
  pdf.py: content.contact.photo_url = R (host-checked) -> <img class="photo" src="R">
  WeasyPrint: .photo { 80x80, object-fit: cover, border-radius: 4px }
```

## Testing

New / updated tests (Vitest, `apps/web/__tests__`):

- **`photo-upload.test.ts`** (new) — `assertValidPhoto` rejects wrong
  MIME + oversize; `uploadProfilePhoto` builds key `<uid>/profile.<ext>`
  and returns `{ url, path }`; `uploadResumePhoto` still builds
  `<uid>/<resumeId>.<ext>`. Supabase client mocked.
- **`resume-templates.test.ts`** (new) — `templateRequiresPhoto` is `true`
  for `ats_sidebar` / `ats_professional`, `false` for the other three.
- **`PhotoRequirementModal.test.tsx`** (new) —
  - Case A: renders "Use Profile Photo"; clicking it calls `updateContent`
    with the profile URL and closes.
  - Case A: "Upload a Different Photo" + checkbox off → only
    `uploadResumePhoto` + `updateContent`; profile upsert not called.
  - Case A: checkbox on → `uploadProfilePhoto` + `upsertCareerProfile`
    also called.
  - Case B: no profile photo → Case B copy; checkbox defaults checked;
    "Open My Profile" pushes `/profile`.
  - Cancel reverts `setTemplateId` to `previousTemplateId`.
- **`EditorPanel.test.tsx`** (update) — non-photo template: no photo row in
  contact tab. Photo template + no photo: "Choose photo" opens modal
  (`setPhotoModalOpen(true)`). Photo template + photo: thumbnail + Remove
  clears `content.contact.photo_url`.
- **Profile page** — if there is an existing `profile/page.tsx` test,
  add: upload calls `uploadProfilePhoto`, sets form state, and `handleSave`
  includes `photo_url` / `photo_path` in the `upsertCareerProfile` payload.
  (If no such test exists, add a focused one for the photo card only.)

Manual QA checklist:

1. My Profile → upload photo → Save → reload → photo persists.
2. New resume, `ats_clean` → contact tab has **no** photo UI.
3. Switch to `Sidebar` with a profile photo set → modal Case A → "Use
   Profile Photo" → preview shows it, profile photo unchanged.
4. Switch to `Sidebar` with no profile photo → modal Case B → upload with
   "also save" checked → My Profile now shows that photo.
5. Case A → "Upload a Different Photo", checkbox off → resume shows new
   photo, My Profile still shows the original.
6. Cancel on the modal → template reverts to the previous one.
7. `ats_professional` (square) and `ats_sidebar` (square) both render the
   photo un-stretched for a wide and a tall source image.

## Migration / rollout

- Run `005_career_profile_photo.sql` in the Supabase SQL editor (same
  process as migrations `001`–`004`; there is no automated runner).
- No data backfill. Existing resumes with a per-resume
  `content.contact.photo_url` keep working unchanged — that value is still
  what the templates read.
- Deploy web + (trivial) template CSS confirmation together. No API code
  change is required; if the template files are already `cover`, the API
  deploy is a no-op.

## Files touched

| File | Change |
|---|---|
| `apps/web/supabase/migrations/005_career_profile_photo.sql` | **new** — two columns |
| `apps/web/lib/photo-upload.ts` | add `uploadProfilePhoto`, share validation |
| `apps/web/lib/resume-templates.ts` | `photo` descriptor + `templateRequiresPhoto` |
| `apps/web/lib/career-profile-client.ts` | `photo_url` / `photo_path` on types + upsert |
| `apps/web/app/(app)/profile/page.tsx` | Profile Photo card + save wiring |
| `apps/web/components/resume/PhotoRequirementModal.tsx` | **new** — the prompt |
| `apps/web/app/(app)/studio/[resumeId]/page.tsx` | mount modal, auto-trigger effect, profile query |
| `apps/web/components/resume/EditorPanel.tsx` | remove always-on field; conditional read-only row |
| `apps/web/stores/resume-store.ts` | `photoModalOpen` + setter |
| `apps/api/templates/ats_professional.html`, `ats_sidebar.html` | confirm/adjust `.photo` CSS |
| `apps/web/__tests__/*` | new + updated tests per above |

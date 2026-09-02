# Resume Builder Conditional Profile-Photo Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move profile-photo management into "My Profile" (Supabase Storage + `career_profiles`), and make the Resume Builder only prompt for a photo when the selected template needs one — offering the profile photo first.

**Architecture:** A new profile-photo field on `career_profiles` (two columns) is the durable default photo. `lib/photo-upload.ts` gains a profile-keyed upload beside the existing resume-keyed one. `lib/resume-templates.ts` declares which templates need a photo. A `<PhotoRequirementModal>`, opened by an effect on the studio editor page when the template requires a photo the resume lacks, walks the user through "use profile photo / upload a different one / go to My Profile". The always-on photo field is removed from `EditorPanel` and replaced by a row that only appears for photo templates. Image shaping stays pure CSS (`object-fit: cover`) in the two PDF templates.

**Tech Stack:** Next.js 16 (App Router) / React, Zustand, TanStack Query, Supabase JS (`@supabase/ssr`), Vitest + Testing Library, Jinja/WeasyPrint (PDF, unchanged).

**Spec:** `docs/superpowers/specs/2026-09-02-resume-builder-conditional-photo-flow-design.md`

## Global Constraints

- Supabase Storage bucket is **`avatars`** (already exists, public). Do not create a new bucket.
- Profile photo Storage key: **`${userId}/profile.${ext}`**. Resume-specific key stays **`${userId}/${resumeId}.${ext}`**.
- Photo validation: allowed MIME **`image/jpeg`, `image/png`, `image/webp`**; max size **5 MB** (`5 * 1024 * 1024`).
- The **only** value PDF templates read is `resume.content.contact.photo_url`. The `career_profiles` photo is never read at render time — it is copied into `content.contact.photo_url` when the user picks "Use Profile Photo".
- Uploading a resume-specific photo **never** overwrites the profile photo unless the user ticks the explicit "also save to my profile" checkbox.
- `ats_professional` and `ats_sidebar` are the photo templates; both stay **square** (`border-radius: 4px`). No new template shapes ship.
- Migrations have **no automated runner** — the `.sql` file is run by hand in the Supabase SQL editor. Match the style of `apps/web/supabase/migrations/001`–`004`.
- Tests: `cd apps/web && npx vitest run <path>`. Component tests need `// @vitest-environment jsdom` as the file's first line. Node-env tests need no pragma.
- Commit after every task with the `Co-Authored-By` / `Claude-Session` trailer already used in this repo's history.

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `apps/web/supabase/migrations/005_career_profile_photo.sql` | Adds `photo_url`, `photo_path` columns to `career_profiles`. |
| `apps/web/components/profile/ProfilePhotoCard.tsx` | Presentational card: thumbnail + upload / replace / remove. No network — parent supplies `onFileSelected`, `onRemove`. |
| `apps/web/components/resume/PhotoRequirementModal.tsx` | The conditional prompt. Case A (profile has photo) / Case B (none) / cancel. Owns the resume-photo + optional profile-photo upload. |
| `apps/web/__tests__/photo-upload.test.ts` | `assertValidPhoto`, `uploadProfilePhoto`, `uploadResumePhoto` keying. |
| `apps/web/__tests__/resume-templates.test.ts` | `templateRequiresPhoto` truth table. |
| `apps/web/__tests__/components/ProfilePhotoCard.test.tsx` | Card render / interactions. |
| `apps/web/__tests__/components/PhotoRequirementModal.test.tsx` | Case A / B / cancel / "also save". |

**Modified files:**

| Path | Change |
|---|---|
| `apps/web/lib/photo-upload.ts` | Add `assertValidPhoto`, `uploadToAvatars`, `uploadProfilePhoto`; refactor `uploadResumePhoto` onto the shared helpers. |
| `apps/web/lib/resume-templates.ts` | Add `photo` descriptor to two entries + `templateRequiresPhoto` + `PhotoShape` type. |
| `apps/web/lib/career-profile-client.ts` | `photo_url` / `photo_path` on `CareerProfile`; they flow through `CareerProfileInput` and `upsertCareerProfile` automatically. |
| `apps/web/stores/resume-store.ts` | Add `photoModalOpen`, `photoModalRevertTo`, `setPhotoModal`. |
| `apps/web/app/(app)/profile/page.tsx` | Mount `ProfilePhotoCard`; hold `photoUrl` / `photoPath` form state; include them in the `handleSave` payload; hydrate them in `hydrate()`. |
| `apps/web/app/(app)/studio/[resumeId]/page.tsx` | Fetch the career profile; auto-trigger effect; render `<PhotoRequirementModal>`. |
| `apps/web/components/resume/EditorPanel.tsx` | Delete the always-on Profile Photo block + its state/handler; add a photo row shown only when `templateRequiresPhoto(templateId)`. |
| `apps/web/__tests__/components/EditorPanel.test.tsx` | Update for the removed field + the new conditional row. |
| `apps/web/__tests__/studio-resume-page.test.tsx` | Add: modal auto-opens for a photo template with no photo. |
| `apps/web/__tests__/career-profile-client.test.ts` | Add: `upsertCareerProfile` forwards `photo_url` / `photo_path`. |
| `apps/api/templates/ats_professional.html`, `apps/api/templates/ats_sidebar.html` | Confirm/normalise `.photo` CSS (`object-fit: cover`, fixed box, `border-radius: 4px`). |

---

## Task 1: `photo-upload.ts` — shared validation + `uploadProfilePhoto`

**Files:**
- Modify: `apps/web/lib/photo-upload.ts`
- Test: `apps/web/__tests__/photo-upload.test.ts` (create)

**Interfaces:**
- Consumes: `createBrowserClient` from `@/lib/supabase` (Supabase JS client with `.auth.getUser()` and `.storage.from("avatars")`).
- Produces:
  - `export function assertValidPhoto(file: File): void` — throws `Error` for wrong MIME / oversize.
  - `export async function uploadResumePhoto(resumeId: string, file: File): Promise<string>` — unchanged signature; returns public URL; Storage key `${userId}/${resumeId}.${ext}`.
  - `export async function uploadProfilePhoto(file: File): Promise<{ url: string; path: string }>` — Storage key `${userId}/profile.${ext}`; `path` is that key.

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/photo-upload.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getUserMock = vi.fn();
const uploadMock = vi.fn();
const getPublicUrlMock = vi.fn();

vi.mock("@/lib/supabase", () => ({
  createBrowserClient: () => ({
    auth: { getUser: getUserMock },
    storage: {
      from: () => ({
        upload: uploadMock,
        getPublicUrl: getPublicUrlMock,
      }),
    },
  }),
}));

import { assertValidPhoto, uploadProfilePhoto, uploadResumePhoto } from "../lib/photo-upload";

function fakeFile(name: string, type: string, size: number): File {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

describe("assertValidPhoto", () => {
  it("rejects a non-image MIME type", () => {
    expect(() => assertValidPhoto(fakeFile("a.gif", "image/gif", 1000))).toThrow(/JPEG, PNG, or WebP/);
  });
  it("rejects a file larger than 5MB", () => {
    expect(() => assertValidPhoto(fakeFile("a.jpg", "image/jpeg", 5 * 1024 * 1024 + 1))).toThrow(/smaller than 5MB/);
  });
  it("accepts a valid JPEG under 5MB", () => {
    expect(() => assertValidPhoto(fakeFile("a.jpg", "image/jpeg", 1024))).not.toThrow();
  });
});

describe("uploadProfilePhoto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: "user-9" } } });
    uploadMock.mockResolvedValue({ error: null });
    getPublicUrlMock.mockReturnValue({ data: { publicUrl: "https://sb.example/avatars/user-9/profile.png" } });
  });

  it("uploads to '<uid>/profile.<ext>' and returns { url, path }", async () => {
    const result = await uploadProfilePhoto(fakeFile("me.PNG", "image/png", 2048));
    expect(uploadMock).toHaveBeenCalledWith(
      "user-9/profile.png",
      expect.any(File),
      expect.objectContaining({ upsert: true, contentType: "image/png" }),
    );
    expect(result).toEqual({
      url: "https://sb.example/avatars/user-9/profile.png",
      path: "user-9/profile.png",
    });
  });

  it("rejects an invalid file before touching storage", async () => {
    await expect(uploadProfilePhoto(fakeFile("me.gif", "image/gif", 2048))).rejects.toThrow();
    expect(uploadMock).not.toHaveBeenCalled();
  });
});

describe("uploadResumePhoto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: "user-9" } } });
    uploadMock.mockResolvedValue({ error: null });
    getPublicUrlMock.mockReturnValue({ data: { publicUrl: "https://sb.example/avatars/user-9/resume-3.jpg" } });
  });

  it("still uploads to '<uid>/<resumeId>.<ext>'", async () => {
    const url = await uploadResumePhoto("resume-3", fakeFile("shot.jpg", "image/jpeg", 2048));
    expect(uploadMock).toHaveBeenCalledWith(
      "user-9/resume-3.jpg",
      expect.any(File),
      expect.objectContaining({ upsert: true, contentType: "image/jpeg" }),
    );
    expect(url).toBe("https://sb.example/avatars/user-9/resume-3.jpg");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/photo-upload.test.ts`
Expected: FAIL — `assertValidPhoto` / `uploadProfilePhoto` are not exported.

- [ ] **Step 3: Rewrite `apps/web/lib/photo-upload.ts`**

```ts
import { createBrowserClient } from "@/lib/supabase";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Throws if `file` is the wrong type or too large. Shared by both upload paths. */
export function assertValidPhoto(file: File): void {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error("Photo must be a JPEG, PNG, or WebP image.");
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error("Photo must be smaller than 5MB.");
  }
}

async function currentUserId(): Promise<string> {
  const supabase = createBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return user.id;
}

/** Upsert `file` at `path` in the public "avatars" bucket; return its public URL.
 * The bucket must exist and be public (Storage → New bucket → "avatars" → Public). */
async function uploadToAvatars(path: string, file: File): Promise<string> {
  const supabase = createBrowserClient();
  const { error } = await supabase.storage.from("avatars").upload(path, file, {
    upsert: true,
    contentType: file.type,
  });
  if (error) throw error;
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Uploads a resume-specific profile photo, keyed by `resumeId`, and returns
 * its public URL. Used only when the user chooses "Upload a Different Photo"
 * for one resume — it does not touch the user's default profile photo.
 */
export async function uploadResumePhoto(resumeId: string, file: File): Promise<string> {
  assertValidPhoto(file);
  const userId = await currentUserId();
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  return uploadToAvatars(`${userId}/${resumeId}.${ext}`, file);
}

/**
 * Uploads the user's default profile photo, keyed as "<uid>/profile.<ext>".
 * Returns both the public URL and the Storage object key so the caller can
 * persist them onto `career_profiles` (photo_url / photo_path).
 */
export async function uploadProfilePhoto(file: File): Promise<{ url: string; path: string }> {
  assertValidPhoto(file);
  const userId = await currentUserId();
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${userId}/profile.${ext}`;
  const url = await uploadToAvatars(path, file);
  return { url, path };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/photo-upload.test.ts`
Expected: PASS (8 assertions across 3 describes).

- [ ] **Step 5: Check nothing else broke**

Run: `cd apps/web && npx vitest run __tests__/components/EditorPanel.test.tsx`
Expected: still PASS — `EditorPanel` imports `uploadResumePhoto`, whose signature is unchanged. (This test is updated in Task 9.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/photo-upload.ts apps/web/__tests__/photo-upload.test.ts
git commit -m "$(cat <<'EOF'
feat: photo-upload — shared validation + uploadProfilePhoto

Extracts assertValidPhoto/uploadToAvatars and adds a profile-keyed
upload ("<uid>/profile.<ext>") alongside the existing resume-keyed one.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WX7tabVdpzLnbHAsiSwEw2
EOF
)"
```

---

## Task 2: `resume-templates.ts` — photo descriptor + `templateRequiresPhoto`

**Files:**
- Modify: `apps/web/lib/resume-templates.ts`
- Test: `apps/web/__tests__/resume-templates.test.ts` (create)

**Interfaces:**
- Produces:
  - `export type PhotoShape = "square" | "portrait" | "circle";`
  - `RESUME_TEMPLATES` entries for `ats_sidebar` and `ats_professional` gain `photo: { shape: PhotoShape }`.
  - `export function templateRequiresPhoto(id: string): boolean`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/resume-templates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { RESUME_TEMPLATES, templateRequiresPhoto } from "../lib/resume-templates";

describe("templateRequiresPhoto", () => {
  it("is true for the photo templates", () => {
    expect(templateRequiresPhoto("ats_sidebar")).toBe(true);
    expect(templateRequiresPhoto("ats_professional")).toBe(true);
  });
  it("is false for the text-only templates", () => {
    expect(templateRequiresPhoto("ats_clean")).toBe(false);
    expect(templateRequiresPhoto("ats_modern")).toBe(false);
    expect(templateRequiresPhoto("ats_minimal")).toBe(false);
  });
  it("is false for an unknown id", () => {
    expect(templateRequiresPhoto("nope")).toBe(false);
  });
  it("photo templates declare a shape", () => {
    for (const id of ["ats_sidebar", "ats_professional"]) {
      const t = RESUME_TEMPLATES.find((x) => x.id === id)!;
      expect(t).toHaveProperty("photo.shape");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/resume-templates.test.ts`
Expected: FAIL — `templateRequiresPhoto` is not exported.

- [ ] **Step 3: Rewrite `apps/web/lib/resume-templates.ts`**

```ts
export type PhotoShape = "square" | "portrait" | "circle";

export const RESUME_TEMPLATES = [
  { id: "ats_clean", label: "ATS Clean", description: "Simple single-column layout, maximum ATS compatibility." },
  { id: "ats_modern", label: "ATS Modern", description: "Clean sans-serif with subtle color accents." },
  { id: "ats_sidebar", label: "Sidebar", description: "Banner header with photo, skill grid, and language bars.", photo: { shape: "square" as PhotoShape } },
  { id: "ats_professional", label: "Professional", description: "Bold blue headings with a photo and 4-column skills.", photo: { shape: "square" as PhotoShape } },
  { id: "ats_minimal", label: "Minimal", description: "Centered header, understated, content-first." },
] as const;

/** True when the given template id renders a profile photo. Single source of
 * truth for the Resume Builder's "this template needs a photo" prompt. The
 * PDF side already gates on `{% if contact.photo_url %}`, so this stays
 * web-only. */
export function templateRequiresPhoto(id: string): boolean {
  return !!RESUME_TEMPLATES.find((t) => t.id === id && "photo" in t);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/resume-templates.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check consumers**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors. (`RESUME_TEMPLATES` is iterated in `EditorPanel.tsx`, `PreviewPanel.tsx`, `studio/page.tsx`; the added optional `photo` key does not break `.map`/`.filter` over `{ id, label, description }`.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/resume-templates.ts apps/web/__tests__/resume-templates.test.ts
git commit -m "$(cat <<'EOF'
feat: resume-templates — photo descriptor + templateRequiresPhoto

ats_sidebar and ats_professional declare photo: { shape: "square" };
templateRequiresPhoto(id) is the web-side source of truth for the
photo prompt.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WX7tabVdpzLnbHAsiSwEw2
EOF
)"
```

---

## Task 3: `career_profiles` photo columns + client types

**Files:**
- Create: `apps/web/supabase/migrations/005_career_profile_photo.sql`
- Modify: `apps/web/lib/career-profile-client.ts` (interface `CareerProfile`, ~lines 62–77; `emptyContact` is in `profile/page.tsx`, not here)
- Test: `apps/web/__tests__/career-profile-client.test.ts` (extend)

**Interfaces:**
- Produces: `CareerProfile.photo_url: string | null` and `CareerProfile.photo_path: string | null`. `CareerProfileInput = Omit<CareerProfile, "user_id" | "created_at" | "updated_at">` picks both up. `upsertCareerProfile(input)` forwards them unchanged (it already spreads `...input`).

- [ ] **Step 1: Write the failing test**

In `apps/web/__tests__/career-profile-client.test.ts`, add inside the existing `describe` for `upsertCareerProfile` (or a new `describe`):

```ts
it("forwards photo_url and photo_path in the upsert payload", async () => {
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  queryResult = { data: { user_id: "user-1" }, error: null };
  upsertCalls = [];

  await upsertCareerProfile({
    master_resume_id: null,
    contact: { name: "Jane", email: "j@x.com" },
    headline: null,
    experience: [],
    projects: [],
    education: [],
    skills: [],
    certifications: [],
    role_status: null,
    photo_url: "https://sb.example/avatars/user-1/profile.png",
    photo_path: "user-1/profile.png",
  });

  expect(upsertCalls[0].payload).toMatchObject({
    user_id: "user-1",
    photo_url: "https://sb.example/avatars/user-1/profile.png",
    photo_path: "user-1/profile.png",
  });
});
```

If `upsertCareerProfile`'s test block passes a typed `CareerProfileInput` literal elsewhere, this new object shape must compile — that is exactly what Step 3 enables.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/career-profile-client.test.ts`
Expected: FAIL — TypeScript error "Object literal may only specify known properties" for `photo_url` (the `CareerProfileInput` type has no such field yet), or a runtime assertion failure.

- [ ] **Step 3a: Add the migration file**

Create `apps/web/supabase/migrations/005_career_profile_photo.sql`:

```sql
-- Profile photo: the user's default headshot, reused across resumes.
-- Managed in "My Profile"; the Resume Builder only prompts to use/replace it.
-- Run in the Supabase SQL editor after 004_career_profile_projects.sql.

ALTER TABLE career_profiles
  ADD COLUMN IF NOT EXISTS photo_url  text,   -- public URL in the "avatars" bucket
  ADD COLUMN IF NOT EXISTS photo_path text;   -- storage object key "<uid>/profile.<ext>"

-- No backfill: existing rows keep NULL (no profile photo). RLS unchanged —
-- career_profiles_own already covers every column on the row.
```

- [ ] **Step 3b: Add the fields to `CareerProfile`**

In `apps/web/lib/career-profile-client.ts`, in `interface CareerProfile`, after `role_status`:

```ts
  role_status: RoleStatus | null;
  /** Public URL of the user's default profile photo in the "avatars" bucket.
   *  null = none set. Distinct from a resume's content.contact.photo_url. */
  photo_url: string | null;
  /** Storage object key for photo_url ("<uid>/profile.<ext>") — kept so a
   *  later replace/remove knows the exact object. null iff photo_url is null. */
  photo_path: string | null;
  created_at: string;
```

`CareerProfileInput` and `upsertCareerProfile` need no edits — the `Omit<>` and `...input` spread carry the new fields.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/career-profile-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: **new** errors only in `apps/web/app/(app)/profile/page.tsx` where `hydrate()` and `handleSave()` build `CareerProfile` / `CareerProfileInput` without the new fields — those are fixed in Task 5. If errors appear anywhere else, resolve them here (e.g. `resumeContentToCareerProfileInput` must add `photo_url: null, photo_path: null` to its returned object).

- [ ] **Step 5b: Patch `resumeContentToCareerProfileInput`**

In `career-profile-client.ts`, in the object returned by `resumeContentToCareerProfileInput`, add beside `role_status: null`:

```ts
    role_status: null,
    photo_url: null,
    photo_path: null,
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/supabase/migrations/005_career_profile_photo.sql apps/web/lib/career-profile-client.ts apps/web/__tests__/career-profile-client.test.ts
git commit -m "$(cat <<'EOF'
feat: career_profiles.photo_url/photo_path + client types

Migration 005 adds two nullable columns; CareerProfile carries them and
upsertCareerProfile forwards them. resumeContentToCareerProfileInput
returns null for both (photo is only ever set explicitly).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WX7tabVdpzLnbHAsiSwEw2
EOF
)"
```

---

## Task 4: `resume-store` — shared photo-modal open state

**Files:**
- Modify: `apps/web/stores/resume-store.ts`
- Test: `apps/web/__tests__/resume-store.test.ts` (extend)

**Interfaces:**
- Produces on the store:
  - `photoModalOpen: boolean` (default `false`)
  - `photoModalRevertTo: string | null` (default `null`) — template id to restore if the user cancels an auto-triggered prompt; `null` when the modal was opened manually from the editor.
  - `setPhotoModal: (open: boolean, revertTo?: string | null) => void`
- `resetStore()` resets all three.

- [ ] **Step 1: Write the failing test**

In `apps/web/__tests__/resume-store.test.ts`, add:

```ts
describe("photo modal state", () => {
  it("defaults closed with no revert target", () => {
    const s = useResumeStore.getState();
    expect(s.photoModalOpen).toBe(false);
    expect(s.photoModalRevertTo).toBeNull();
  });

  it("setPhotoModal(true, id) opens and records the revert target", () => {
    useResumeStore.getState().setPhotoModal(true, "ats_clean");
    expect(useResumeStore.getState().photoModalOpen).toBe(true);
    expect(useResumeStore.getState().photoModalRevertTo).toBe("ats_clean");
  });

  it("setPhotoModal(true) with no id opens with a null revert target", () => {
    useResumeStore.getState().setPhotoModal(true, "ats_clean");
    useResumeStore.getState().setPhotoModal(true);
    expect(useResumeStore.getState().photoModalRevertTo).toBeNull();
  });

  it("setPhotoModal(false) closes and clears the revert target", () => {
    useResumeStore.getState().setPhotoModal(true, "ats_clean");
    useResumeStore.getState().setPhotoModal(false);
    expect(useResumeStore.getState().photoModalOpen).toBe(false);
    expect(useResumeStore.getState().photoModalRevertTo).toBeNull();
  });

  it("resetStore clears photo modal state", () => {
    useResumeStore.getState().setPhotoModal(true, "ats_sidebar");
    useResumeStore.getState().resetStore();
    expect(useResumeStore.getState().photoModalOpen).toBe(false);
    expect(useResumeStore.getState().photoModalRevertTo).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/resume-store.test.ts`
Expected: FAIL — `photoModalOpen` undefined / `setPhotoModal` not a function.

- [ ] **Step 3: Edit `apps/web/stores/resume-store.ts`**

Add to the `ResumeState` interface (near `pdfSignedUrl`):

```ts
  /** Open state of <PhotoRequirementModal>, shared between the studio page
   *  (auto-trigger on template change) and EditorPanel ("Change photo"). */
  photoModalOpen: boolean;
  /** Template id to restore if the user cancels an auto-triggered prompt.
   *  null when the modal was opened manually (nothing to revert). */
  photoModalRevertTo: string | null;
  setPhotoModal: (open: boolean, revertTo?: string | null) => void;
```

Add to the initial state object (near `pdfSignedUrl: null,`):

```ts
  photoModalOpen: false,
  photoModalRevertTo: null,
```

Add the action (near `setPdfSignedUrl`):

```ts
  setPhotoModal: (open, revertTo = null) =>
    set({ photoModalOpen: open, photoModalRevertTo: open ? revertTo : null }),
```

Add both keys to the `set({ ... })` inside `resetStore()`:

```ts
      pdfSignedUrl: null,
      photoModalOpen: false,
      photoModalRevertTo: null,
      _saveTimer: null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/resume-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/stores/resume-store.ts apps/web/__tests__/resume-store.test.ts
git commit -m "$(cat <<'EOF'
feat: resume-store — photoModalOpen / photoModalRevertTo / setPhotoModal

Shared open state for the photo-requirement prompt so the studio page
and EditorPanel drive one modal.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WX7tabVdpzLnbHAsiSwEw2
EOF
)"
```

---

## Task 5: `ProfilePhotoCard` component

**Files:**
- Create: `apps/web/components/profile/ProfilePhotoCard.tsx`
- Test: `apps/web/__tests__/components/ProfilePhotoCard.test.tsx` (create)

**Interfaces:**
- Consumes: nothing from other tasks (pure presentational).
- Produces:
  ```ts
  interface ProfilePhotoCardProps {
    photoUrl: string | null;
    uploading: boolean;
    error: string | null;
    onFileSelected: (file: File) => void;  // parent validates + uploads
    onRemove: () => void;
  }
  export function ProfilePhotoCard(props: ProfilePhotoCardProps): JSX.Element;
  ```
- Behaviour: shows a circular thumbnail when `photoUrl` is set (else a placeholder circle); a file `<input type="file" accept="image/jpeg,image/png,image/webp">` labelled **"Upload photo"** (or **"Replace"** when a photo exists); a **"Remove"** button only when `photoUrl` is set; `error` shown in `text-error`; `uploading` disables the input and shows "Uploading…".

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/components/ProfilePhotoCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfilePhotoCard } from "../../components/profile/ProfilePhotoCard";

describe("ProfilePhotoCard", () => {
  it("shows an upload control and no Remove button when there is no photo", () => {
    render(
      <ProfilePhotoCard photoUrl={null} uploading={false} error={null} onFileSelected={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.getByText("Upload photo")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
  });

  it("shows the thumbnail, a Replace label and a Remove button when a photo is set", () => {
    render(
      <ProfilePhotoCard
        photoUrl="https://sb.example/avatars/u/profile.png"
        uploading={false}
        error={null}
        onFileSelected={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByRole("img", { name: /profile photo/i })).toHaveAttribute(
      "src",
      "https://sb.example/avatars/u/profile.png",
    );
    expect(screen.getByText("Replace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });

  it("calls onFileSelected with the chosen file", async () => {
    const onFileSelected = vi.fn();
    render(
      <ProfilePhotoCard photoUrl={null} uploading={false} error={null} onFileSelected={onFileSelected} onRemove={vi.fn()} />,
    );
    const file = new File(["x"], "me.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText(/upload photo/i), file);
    expect(onFileSelected).toHaveBeenCalledWith(file);
  });

  it("calls onRemove when Remove is clicked", async () => {
    const onRemove = vi.fn();
    render(
      <ProfilePhotoCard
        photoUrl="https://sb.example/x.png"
        uploading={false}
        error={null}
        onFileSelected={vi.fn()}
        onRemove={onRemove}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(onRemove).toHaveBeenCalled();
  });

  it("shows an error message and an uploading state", () => {
    const { rerender } = render(
      <ProfilePhotoCard photoUrl={null} uploading error={null} onFileSelected={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.getByText("Uploading…")).toBeInTheDocument();
    rerender(
      <ProfilePhotoCard photoUrl={null} uploading={false} error="Photo must be smaller than 5MB." onFileSelected={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.getByText("Photo must be smaller than 5MB.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/components/ProfilePhotoCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/web/components/profile/ProfilePhotoCard.tsx`**

```tsx
"use client";
import { useRef } from "react";
import { UserCircle } from "@phosphor-icons/react";

interface ProfilePhotoCardProps {
  photoUrl: string | null;
  uploading: boolean;
  error: string | null;
  /** Parent is responsible for validation + upload + state. */
  onFileSelected: (file: File) => void;
  onRemove: () => void;
}

const cardCls =
  "bg-surface-container-lowest/80 backdrop-blur-xl rounded-2xl p-lg border border-outline-variant/30 shadow-lg shadow-primary/5";

export function ProfilePhotoCard({
  photoUrl,
  uploading,
  error,
  onFileSelected,
  onRemove,
}: ProfilePhotoCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <section className={cardCls}>
      <h2 className="text-headline-md text-on-surface font-bold tracking-tight mb-lg">
        Profile Photo
      </h2>
      <div className="flex items-center gap-lg">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt="Profile photo"
            className="w-20 h-20 rounded-full object-cover border border-outline-variant/30"
          />
        ) : (
          <div className="w-20 h-20 rounded-full bg-surface-variant/50 flex items-center justify-center text-on-surface-variant/60">
            <UserCircle size={44} />
          </div>
        )}

        <div className="flex flex-col gap-xs">
          <div className="flex items-center gap-sm">
            <label className="px-md py-sm rounded-lg border border-outline-variant text-label-sm text-primary hover:bg-surface-container-low transition-colors cursor-pointer">
              {uploading ? "Uploading…" : photoUrl ? "Replace" : "Upload photo"}
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={uploading}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onFileSelected(file);
                  e.target.value = "";
                }}
              />
            </label>
            {photoUrl && (
              <button
                type="button"
                onClick={onRemove}
                className="px-md py-sm rounded-lg text-label-sm text-on-surface-variant hover:text-error hover:bg-error-container/20 transition-colors"
              >
                Remove
              </button>
            )}
          </div>
          <p className="text-caption text-on-surface-variant">
            JPEG, PNG or WebP · up to 5MB · used by templates with a photo.
          </p>
          {error && <p className="text-label-sm text-error">{error}</p>}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/components/ProfilePhotoCard.test.tsx`
Expected: PASS (5 tests). If `UserCircle` is not exported by the installed `@phosphor-icons/react`, swap for `User` (already used elsewhere in `profile/page.tsx`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/profile/ProfilePhotoCard.tsx apps/web/__tests__/components/ProfilePhotoCard.test.tsx
git commit -m "$(cat <<'EOF'
feat: ProfilePhotoCard — presentational profile-photo control

Circular thumbnail + upload/replace/remove; parent owns validation,
upload and state.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WX7tabVdpzLnbHAsiSwEw2
EOF
)"
```

---

## Task 6: Wire `ProfilePhotoCard` into My Profile

**Files:**
- Modify: `apps/web/app/(app)/profile/page.tsx`
- Test: `apps/web/__tests__/components/ProfilePage.test.tsx` (create)

**Interfaces:**
- Consumes: `ProfilePhotoCard` (Task 5), `uploadProfilePhoto` (Task 1), `CareerProfileInput.photo_url/photo_path` (Task 3).
- Produces: on save, `upsertCareerProfile` is called with `photo_url` / `photo_path` reflecting the current card state.

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/components/ProfilePage.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/resume/ResumePreviewModal", () => ({ ResumePreviewModal: () => null }));

const getCareerProfile = vi.fn();
const upsertCareerProfile = vi.fn();
vi.mock("@/lib/career-profile-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/career-profile-client")>();
  return { ...actual, getCareerProfile, upsertCareerProfile };
});

const uploadProfilePhoto = vi.fn();
vi.mock("@/lib/photo-upload", () => ({ uploadProfilePhoto, uploadResumePhoto: vi.fn() }));

vi.mock("@/lib/api-client", () => ({
  apiClient: { getResume: vi.fn(), parseResumeFile: vi.fn() },
  ApiError: class ApiError extends Error { status = 0; },
}));

import ProfilePage from "../../app/(app)/profile/page";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProfilePage />
    </QueryClientProvider>,
  );
}

describe("My Profile — profile photo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCareerProfile.mockResolvedValue({
      user_id: "u1", master_resume_id: null,
      contact: { name: "Jane", email: "j@x.com" },
      experience: [], projects: [], education: [], skills: [], certifications: [],
      headline: null, role_status: null,
      photo_url: null, photo_path: null,
      created_at: "", updated_at: "",
    });
    upsertCareerProfile.mockResolvedValue({});
    uploadProfilePhoto.mockResolvedValue({
      url: "https://sb.example/avatars/u1/profile.png", path: "u1/profile.png",
    });
  });

  it("uploads on file pick and persists photo_url/photo_path on Save", async () => {
    renderPage();
    await screen.findByText("Profile Photo");

    const file = new File(["x"], "me.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText(/upload photo/i), file);

    await waitFor(() => expect(uploadProfilePhoto).toHaveBeenCalledWith(file));
    await screen.findByText("Replace"); // card now reflects the uploaded photo

    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));

    await waitFor(() =>
      expect(upsertCareerProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          photo_url: "https://sb.example/avatars/u1/profile.png",
          photo_path: "u1/profile.png",
        }),
      ),
    );
  });

  it("Remove clears the photo and Save persists nulls", async () => {
    getCareerProfile.mockResolvedValue({
      user_id: "u1", master_resume_id: null,
      contact: { name: "Jane", email: "j@x.com" },
      experience: [], projects: [], education: [], skills: [], certifications: [],
      headline: null, role_status: null,
      photo_url: "https://sb.example/avatars/u1/profile.png", photo_path: "u1/profile.png",
      created_at: "", updated_at: "",
    });
    renderPage();
    await screen.findByText("Profile Photo");
    await userEvent.click(screen.getByRole("button", { name: /remove/i }));
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() =>
      expect(upsertCareerProfile).toHaveBeenCalledWith(
        expect.objectContaining({ photo_url: null, photo_path: null }),
      ),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/components/ProfilePage.test.tsx`
Expected: FAIL — no "Profile Photo" text (card not mounted).

- [ ] **Step 3: Edit `apps/web/app/(app)/profile/page.tsx`**

3a. Import near the other component imports:

```tsx
import { ProfilePhotoCard } from "@/components/profile/ProfilePhotoCard";
import { uploadProfilePhoto } from "@/lib/photo-upload";
```

3b. Add form state beside the other `useState` hooks (near `const [headline, setHeadline] = useState("");`):

```tsx
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
```

3c. In `hydrate(profile)`, add:

```tsx
    setPhotoUrl(profile.photo_url ?? null);
    setPhotoPath(profile.photo_path ?? null);
```

3d. In `handleSave`, add the two fields to the `profileInput` object literal:

```tsx
        role_status: roleStatus || null,
        photo_url: photoUrl,
        photo_path: photoPath,
```

3e. Add the upload handler near `handleUpload` (the resume-parse one):

```tsx
  async function handleProfilePhoto(file: File) {
    setPhotoUploading(true);
    setPhotoError(null);
    try {
      const { url, path } = await uploadProfilePhoto(file);
      setPhotoUrl(url);
      setPhotoPath(path);
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : "Photo upload failed");
    } finally {
      setPhotoUploading(false);
    }
  }

  function removeProfilePhoto() {
    // Leaves the storage object in place (it is overwritten on the next
    // upload) — only the profile's pointer to it is cleared, persisted on Save.
    setPhotoUrl(null);
    setPhotoPath(null);
    setPhotoError(null);
  }
```

3f. Render the card. Put it right after the `{/* ── Resume upload ── */}` `</section>` and before `{/* ── Contact information ── */}`:

```tsx
      <ProfilePhotoCard
        photoUrl={photoUrl}
        uploading={photoUploading}
        error={photoError}
        onFileSelected={handleProfilePhoto}
        onRemove={removeProfilePhoto}
      />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/components/ProfilePage.test.tsx`
Expected: PASS (2 tests). If `getCareerProfile` is imported via `import { getCareerProfile } from "@/lib/career-profile-client"` and the partial mock does not intercept, switch the mock to a full factory listing every export the page uses (`getCareerProfile`, `upsertCareerProfile`, `inferExpType`, `sameCompany`, `formatRoleDuration`, `formatCompanyTotalDuration`, `blankExperienceEntry`, `insertRoleAfter`, `moveExperience`) — copy the non-mocked ones through from `importOriginal`.

- [ ] **Step 5: Full type-check + profile-adjacent tests**

Run: `cd apps/web && npx tsc --noEmit && npx vitest run __tests__/career-profile-client.test.ts`
Expected: PASS — the Task 3 Step 5 type errors in `profile/page.tsx` are now resolved.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/(app)/profile/page.tsx apps/web/__tests__/components/ProfilePage.test.tsx
git commit -m "$(cat <<'EOF'
feat: My Profile — Profile Photo card, persisted to career_profiles

Upload goes straight to Supabase Storage via uploadProfilePhoto;
photo_url/photo_path are saved with the rest of the profile form.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WX7tabVdpzLnbHAsiSwEw2
EOF
)"
```

---

## Task 7: `PhotoRequirementModal` component

**Files:**
- Create: `apps/web/components/resume/PhotoRequirementModal.tsx`
- Test: `apps/web/__tests__/components/PhotoRequirementModal.test.tsx` (create)

**Interfaces:**
- Consumes: `uploadResumePhoto` + `uploadProfilePhoto` (Task 1); `useResumeStore` `content`, `updateContent`, `resumeId`, `photoModalOpen`, `photoModalRevertTo`, `setPhotoModal`, `setTemplateId` (Tasks 4 + existing); `upsertCareerProfile` (existing); `useQueryClient` (TanStack).
- Props:
  ```ts
  interface PhotoRequirementModalProps {
    /** Career-profile photo URL: string = have one (Case A),
     *  null = none (Case B), undefined = still loading. */
    profilePhotoUrl: string | null | undefined;
    /** Full career profile input needed to re-upsert when the user opts to
     *  also save the uploaded image as their profile photo. null while loading. */
    profileForUpsert: import("@/lib/career-profile-client").CareerProfileInput | null;
    onOpenProfile: () => void;   // navigate to /profile
  }
  export function PhotoRequirementModal(props: PhotoRequirementModalProps): JSX.Element | null;
  ```
- Behaviour:
  - Renders `null` unless `useResumeStore(s => s.photoModalOpen)`.
  - Uses `@radix-ui/react-dialog` (already a dependency) for the overlay + focus trap.
  - **Case A** (`profilePhotoUrl` is a string): heading "This template requires a profile photo.", body "We found a photo in your profile. Would you like to use this photo or upload a different one?", thumbnail, buttons **Use Profile Photo**, **Upload a Different Photo**, **Cancel**.
  - **Case B** (`profilePhotoUrl` is `null`): body "You don't have a profile photo yet. Please upload one to continue.", buttons **Upload Photo**, **Open My Profile**, **Cancel**.
  - `profilePhotoUrl === undefined`: show a small "Loading…" line instead of the case body; keep Cancel.
  - "Upload …" reveals `<input type="file">` + checkbox **"Also set this as my profile photo"** — default **unchecked** in Case A, **checked** in Case B.
  - On file pick: `assertValidPhoto` is inside `uploadResumePhoto`, so just `await uploadResumePhoto(resumeId, file)` → `updateContent({ contact: { ...content.contact, photo_url: url } })`; if the checkbox is checked and `profileForUpsert` is non-null: `const { url: pUrl, path } = await uploadProfilePhoto(file); await upsertCareerProfile({ ...profileForUpsert, photo_url: pUrl, photo_path: path }); queryClient.invalidateQueries({ queryKey: ["careerProfile"] });` then close.
  - **Use Profile Photo**: `updateContent({ contact: { ...content.contact, photo_url: profilePhotoUrl } })`; close.
  - **Cancel**: if `photoModalRevertTo` is non-null, `setTemplateId(photoModalRevertTo)`; then `setPhotoModal(false)`.
  - Close == `setPhotoModal(false)` (also on Radix `onOpenChange(false)` / Esc — same revert rule as Cancel).
  - Upload errors: caught, shown in `text-error` inside the modal, modal stays open.

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/components/PhotoRequirementModal.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const uploadResumePhoto = vi.fn();
const uploadProfilePhoto = vi.fn();
vi.mock("@/lib/photo-upload", () => ({ uploadResumePhoto, uploadProfilePhoto }));

const upsertCareerProfile = vi.fn();
vi.mock("@/lib/career-profile-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/career-profile-client")>();
  return { ...actual, upsertCareerProfile };
});

import { PhotoRequirementModal } from "../../components/resume/PhotoRequirementModal";
import { useResumeStore } from "../../stores/resume-store";

const CONTENT = { contact: { name: "Jane", email: "j@x.com" }, experience: [], education: [], skills: [] };
const PROFILE_INPUT = {
  master_resume_id: null, contact: { name: "Jane", email: "j@x.com" }, headline: null,
  experience: [], projects: [], education: [], skills: [], certifications: [],
  role_status: null, photo_url: null, photo_path: null,
};

function mount(props: Partial<React.ComponentProps<typeof PhotoRequirementModal>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PhotoRequirementModal
        profilePhotoUrl={null}
        profileForUpsert={PROFILE_INPUT}
        onOpenProfile={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("PhotoRequirementModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useResumeStore.getState().resetStore();
    useResumeStore.getState().setResume("resume-1", structuredClone(CONTENT), "ats_sidebar");
    uploadResumePhoto.mockResolvedValue("https://sb.example/avatars/u/resume-1.png");
    uploadProfilePhoto.mockResolvedValue({ url: "https://sb.example/avatars/u/profile.png", path: "u/profile.png" });
    upsertCareerProfile.mockResolvedValue({});
  });

  it("renders nothing while photoModalOpen is false", () => {
    mount();
    expect(screen.queryByText(/requires a profile photo/i)).not.toBeInTheDocument();
  });

  it("Case A: 'Use Profile Photo' copies the profile URL into content and closes", async () => {
    useResumeStore.getState().setPhotoModal(true, "ats_clean");
    mount({ profilePhotoUrl: "https://sb.example/avatars/u/profile.png" });

    await userEvent.click(screen.getByRole("button", { name: /use profile photo/i }));

    expect(useResumeStore.getState().content!.contact.photo_url).toBe(
      "https://sb.example/avatars/u/profile.png",
    );
    expect(useResumeStore.getState().photoModalOpen).toBe(false);
  });

  it("Case A: 'Upload a Different Photo' with checkbox OFF sets only the resume photo", async () => {
    useResumeStore.getState().setPhotoModal(true, "ats_clean");
    mount({ profilePhotoUrl: "https://sb.example/avatars/u/profile.png" });

    await userEvent.click(screen.getByRole("button", { name: /upload a different photo/i }));
    const file = new File(["x"], "new.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText(/choose an image|upload/i), file);

    await waitFor(() => expect(uploadResumePhoto).toHaveBeenCalledWith("resume-1", file));
    expect(uploadProfilePhoto).not.toHaveBeenCalled();
    expect(upsertCareerProfile).not.toHaveBeenCalled();
    expect(useResumeStore.getState().content!.contact.photo_url).toBe(
      "https://sb.example/avatars/u/resume-1.png",
    );
  });

  it("Case A: ticking 'also set as my profile photo' also upserts the profile", async () => {
    useResumeStore.getState().setPhotoModal(true, "ats_clean");
    mount({ profilePhotoUrl: "https://sb.example/avatars/u/profile.png" });

    await userEvent.click(screen.getByRole("button", { name: /upload a different photo/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /also set|also save/i }));
    const file = new File(["x"], "new.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText(/choose an image|upload/i), file);

    await waitFor(() => expect(uploadProfilePhoto).toHaveBeenCalledWith(file));
    expect(upsertCareerProfile).toHaveBeenCalledWith(
      expect.objectContaining({ photo_url: "https://sb.example/avatars/u/profile.png", photo_path: "u/profile.png" }),
    );
  });

  it("Case B: no profile photo — checkbox defaults checked; 'Open My Profile' fires the callback", async () => {
    const onOpenProfile = vi.fn();
    useResumeStore.getState().setPhotoModal(true, "ats_clean");
    mount({ profilePhotoUrl: null, onOpenProfile });

    expect(screen.getByText(/don't have a profile photo yet/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /upload photo/i }));
    expect(screen.getByRole("checkbox", { name: /also save|also set/i })).toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: /open my profile/i }));
    expect(onOpenProfile).toHaveBeenCalled();
  });

  it("Cancel reverts the template to photoModalRevertTo", async () => {
    useResumeStore.getState().setPhotoModal(true, "ats_clean");
    mount({ profilePhotoUrl: null });
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(useResumeStore.getState().templateId).toBe("ats_clean");
    expect(useResumeStore.getState().photoModalOpen).toBe(false);
  });

  it("shows an upload error and stays open", async () => {
    uploadResumePhoto.mockRejectedValue(new Error("Photo must be smaller than 5MB."));
    useResumeStore.getState().setPhotoModal(true, "ats_clean");
    mount({ profilePhotoUrl: null });
    await userEvent.click(screen.getByRole("button", { name: /upload photo/i }));
    const file = new File(["x"], "big.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText(/choose an image|upload/i), file);
    expect(await screen.findByText("Photo must be smaller than 5MB.")).toBeInTheDocument();
    expect(useResumeStore.getState().photoModalOpen).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/components/PhotoRequirementModal.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/web/components/resume/PhotoRequirementModal.tsx`**

```tsx
"use client";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useResumeStore } from "@/stores/resume-store";
import { uploadResumePhoto, uploadProfilePhoto } from "@/lib/photo-upload";
import { upsertCareerProfile, type CareerProfileInput } from "@/lib/career-profile-client";

interface PhotoRequirementModalProps {
  /** string = profile has a photo (Case A); null = none (Case B); undefined = loading. */
  profilePhotoUrl: string | null | undefined;
  /** Needed only to re-upsert when the user also wants the uploaded image as
   *  their profile photo. null while the profile is still loading. */
  profileForUpsert: CareerProfileInput | null;
  onOpenProfile: () => void;
}

export function PhotoRequirementModal({
  profilePhotoUrl,
  profileForUpsert,
  onOpenProfile,
}: PhotoRequirementModalProps) {
  const open = useResumeStore((s) => s.photoModalOpen);
  const revertTo = useResumeStore((s) => s.photoModalRevertTo);
  const setPhotoModal = useResumeStore((s) => s.setPhotoModal);
  const setTemplateId = useResumeStore((s) => s.setTemplateId);
  const content = useResumeStore((s) => s.content);
  const updateContent = useResumeStore((s) => s.updateContent);
  const resumeId = useResumeStore((s) => s.resumeId);
  const queryClient = useQueryClient();

  const caseB = profilePhotoUrl === null;
  const [showUpload, setShowUpload] = useState(false);
  const [alsoSaveToProfile, setAlsoSaveToProfile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the per-open UI state whenever the modal transitions to open.
  function handleOpenChange(next: boolean) {
    if (!next) close();
  }

  function close() {
    if (revertTo) setTemplateId(revertTo);
    setShowUpload(false);
    setError(null);
    setBusy(false);
    setPhotoModal(false);
  }

  function beginUpload() {
    setShowUpload(true);
    setAlsoSaveToProfile(caseB); // default on in Case B, off in Case A
    setError(null);
  }

  function useProfilePhoto() {
    if (!content || typeof profilePhotoUrl !== "string") return;
    updateContent({ contact: { ...content.contact, photo_url: profilePhotoUrl } });
    setPhotoModal(false); // deliberate choice — no revert
    setShowUpload(false);
  }

  async function onFile(file: File) {
    if (!content || !resumeId) return;
    setBusy(true);
    setError(null);
    try {
      const url = await uploadResumePhoto(resumeId, file);
      updateContent({ contact: { ...content.contact, photo_url: url } });
      if (alsoSaveToProfile && profileForUpsert) {
        const { url: pUrl, path } = await uploadProfilePhoto(file);
        await upsertCareerProfile({ ...profileForUpsert, photo_url: pUrl, photo_path: path });
        queryClient.invalidateQueries({ queryKey: ["careerProfile"] });
      }
      setPhotoModal(false); // success — keep the photo template
      setShowUpload(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Photo upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-surface p-lg shadow-2xl border border-outline-variant/20 flex flex-col gap-md">
          <Dialog.Title className="text-headline-sm font-bold text-on-surface">
            This template requires a profile photo.
          </Dialog.Title>

          {profilePhotoUrl === undefined ? (
            <p className="text-body-sm text-on-surface-variant">Loading your profile…</p>
          ) : caseB ? (
            <Dialog.Description className="text-body-sm text-on-surface-variant">
              You don&apos;t have a profile photo yet. Please upload one to continue.
            </Dialog.Description>
          ) : (
            <>
              <Dialog.Description className="text-body-sm text-on-surface-variant">
                We found a photo in your profile. Would you like to use this photo or upload a
                different one?
              </Dialog.Description>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={profilePhotoUrl}
                alt="Your profile photo"
                className="w-20 h-20 rounded-full object-cover border border-outline-variant/30"
              />
            </>
          )}

          {showUpload && (
            <div className="flex flex-col gap-sm rounded-xl border border-outline-variant/30 p-md">
              <label className="text-label-sm text-primary cursor-pointer">
                {busy ? "Uploading…" : "Choose an image"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busy}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onFile(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <label className="flex items-center gap-sm text-caption text-on-surface-variant">
                <input
                  type="checkbox"
                  checked={alsoSaveToProfile}
                  onChange={(e) => setAlsoSaveToProfile(e.target.checked)}
                />
                {caseB ? "Also save to my profile" : "Also set this as my profile photo"}
              </label>
            </div>
          )}

          {error && <p className="text-label-sm text-error">{error}</p>}

          <div className="flex flex-wrap justify-end gap-sm pt-xs">
            <button
              type="button"
              onClick={close}
              className="px-md py-sm rounded-lg text-label-sm text-on-surface-variant hover:bg-surface-container-low transition-colors"
            >
              Cancel
            </button>

            {caseB ? (
              <>
                <button
                  type="button"
                  onClick={onOpenProfile}
                  className="px-md py-sm rounded-lg text-label-sm border border-outline-variant text-on-surface hover:bg-surface-container-low transition-colors"
                >
                  Open My Profile
                </button>
                {!showUpload && (
                  <button
                    type="button"
                    onClick={beginUpload}
                    className="px-md py-sm rounded-lg text-label-sm bg-primary text-on-primary hover:opacity-90 transition-opacity"
                  >
                    Upload Photo
                  </button>
                )}
              </>
            ) : (
              !showUpload && (
                <>
                  <button
                    type="button"
                    onClick={beginUpload}
                    className="px-md py-sm rounded-lg text-label-sm border border-outline-variant text-on-surface hover:bg-surface-container-low transition-colors"
                  >
                    Upload a Different Photo
                  </button>
                  <button
                    type="button"
                    onClick={useProfilePhoto}
                    className="px-md py-sm rounded-lg text-label-sm bg-primary text-on-primary hover:opacity-90 transition-opacity"
                  >
                    Use Profile Photo
                  </button>
                </>
              )
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/components/PhotoRequirementModal.test.tsx`
Expected: PASS (8 tests). If Radix Dialog's `aria` wiring makes `getByLabelText(/choose an image/i)` miss the file input, change the component to wrap the text + input in an explicit `<label htmlFor="prm-file">` / `id="prm-file"` pair and keep the test's `/choose an image/i` matcher.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/resume/PhotoRequirementModal.tsx apps/web/__tests__/components/PhotoRequirementModal.test.tsx
git commit -m "$(cat <<'EOF'
feat: PhotoRequirementModal — the conditional photo prompt

Case A (use profile photo / upload a different one) and Case B (upload /
go to My Profile), with an opt-in "also save to my profile" and a
Cancel that reverts the template.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WX7tabVdpzLnbHAsiSwEw2
EOF
)"
```

---

## Task 8: Wire the modal into the studio editor page

**Files:**
- Modify: `apps/web/app/(app)/studio/[resumeId]/page.tsx`
- Test: `apps/web/__tests__/studio-resume-page.test.tsx` (extend)

**Interfaces:**
- Consumes: `PhotoRequirementModal` (Task 7); `templateRequiresPhoto` (Task 2); `getCareerProfile` + `resumeContentToCareerProfileInput`… actually build the `CareerProfileInput` via the existing exported helper is overkill — pass the loaded `CareerProfile` mapped to input shape. Use a tiny inline map (see Step 3).
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the failing test**

In `apps/web/__tests__/studio-resume-page.test.tsx`:

1. Extend the `@/lib/api-client` mock — it already lists `getResume`, `getLatestResumePdf`, `updateResume`; no change needed.
2. Add mocks near the top (after the existing `vi.mock` calls), and stop stubbing `EditorPanel` to `null` only if a test needs it — keep it stubbed; the modal is rendered by the page, not EditorPanel:

```ts
vi.mock("@/lib/career-profile-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/career-profile-client")>();
  return { ...actual, getCareerProfile: vi.fn().mockResolvedValue(null) };
});
vi.mock("@/lib/photo-upload", () => ({ uploadResumePhoto: vi.fn(), uploadProfilePhoto: vi.fn() }));
```

3. Add a test:

```ts
it("opens the photo prompt when the resume is on a photo template with no photo", async () => {
  vi.mocked(apiClient.getResume).mockResolvedValue(
    makeResume({ template_id: "ats_sidebar" }) as any,
  );
  await renderWithQueryClient(<StudioResumePage params={Promise.resolve({ resumeId: "resume-1" })} />);

  await waitFor(() =>
    expect(useResumeStore.getState().photoModalOpen).toBe(true),
  );
  expect(await screen.findByText("This template requires a profile photo.")).toBeInTheDocument();
});

it("does not open the prompt when the resume already has a photo", async () => {
  vi.mocked(apiClient.getResume).mockResolvedValue(
    makeResume({
      template_id: "ats_sidebar",
      content: { ...SAMPLE_CONTENT, contact: { ...SAMPLE_CONTENT.contact, photo_url: "https://sb.example/x.png" } },
    }) as any,
  );
  await renderWithQueryClient(<StudioResumePage params={Promise.resolve({ resumeId: "resume-1" })} />);
  await waitFor(() => expect(useResumeStore.getState().storeResumeId ?? useResumeStore.getState().resumeId).toBe("resume-1"));
  expect(useResumeStore.getState().photoModalOpen).toBe(false);
});
```

Add `screen` to the `@testing-library/react` import in this file if not present.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/studio-resume-page.test.tsx`
Expected: FAIL — `photoModalOpen` stays `false` (no trigger wired); "requires a profile photo" text absent (modal not rendered).

- [ ] **Step 3: Edit `apps/web/app/(app)/studio/[resumeId]/page.tsx`**

3a. Imports:

```tsx
import { useRef } from "react";  // add to the existing "react" import
import { PhotoRequirementModal } from "@/components/resume/PhotoRequirementModal";
import { templateRequiresPhoto } from "@/lib/resume-templates";
import { getCareerProfile, type CareerProfileInput } from "@/lib/career-profile-client";
```

3b. Inside the component, near the other `useResumeStore` selectors, add:

```tsx
  const content = useResumeStore((s) => s.content);
  const setPhotoModal = useResumeStore((s) => s.setPhotoModal);
```

3c. Fetch the career profile (cache key must be `["careerProfile"]` — the same key `profile/page.tsx` invalidates and `PhotoRequirementModal` invalidates on "also save"):

```tsx
  const { data: careerProfile } = useQuery({
    queryKey: ["careerProfile"],
    queryFn: getCareerProfile,
    staleTime: 5 * 60 * 1000,
  });

  const profileForUpsert: CareerProfileInput | null = careerProfile
    ? {
        master_resume_id: careerProfile.master_resume_id,
        contact: careerProfile.contact,
        headline: careerProfile.headline,
        experience: careerProfile.experience,
        projects: careerProfile.projects,
        education: careerProfile.education,
        skills: careerProfile.skills,
        certifications: careerProfile.certifications,
        role_status: careerProfile.role_status,
        photo_url: careerProfile.photo_url,
        photo_path: careerProfile.photo_path,
      }
    : null;
```

3d. Auto-trigger effect — add after the existing effects:

```tsx
  // Prompt for a photo the first time the resume lands on a photo template
  // without one. prevTemplateIdRef starts null so this also fires on initial
  // hydration (setResume writes the real template id), not only on later
  // in-editor switches.
  const prevTemplateIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (storeResumeId !== resumeId || !content) return;
    const prev = prevTemplateIdRef.current;
    prevTemplateIdRef.current = templateId;
    if (templateId === prev) return;
    if (templateRequiresPhoto(templateId) && !content.contact.photo_url) {
      setPhotoModal(true, prev ?? undefined);
    }
  }, [templateId, storeResumeId, resumeId, content, setPhotoModal]);
```

3e. Render the modal — just before the closing `</div>` of the top-level return (alongside the floating AI panel):

```tsx
      <PhotoRequirementModal
        profilePhotoUrl={careerProfile === undefined ? undefined : careerProfile?.photo_url ?? null}
        profileForUpsert={profileForUpsert}
        onOpenProfile={() => {
          setPhotoModal(false);
          router.push("/profile");
        }}
      />
```

Note: `useQuery` returns `data: undefined` while loading and `null` when the query fn resolves `null` (no profile). The ternary maps "loading" → `undefined` (modal shows "Loading your profile…"), "no profile" → `null` (Case B), "has profile but no photo" → `null` (Case B — correct, they still need to upload), "has photo" → the URL (Case A).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/studio-resume-page.test.tsx`
Expected: PASS — including the two pre-existing tests. If the existing tests break because `QueryClientProvider` now needs the `careerProfile` query, they already wrap in `renderWithQueryClient`, so they should be fine; if `getCareerProfile` real impl runs (mock not applied), confirm the `vi.mock` factory path matches (`@/lib/career-profile-client`).

- [ ] **Step 5: Guard against a re-render loop**

Run: `cd apps/web && npx vitest run __tests__/studio-resume-page.test.tsx --reporter=verbose`
Expected: tests finish promptly (< 5s); no "Maximum update depth exceeded" warning. The effect's `content` dependency is a store reference that only changes on real edits, and `setPhotoModal` is stable — but confirm the console is clean.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(app)/studio/[resumeId]/page.tsx" apps/web/__tests__/studio-resume-page.test.tsx
git commit -m "$(cat <<'EOF'
feat: studio editor — auto-open the photo prompt for photo templates

Effect on templateId opens <PhotoRequirementModal> when the resume is on
a photo template with no content.contact.photo_url; career profile is
fetched under the shared ["careerProfile"] key.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WX7tabVdpzLnbHAsiSwEw2
EOF
)"
```

---

## Task 9: `EditorPanel` — remove the always-on field, add the conditional row

**Files:**
- Modify: `apps/web/components/resume/EditorPanel.tsx`
- Test: `apps/web/__tests__/components/EditorPanel.test.tsx` (update)

**Interfaces:**
- Consumes: `templateRequiresPhoto` (Task 2); `useResumeStore` `setPhotoModal` (Task 4).
- Produces: nothing downstream.

- [ ] **Step 1: Update the test**

In `apps/web/__tests__/components/EditorPanel.test.tsx`:

1. Change the photo-upload mock — the component no longer imports `uploadResumePhoto`:

```ts
// remove:  vi.mock("@/lib/photo-upload", () => ({ uploadResumePhoto: vi.fn() }));
```

Delete the `import { uploadResumePhoto } from "../../lib/photo-upload";` line and any test that exercised the old inline upload (search for `uploadResumePhoto` / "Upload Photo" in this file and remove/replace those cases).

2. Add:

```tsx
it("shows no photo controls in the contact tab for a text-only template", async () => {
  useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_clean");
  render(<EditorPanel />);
  await userEvent.click(screen.getByRole("tab", { name: "contact" }));
  expect(screen.queryByText(/profile photo/i)).not.toBeInTheDocument();
});

it("shows a 'choose photo' prompt in the contact tab for a photo template with no photo", async () => {
  useResumeStore.getState().setResume("resume-1", SAMPLE_CONTENT, "ats_sidebar");
  render(<EditorPanel />);
  await userEvent.click(screen.getByRole("tab", { name: "contact" }));
  const btn = screen.getByRole("button", { name: /choose photo/i });
  await userEvent.click(btn);
  expect(useResumeStore.getState().photoModalOpen).toBe(true);
});

it("shows the thumbnail + Remove for a photo template that already has a photo", async () => {
  useResumeStore.getState().setResume(
    "resume-1",
    { ...SAMPLE_CONTENT, contact: { ...SAMPLE_CONTENT.contact, photo_url: "https://sb.example/x.png" } },
    "ats_sidebar",
  );
  render(<EditorPanel />);
  await userEvent.click(screen.getByRole("tab", { name: "contact" }));
  expect(screen.getByRole("img", { name: /profile/i })).toHaveAttribute("src", "https://sb.example/x.png");
  await userEvent.click(screen.getByRole("button", { name: /remove photo/i }));
  expect(useResumeStore.getState().content!.contact.photo_url).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run __tests__/components/EditorPanel.test.tsx`
Expected: FAIL — old "Profile Photo" label still present for `ats_clean`; no "choose photo" button.

- [ ] **Step 3: Edit `apps/web/components/resume/EditorPanel.tsx`**

3a. Remove the import:

```tsx
// delete:
import { uploadResumePhoto } from "@/lib/photo-upload";
```

3b. Add:

```tsx
import { RESUME_TEMPLATES, templateRequiresPhoto } from "@/lib/resume-templates";
```

(merge with the existing `RESUME_TEMPLATES` import line).

3c. In the component body, delete `isUploadingPhoto`, `photoError` state and the whole `handlePhotoChange` function (lines ~35–36 and ~59–73). Add:

```tsx
  const setPhotoModal = useResumeStore((s) => s.setPhotoModal);
```

3d. Replace the entire "Profile Photo" `<div className="flex flex-col gap-xs">…</div>` block (the one starting with `<label …>Profile Photo</label>`, ~lines 239–266) with:

```tsx
            {templateRequiresPhoto(templateId) && (
              <div className="flex flex-col gap-xs">
                <label className="text-label-sm text-on-surface-variant">
                  Profile Photo <span className="text-primary">· required by this template</span>
                </label>
                {content.contact.photo_url ? (
                  <div className="flex items-center gap-md">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={content.contact.photo_url}
                      alt="Profile"
                      className="w-16 h-16 rounded-lg object-cover border border-outline-variant/30"
                    />
                    <button
                      type="button"
                      onClick={() => setPhotoModal(true)}
                      className="px-md py-sm rounded-lg border border-outline-variant text-label-sm text-primary hover:bg-surface-container-low transition-colors"
                    >
                      Change photo
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateContent({ contact: { ...content.contact, photo_url: undefined } })
                      }
                      className="px-md py-sm rounded-lg text-label-sm text-on-surface-variant hover:text-error transition-colors"
                    >
                      Remove photo
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-md">
                    <p className="text-caption text-on-surface-variant">
                      This template needs a profile photo. Manage your default in My Profile.
                    </p>
                    <button
                      type="button"
                      onClick={() => setPhotoModal(true)}
                      className="px-md py-sm rounded-lg bg-primary text-on-primary text-label-sm hover:opacity-90 transition-opacity shrink-0"
                    >
                      Choose photo
                    </button>
                  </div>
                )}
              </div>
            )}
```

Leave the rest of the contact tab (`CONTACT_FIELDS.map(...)`) untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run __tests__/components/EditorPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Type-check + broader run**

Run: `cd apps/web && npx tsc --noEmit && npx vitest run`
Expected: whole suite green. Fix any remaining reference to the removed `uploadResumePhoto` import in `EditorPanel` (there should be none — it now lives only in `PhotoRequirementModal`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/resume/EditorPanel.tsx apps/web/__tests__/components/EditorPanel.test.tsx
git commit -m "$(cat <<'EOF'
feat: EditorPanel — photo row only for photo templates

Removes the always-on Profile Photo upload; the contact tab now shows a
thumbnail + Change/Remove (or a "Choose photo" prompt) only when
templateRequiresPhoto(templateId).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WX7tabVdpzLnbHAsiSwEw2
EOF
)"
```

---

## Task 10: Confirm PDF template photo CSS

**Files:**
- Modify (if needed): `apps/api/templates/ats_professional.html`, `apps/api/templates/ats_sidebar.html`
- Test: `apps/api/tests/test_pdf.py` (extend, if a photo assertion is not already present)

**Interfaces:** none — server-side render only.

- [ ] **Step 1: Inspect the current `.photo` rules**

Run:
```bash
grep -n "\.photo" apps/api/templates/ats_professional.html apps/api/templates/ats_sidebar.html
```
Expected today:
- `ats_professional.html`: `.photo { width: 76px; height: 76px; border-radius: 4px; object-fit: cover; flex-shrink: 0; }`
- `ats_sidebar.html`: `.photo { width: 80px; height: 80px; border-radius: 4px; object-fit: cover; flex-shrink: 0; }`

Both already satisfy the spec (fixed box + `object-fit: cover` ⇒ crop-to-fill, no distortion; `border-radius: 4px` ⇒ square). **If both rules already contain `object-fit: cover` and an explicit `width`+`height`, make no change and skip to Step 3.**

- [ ] **Step 2: Normalise only if a rule is missing `object-fit: cover`**

If either `.photo` rule lacks `object-fit: cover` or an explicit `width`/`height`, set it to exactly (professional 76px, sidebar 80px):

```css
  .photo { width: 76px; height: 76px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
```

Do not change the `{% if contact.photo_url %}<img class="photo" src="{{ contact.photo_url }}">{% endif %}` markup.

- [ ] **Step 3: Add / confirm a render test**

In `apps/api/tests/test_pdf.py`, if there is no test that a photo template embeds the image, add one (match the file's existing style — it already renders templates to HTML/PDF):

```python
def test_sidebar_template_embeds_photo_when_present():
    content = _minimal_resume_content()  # or the fixture this file already uses
    content["contact"]["photo_url"] = "https://<trusted-supabase-host>/storage/v1/object/public/avatars/u/r.png"
    html = render_resume_html(content, template_id="ats_sidebar", line_spacing=1.25, paragraph_spacing=12)
    assert 'class="photo"' in html
    assert "object-fit: cover" in html


def test_sidebar_template_omits_photo_when_absent():
    content = _minimal_resume_content()
    content["contact"].pop("photo_url", None)
    html = render_resume_html(content, template_id="ats_sidebar", line_spacing=1.25, paragraph_spacing=12)
    assert 'class="photo"' not in html
```

Use whatever the file's real helper names are (`render_resume_html` / fixture) — read the top of `test_pdf.py` first. If a trusted-host constant exists in `pdf.py` for the sanitizer, reuse it so the URL passes `_sanitize_photo_url`.

- [ ] **Step 4: Run the API tests**

Run: `cd apps/api && .venv/Scripts/python -m pytest tests/test_pdf.py -q` (Windows path; use `.venv/bin/pytest` on POSIX)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/templates/ats_professional.html apps/api/templates/ats_sidebar.html apps/api/tests/test_pdf.py
git commit -m "$(cat <<'EOF'
test: pin photo-template CSS to object-fit: cover (no distortion)

Confirms ats_sidebar / ats_professional crop the photo to a fixed box
instead of stretching, and omit the <img> when no photo_url is set.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WX7tabVdpzLnbHAsiSwEw2
EOF
)"
```

---

## Task 11: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Web unit suite**

Run: `cd apps/web && npx vitest run`
Expected: all green, including `photo-upload`, `resume-templates`, `resume-store`, `career-profile-client`, `ProfilePhotoCard`, `ProfilePage`, `PhotoRequirementModal`, `EditorPanel`, `studio-resume-page`.

- [ ] **Step 2: Types + lint + build**

Run: `cd apps/web && npx tsc --noEmit && npm run lint && npm run build`
Expected: no errors. (`AGENTS.md` note: this is a customised Next.js — if the build flags an App Router API change touched by the studio page edits, consult `node_modules/next/dist/docs/` as instructed there.)

- [ ] **Step 3: API tests**

Run: `cd apps/api && .venv/Scripts/python -m pytest -q`
Expected: green (only `test_pdf.py` was touched).

- [ ] **Step 4: Manual QA (dev servers)**

Start via the `run-ai-copilot` skill or the repo's usual `npm run dev`. Then walk the spec's checklist:

1. My Profile → upload photo → Save → reload → photo persists.
2. New blank resume on `ats_clean` → Contact tab shows **no** photo UI.
3. With a profile photo set, switch template to **Sidebar** → modal Case A → **Use Profile Photo** → Generate PDF shows the photo; My Profile photo unchanged.
4. Delete the profile photo in My Profile; new resume → **Sidebar** → modal Case B → **Upload Photo** with "Also save to my profile" checked → My Profile now shows that image.
5. **Sidebar** again → Case A → **Upload a Different Photo**, checkbox off → resume PDF shows the new image; My Profile still shows the original.
6. Open the modal, click **Cancel** → template reverts to the previously selected one.
7. Case B → **Open My Profile** → lands on `/profile`; return to the resume → prompt reappears (photo still unset).
8. Feed a tall portrait JPG and a wide landscape JPG as the photo → both render un-stretched (cropped square) in `ats_sidebar` and `ats_professional` PDFs.
9. Upload a `.gif` / an 8 MB file in the modal → inline error, modal stays open.

- [ ] **Step 5: Confirm the migration is documented for deploy**

Verify `apps/web/supabase/migrations/005_career_profile_photo.sql` exists and note in the PR description that it must be run in the Supabase SQL editor (no automated runner), same as `001`–`004`.

---

## Self-Review

**1. Spec coverage**

| Spec section | Task(s) |
|---|---|
| Photo upload only in My Profile; stored in Supabase Storage, associated with profile | 1 (`uploadProfilePhoto`), 3 (columns), 6 (wire-in) |
| No separate permanent photo field in Resume Builder | 9 (remove always-on field) |
| Case A — profile has a photo → Use / Upload Different | 7 (modal), 8 (trigger) |
| "Upload a Different Photo" doesn't replace profile photo unless chosen | 7 (`alsoSaveToProfile`, default off in Case A) |
| Case B — no profile photo → Upload / Open My Profile | 7, 8 |
| Case C — non-photo template shows no photo UI / no prompt | 8 (`templateRequiresPhoto` guard), 9 (row hidden) |
| Image formatting: auto scale/crop, keep aspect ratio, no distortion, square/portrait/circular, at preview/export | 2 (`shape` descriptor), 10 (`object-fit: cover` per template) |
| Data & storage: Profile Photo vs Resume-Specific Photo distinction | 1 (two keys), 3 (columns), 7 (writes `content.contact.photo_url`; profile only via checkbox) |
| Expected flow (template → requires? → has profile photo? → …) | 8 (effect), 7 (branches) |
| "Do not duplicate profile-photo functionality" | 9 (single removal), 1 (shared helpers), 2 (single source of truth) |
| Migration | 3 |

No gaps.

**2. Placeholder scan** — no "TBD"/"handle edge cases"/"similar to Task N". Every code step has literal code. Fallback instructions (e.g. "if `UserCircle` is not exported…") are concrete alternatives, not deferrals.

**3. Type consistency**

- `uploadProfilePhoto(file): Promise<{ url: string; path: string }>` — defined Task 1, consumed identically in Tasks 6 and 7.
- `templateRequiresPhoto(id: string): boolean` — Task 2, consumed Tasks 8 and 9.
- `setPhotoModal(open: boolean, revertTo?: string | null)` — Task 4, called in Tasks 7 (`setPhotoModal(false)` / via `close`), 8 (`setPhotoModal(true, prev ?? undefined)`), 9 (`setPhotoModal(true)`).
- `photoModalRevertTo` (not `revertTo` / `photoModalRevertTemplate`) — consistent Tasks 4, 7.
- `CareerProfile.photo_url` / `photo_path` (snake_case, matching the DB columns and the rest of `CareerProfile`) — Tasks 3, 6, 7, 8.
- `ProfilePhotoCardProps` field `onFileSelected` (not `onUpload` / `onFile`) — Tasks 5, 6.
- Query key `["careerProfile"]` — consistent across Task 8 (fetch), Task 7 (`invalidateQueries`), and the existing `profile/page.tsx` (`invalidateQueries` on save). Matches spec §4.
- `PhotoRequirementModalProps`: `profilePhotoUrl`, `profileForUpsert`, `onOpenProfile` — Tasks 7, 8.

No mismatches found.

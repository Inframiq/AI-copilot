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

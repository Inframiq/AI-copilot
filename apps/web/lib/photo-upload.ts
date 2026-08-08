import { createBrowserClient } from "@/lib/supabase";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Uploads a resume profile photo to the public "avatars" Supabase Storage
 * bucket and returns its public URL. The bucket must be created (public)
 * in the Supabase dashboard — Storage → New bucket → "avatars" → Public.
 */
export async function uploadResumePhoto(resumeId: string, file: File): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error("Photo must be a JPEG, PNG, or WebP image.");
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error("Photo must be smaller than 5MB.");
  }

  const supabase = createBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${user.id}/${resumeId}.${ext}`;

  const { error } = await supabase.storage.from("avatars").upload(path, file, {
    upsert: true,
    contentType: file.type,
  });
  if (error) throw error;

  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return data.publicUrl;
}

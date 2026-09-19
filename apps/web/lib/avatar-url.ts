"use client";
import { useQuery } from "@tanstack/react-query";
import { createBrowserClient } from "@/lib/supabase";

/** How long a signed photo link lasts. Refreshed well before it runs out. */
const SIGNED_URL_SECONDS = 60 * 60;

/**
 * The object key a stored photo URL names in the "avatars" bucket, or null.
 *
 * Photo URLs are stored in the public-URL shape (`/object/public/avatars/…`)
 * because that is what they were while the bucket was public, and every
 * saved résumé and profile still carries one. The bucket is private now, so
 * the shape is only an identifier: the object is read through a signed link.
 */
export function avatarPath(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const { pathname } = new URL(url);
    const match = /^\/storage\/v1\/object\/(?:public|sign|authenticated)\/avatars\/(.+)$/.exec(pathname);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Something an <img> can load for a stored photo URL: a short-lived signed
 * link into the private bucket. null while it is being fetched, or when there
 * is no photo. A URL that isn't one of ours (a data: URI, say) passes through.
 */
export function useAvatarSrc(url: string | null | undefined): string | null {
  const path = avatarPath(url);
  const { data } = useQuery({
    // The whole URL, not just the path: its ?v= changes when a photo is
    // replaced at the same path, and that has to fetch a fresh link.
    queryKey: ["avatarSrc", url],
    queryFn: async () => {
      const { data, error } = await createBrowserClient()
        .storage.from("avatars")
        .createSignedUrl(path!, SIGNED_URL_SECONDS);
      if (error) throw error;
      return data.signedUrl;
    },
    enabled: path !== null,
    staleTime: (SIGNED_URL_SECONDS / 2) * 1000,
    retry: false,
  });
  if (!url) return null;
  if (path === null) return url;
  return data ?? null;
}

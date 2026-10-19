import { createBrowserClient as _createBrowserClient } from "@supabase/ssr";
import { createServerClient as _createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";

// Use empty-string fallbacks so the app boots in local preview mode
// (where Supabase is not configured). Auth calls will simply fail gracefully.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// The session cookies carry a live access and refresh token, so they must
// never travel over plain HTTP (test WEB-002). `@supabase/ssr` defaults to
// path "/" and SameSite=Lax but leaves Secure off, so set it here — off only
// in development, where the dev server is http://localhost. Not HttpOnly:
// the browser client reads the session straight from document.cookie, so a
// server-hidden cookie would end every session the moment the page loaded.
export const SESSION_COOKIE_OPTIONS: CookieOptions = {
  secure: process.env.NODE_ENV !== "development",
};

// `@supabase/ssr`'s browser client is meant to be created once and reused —
// each instance re-parses cookies and re-inits the auth/storage layer. The
// old code built a fresh one on every `getToken()` (i.e. every API request),
// which added measurable latency when a page fired several queries at once
// (dashboard mount, the credit meter, etc.). Memoise it per tab.
let browserClient: ReturnType<typeof _createBrowserClient> | undefined;

export function createBrowserClient() {
  if (typeof window === "undefined") {
    // SSR/prerender: don't cache a client tied to a request-less context.
    return _createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookieOptions: SESSION_COOKIE_OPTIONS,
    });
  }
  browserClient ??= _createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
  });
  return browserClient;
}

export function createServerClient(
  cookieStore: {
    getAll: () => { name: string; value: string }[];
    set: (name: string, value: string, options: CookieOptions) => void;
  }
) {
  return _createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });
}

/**
 * Sign out, and always end the session in this browser. A failed server
 * sign-out (network down) left Supabase's session in place, and signed-in
 * visitors to /login are sent back to the app (middleware.ts), so the user
 * could not log out at all. The local sign-out needs no network.
 */
export async function signOutHere() {
  const supabase = createBrowserClient();
  try {
    await supabase.auth.signOut();
  } catch {
    // fall through to the local sign-out
  }
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // nothing left to clear
  }
}

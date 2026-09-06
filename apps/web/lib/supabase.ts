import { createBrowserClient as _createBrowserClient } from "@supabase/ssr";
import { createServerClient as _createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";

// Use empty-string fallbacks so the app boots in local preview mode
// (where Supabase is not configured). Auth calls will simply fail gracefully.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// `@supabase/ssr`'s browser client is meant to be created once and reused —
// each instance re-parses cookies and re-inits the auth/storage layer. The
// old code built a fresh one on every `getToken()` (i.e. every API request),
// which added measurable latency when a page fired several queries at once
// (dashboard mount, the credit meter, etc.). Memoise it per tab.
let browserClient: ReturnType<typeof _createBrowserClient> | undefined;

export function createBrowserClient() {
  if (typeof window === "undefined") {
    // SSR/prerender: don't cache a client tied to a request-less context.
    return _createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  browserClient ??= _createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return browserClient;
}

export function createServerClient(
  cookieStore: {
    getAll: () => { name: string; value: string }[];
    set: (name: string, value: string, options: CookieOptions) => void;
  }
) {
  return _createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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

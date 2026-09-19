/**
 * The Content-Security-Policy for every page, built per request around a
 * fresh nonce (see middleware.ts). Its job is to make an injected <script>
 * inert: only scripts carrying this request's nonce run, plus whatever those
 * scripts load themselves ('strict-dynamic'), which is how Next's chunks and
 * the Vercel analytics scripts get in.
 *
 * Styles allow 'unsafe-inline' on purpose: the server-rendered HTML carries
 * style attributes, and the Studio writes a <style> into the résumé's shadow
 * root. Injected CSS can't run code, so this costs little.
 */
export function buildCsp(
  nonce: string,
  { apiUrl, supabaseUrl, isDev }: { apiUrl?: string; supabaseUrl?: string; isDev: boolean },
): string {
  const origin = (url?: string) => {
    try {
      return url ? new URL(url).origin : "";
    } catch {
      return "";
    }
  };
  const api = origin(apiUrl);
  const supabase = origin(supabaseUrl);
  const supabaseWs = supabase.replace(/^https:/, "wss:");

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'unsafe-eval' only in development: React uses eval there to rebuild
    // server error stacks. Production needs neither.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    // Photos come through Supabase signed links; PDF thumbnails and the
    // placeholder avatar are data: URIs.
    "img-src": ["'self'", "data:", "blob:", supabase],
    "font-src": ["'self'", "data:"],
    // The API, Supabase auth/database/storage, and Vercel's analytics
    // endpoints (same origin, under /_vercel).
    "connect-src": ["'self'", api, supabase, supabaseWs],
    // The résumé preview iframe shows either a signed Storage link or the
    // PDF the API returned as a data: URI.
    "frame-src": ["'self'", "data:", "blob:", supabase],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  const policy = Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.filter(Boolean).join(" ")}`)
    .join("; ");
  return isDev ? policy : `${policy}; upgrade-insecure-requests`;
}

/** A fresh, unguessable nonce for one request. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

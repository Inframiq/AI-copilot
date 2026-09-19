/**
 * An address safe to put in an href, or null.
 *
 * Links on these pages come from what users typed, and some are shown to
 * other users (a networking profile). A `javascript:` or `data:` address in
 * an href runs in our origin when clicked. React 19 happens to block
 * `javascript:` today; this doesn't lean on that. Only http(s) survives, and
 * a bare domain ("linkedin.com/in/x") gets https:// added, as the résumé
 * templates do (pdf.py's _as_http_url).
 */
export function safeHref(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, createNonce } from "@/lib/csp";
import { SESSION_COOKIE_OPTIONS } from "@/lib/supabase";

// kripax.inframiq.com is live and confirmed working (Google Sign-In tested
// end to end on 2026-09-14) — resumebuilder.inframiq.com now 308-redirects
// here instead of serving its own copy of the app.
const OLD_DOMAIN_CUTOVER_LIVE = true;
const OLD_HOST = "resumebuilder.inframiq.com";
const NEW_HOST = "kripax.inframiq.com";

// Mirrors app/core/config.py's ADMIN_ONLY_EMAILS on the backend — these
// accounts have no normal app access at all, only the /admin dashboard.
// The backend still enforces this on every API call regardless of what
// happens here; this just keeps an admin-only account from landing on a
// normal page shell before its first API call 403s.
const ADMIN_ONLY_EMAILS = ["bharathrockz.k@gmail.com", "tanishqkundrapu@gmail.com"];

// Pages only a signed-out visitor needs: someone signed in is sent to the app.
const SIGNED_IN_ELSEWHERE = ["/", "/login", "/register"];

export async function middleware(request: NextRequest) {
  if (OLD_DOMAIN_CUTOVER_LIVE) {
    const host = request.headers.get("host") ?? "";
    if (host === OLD_HOST || host.startsWith(`${OLD_HOST}:`)) {
      const url = request.nextUrl.clone();
      url.protocol = "https";
      url.hostname = NEW_HOST;
      url.port = "";
      return NextResponse.redirect(url, 308);
    }
  }

  // A fresh nonce per request. Next reads it from the request's CSP header
  // and stamps it on every script it renders; the root layout reads x-nonce
  // for its own inline script.
  const nonce = createNonce();
  const csp = buildCsp(nonce, {
    apiUrl: process.env.NEXT_PUBLIC_API_URL,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    isDev: process.env.NODE_ENV === "development",
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);

  // Skip Supabase when running with placeholder credentials (local preview)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const isPlaceholder = supabaseUrl.includes("placeholder");

  let user: { id: string; email?: string | null } | null = null;

  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!isPlaceholder && supabaseAnonKey) {
    const supabase = createServerClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        cookieOptions: SESSION_COOKIE_OPTIONS,
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: (cookies) => {
            cookies.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
          },
        },
      }
    );
    // Refresh session if expired — required for Server Components
    const { data } = await supabase.auth.getUser();
    user = data.user;
  }

  const { pathname } = request.nextUrl;

  // Every page needs a sign-in unless it is listed here (test ATK-001). A
  // list of protected pages instead had already missed /cover-letters; a
  // page added later is protected without anyone remembering to add it.
  const PUBLIC_PATHS = [
    "/",
    "/login",
    "/register",
    "/callback",
    "/privacy",
    "/terms",
    "/refunds",
    "/cookies",
    "/data-deletion",
  ];

  // Files, not pages: the public/ folder (logos, template previews,
  // security.txt), robots.txt, sitemap.xml and the app icon. No page path
  // has a dot in its last segment.
  const isFile = /\.[a-z0-9]+$/i.test(pathname) || pathname.startsWith("/.well-known/");

  const isPublic =
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/_next") ||
    isFile;

  const isProtected = !isPublic;

  // Signed in, the home page and the sign-in screens are the wrong place to
  // land: the KripaX logo on the legal pages (linked from Account) points at
  // "/", and the marketing page's "Sign In" there read as being logged out.
  // Their place is the app.
  if (user && SIGNED_IN_ELSEWHERE.includes(pathname)) {
    const appUrl = request.nextUrl.clone();
    appUrl.pathname = user.email && ADMIN_ONLY_EMAILS.includes(user.email.toLowerCase()) ? "/admin" : "/dashboard";
    appUrl.search = "";
    const redirectResponse = NextResponse.redirect(appUrl);
    // Keep any session cookies Supabase just refreshed on `response`.
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  // Auth redirect disabled in placeholder/preview mode
  if (!isPlaceholder && !isPublic && isProtected && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  // Admin-only accounts have no normal app access — bounce them off any
  // other protected route to the admin dashboard before they land on a page
  // shell whose data calls would just 403 anyway (the backend is the real
  // enforcement point; this is just a smoother redirect).
  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");
  if (
    user?.email &&
    isProtected &&
    !isAdminRoute &&
    ADMIN_ONLY_EMAILS.includes(user.email.toLowerCase())
  ) {
    const adminUrl = request.nextUrl.clone();
    adminUrl.pathname = "/admin";
    // NextResponse.redirect(...) builds a brand-new response, which would
    // silently drop any refreshed session cookies Supabase just wrote onto
    // `response` above — copy them across so a token refresh on this exact
    // request isn't lost.
    const redirectResponse = NextResponse.redirect(adminUrl);
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

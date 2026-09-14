import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// kripax.inframiq.com is live and confirmed working (Google Sign-In tested
// end to end on 2026-09-14) — resumebuilder.inframiq.com now 308-redirects
// here instead of serving its own copy of the app.
const OLD_DOMAIN_CUTOVER_LIVE = true;
const OLD_HOST = "resumebuilder.inframiq.com";
const NEW_HOST = "kripax.inframiq.com";

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

  let response = NextResponse.next({ request });

  // Skip Supabase when running with placeholder credentials (local preview)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const isPlaceholder = supabaseUrl.includes("placeholder");

  let user: { id: string } | null = null;

  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!isPlaceholder && supabaseAnonKey) {
    const supabase = createServerClient(
      supabaseUrl,
      supabaseAnonKey,
      {
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

  const PROTECTED_PREFIXES = ["/dashboard", "/studio", "/jd", "/interview", "/career-path", "/networking", "/analytics", "/profile", "/onboarding", "/account", "/plans"];
  const PUBLIC_PATHS = [
    "/",
    "/login",
    "/register",
    "/callback",
    "/privacy",
    "/terms",
  ];

  const isPublic =
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico");

  const isProtected = PROTECTED_PREFIXES.some((prefix) =>
    pathname === prefix || pathname.startsWith(prefix + "/")
  );

  // Auth redirect disabled in placeholder/preview mode
  if (!isPlaceholder && !isPublic && isProtected && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

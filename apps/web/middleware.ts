import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
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

  const PROTECTED_PREFIXES = ["/dashboard", "/studio", "/jd", "/interview", "/career-path", "/networking", "/analytics", "/profile"];
  const PUBLIC_PATHS = [
    "/",
    "/login",
    "/register",
    "/callback",
    "/forgot-password",
    "/reset-password",
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

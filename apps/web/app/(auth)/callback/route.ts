import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

/** Only allow same-origin relative paths, e.g. "/dashboard" — rejects
 * absolute/protocol-relative URLs like "https://evil.com" or "//evil.com"
 * that `new URL(next, request.url)` would otherwise resolve off-site. */
export function safeNextPath(next: string | null): string {
  if (next && /^\/(?!\/|\\)/.test(next)) {
    return next;
  }
  return "/dashboard";
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next");
  const next = safeNextPath(rawNext);

  if (code) {
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (cs) =>
            cs.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            ),
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Only the plain login/register flow (no explicit `next`, e.g. password
      // reset's next=/reset-password) should ever land on onboarding — first
      // sign-in for an account with no career_profiles row yet.
      if (rawNext === null) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const { data: profile } = await supabase
            .from("career_profiles")
            .select("user_id")
            .eq("user_id", user.id)
            .maybeSingle();
          if (!profile) {
            return NextResponse.redirect(new URL("/onboarding", request.url));
          }
        }
      }
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  // Return to login with error if code exchange failed
  return NextResponse.redirect(new URL("/login?error=auth", request.url));
}

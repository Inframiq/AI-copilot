import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { TERMS_VERSION, PRIVACY_VERSION } from "@/lib/legal-versions";

/** Only allow same-origin relative paths, e.g. "/dashboard" — rejects
 * absolute/protocol-relative URLs like "https://evil.com" or "//evil.com"
 * that `new URL(next, request.url)` would otherwise resolve off-site. */
export function safeNextPath(next: string | null): string {
  if (next && /^\/(?!\/|\\)/.test(next)) {
    return next;
  }
  return "/dashboard";
}

/** Records which Terms/Privacy version this user last agreed to, and when.
 * The login/register checkbox itself doesn't survive the Google OAuth
 * redirect, so this is the durable, server-side evidence of consent — every
 * successful sign-in re-records it against whatever version is current.
 * Best-effort: a failure here must never block sign-in itself. */
async function recordPolicyAcceptance(accessToken: string): Promise<void> {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) return;
  try {
    await fetch(`${base}/me/policy-acceptance`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        terms_version: TERMS_VERSION,
        privacy_version: PRIVACY_VERSION,
      }),
    });
  } catch {
    // Non-fatal — sign-in must not depend on this succeeding.
  }
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
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.access_token) {
        await recordPolicyAcceptance(session.access_token);
      }

      // Only the plain login/register flow (no explicit `next`) should ever
      // land on onboarding — first sign-in for an account with no
      // career_profiles row yet.
      if (rawNext === null && session?.user) {
        const { data: profile } = await supabase
          .from("career_profiles")
          .select("user_id")
          .eq("user_id", session.user.id)
          .maybeSingle();
        if (!profile) {
          return NextResponse.redirect(new URL("/onboarding", request.url));
        }
      }
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  // Return to login with error if code exchange failed
  return NextResponse.redirect(new URL("/login?error=auth", request.url));
}

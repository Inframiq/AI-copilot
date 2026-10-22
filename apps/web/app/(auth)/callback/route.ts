import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { TERMS_VERSION, PRIVACY_VERSION } from "@/lib/legal-versions";
import { SESSION_COOKIE_OPTIONS } from "@/lib/supabase";

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
      // A down or cold-starting API must not hold the sign-in redirect.
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Non-fatal — sign-in must not depend on this succeeding.
  }
}

/** Keeps a logged value to a short slug: what arrives in the URL is the
 * caller's to choose, and a newline in it would forge a second log line. */
function slug(value: string | null | undefined): string {
  return (value ?? "").replace(/[^A-Za-z0-9_.:-]/g, "?").slice(0, 60) || "-";
}

/** One line in the host's log for every failed sign-in (test INF-004), in
 * the API's security_event shape: why it failed and from where. Never the
 * one-time code, a cookie or a token — whoever reads the log must not be
 * able to finish someone's sign-in with it. */
export function logFailedSignIn(
  request: NextRequest,
  reason: "provider_error" | "missing_code" | "exchange_failed",
  detail?: string | null
): void {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  console.warn(
    `security_event=sign_in_failed reason=${reason} detail=${slug(detail)} ip=${slug(ip)}`
  );
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
        cookieOptions: SESSION_COOKIE_OPTIONS,
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
    if (error) {
      logFailedSignIn(request, "exchange_failed", error.code ?? String(error.status ?? ""));
    }

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

  if (!code) {
    // Google or Supabase sends ?error=access_denied (and the like) when the
    // sign-in was cancelled or refused before a code was issued.
    const providerError = searchParams.get("error");
    logFailedSignIn(request, providerError ? "provider_error" : "missing_code", providerError);
  }

  // Return to login with error if code exchange failed
  return NextResponse.redirect(new URL("/login?error=auth", request.url));
}

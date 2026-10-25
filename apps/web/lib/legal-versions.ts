// Machine-readable version identifiers for the Terms of Service and Privacy
// Policy, recorded against a user's account (via PUT /me/policy-acceptance)
// so "which version did this user agree to, and when" is provable rather
// than just a checkbox state that vanishes after the OAuth redirect. Bump
// whichever one changes in substance when editing app/terms or app/privacy —
// keep in sync with each page's own LAST_UPDATED display string.
export const TERMS_VERSION = "2026-09-19";
export const PRIVACY_VERSION = "2026-09-19";

// Carries the login/register checkbox across the Google redirect. Only
// /callback reads it, and records agreement only when it is there: a
// sign-in started without the checkbox (straight at Supabase, test ATK-037)
// gets no record, so PolicyUpdatePrompt asks before the app can be used.
export const POLICY_CONSENT_COOKIE = "kripax_policy_consent";
export const POLICY_CONSENT_VALUE = `${TERMS_VERSION}|${PRIVACY_VERSION}`;

/** Called by the login/register button once the checkbox is ticked. */
export function markPolicyConsent(): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${POLICY_CONSENT_COOKIE}=${encodeURIComponent(POLICY_CONSENT_VALUE)}` +
    `; Path=/callback; Max-Age=900; SameSite=Lax${secure}`;
}

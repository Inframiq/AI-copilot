// Machine-readable version identifiers for the Terms of Service and Privacy
// Policy, recorded against a user's account (via PUT /me/policy-acceptance)
// so "which version did this user agree to, and when" is provable rather
// than just a checkbox state that vanishes after the OAuth redirect. Bump
// whichever one changes in substance when editing app/terms or app/privacy —
// keep in sync with each page's own LAST_UPDATED display string.
export const TERMS_VERSION = "2026-09-19";
export const PRIVACY_VERSION = "2026-09-19";

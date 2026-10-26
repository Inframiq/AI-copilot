/**
 * A sign-in token must never sit in the address bar (batch mate's OAUTH-005).
 *
 * The site signs in with PKCE: Google hands back a one-time code in ?code=,
 * and /callback swaps it for a session in a cookie. But a hand-made sign-in
 * link without the PKCE challenge makes Supabase use its older implicit flow,
 * and when that link's redirect isn't on the allow list Supabase falls back
 * to the site itself with the tokens in the fragment:
 * https://kripax.inframiq.com/#access_token=...&refresh_token=...
 *
 * The fragment never reaches a server, but it stays on screen and in the
 * browser's history, where anyone who copies the address can use it. So
 * before anything else runs, this script takes it out of the address (the
 * same history entry, so Back can't bring it back) and ends that session,
 * so a copy made before it ran is no use either. Nothing on the site uses
 * an implicit-flow session.
 *
 * Built at render time from the public Supabase URL and anon key (both are
 * in every page's JavaScript already); JSON.stringify quotes them.
 */
export function urlTokenGuardScript(supabaseUrl: string, anonKey: string): string {
  return (
    "try{var h=location.hash;" +
    'if(/(^#|&)(access_token|refresh_token|provider_token|provider_refresh_token)=/.test(h)){' +
    'var t=new URLSearchParams(h.slice(1)).get("access_token");' +
    'history.replaceState(history.state,"",location.pathname+location.search);' +
    `if(t)fetch(${JSON.stringify(supabaseUrl + "/auth/v1/logout?scope=local")},` +
    `{method:"POST",keepalive:true,headers:{apikey:${JSON.stringify(anonKey)},Authorization:"Bearer "+t}}).catch(function(){});` +
    "}}catch(e){}"
  );
}

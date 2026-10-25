"use client";

import { useEffect } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { createBrowserClient, leaveSignedOut } from "@/lib/supabase";

/**
 * Keeps a signed-out tab off the signed-in pages (test ATK-008).
 *
 * - Signed out anywhere (another tab, the session ended on the server, a
 *   refresh refused): Supabase reports SIGNED_OUT, and the page leaves for
 *   the sign-in page instead of staying on screen with its data.
 * - Back or Forward can restore a page whole from the browser's memory
 *   (the back/forward cache) without asking the server, so middleware never
 *   sees it. A restored page with no session leaves the same way.
 * - A page drawn for one account never stays on screen for another (test
 *   ATK-049): A signs out, B signs in in the same browser, and Back brings
 *   A's page out of that memory — or B signs in from another tab while A's
 *   page is open here. Both are sent to B's own dashboard instead.
 */
export function SessionGuard() {
  useEffect(() => {
    const supabase = createBrowserClient();
    // Whose page this is: the account signed in when it was drawn.
    let owner: string | null | undefined;
    const note = (session: Session | null) => {
      if (owner === undefined) owner = session?.user?.id ?? null;
    };
    const someoneElse = (session: Session | null) =>
      !!owner && !!session?.user?.id && session.user.id !== owner;
    void supabase.auth
      .getSession()
      .then(({ data }: { data: { session: Session | null } }) => note(data.session));
    const { data } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        if (event === "SIGNED_OUT") leaveSignedOut();
        else if (someoneElse(session)) leaveForAnotherAccount();
        else note(session);
      }
    );
    async function onPageShow(event: PageTransitionEvent) {
      if (!event.persisted) return;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) leaveSignedOut();
      else if (someoneElse(session)) leaveForAnotherAccount();
    }
    window.addEventListener("pageshow", onPageShow);
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);
  return null;
}

/** A full page load, so nothing of the previous account's page survives in
 * memory; the dashboard is the one page every account has. */
function leaveForAnotherAccount() {
  window.location.replace("/dashboard");
}

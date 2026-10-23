"use client";

import { useEffect } from "react";
import type { AuthChangeEvent } from "@supabase/supabase-js";
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
 */
export function SessionGuard() {
  useEffect(() => {
    const supabase = createBrowserClient();
    const { data } = supabase.auth.onAuthStateChange((event: AuthChangeEvent) => {
      if (event === "SIGNED_OUT") leaveSignedOut();
    });
    async function onPageShow(event: PageTransitionEvent) {
      if (!event.persisted) return;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) leaveSignedOut();
    }
    window.addEventListener("pageshow", onPageShow);
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);
  return null;
}

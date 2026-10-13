"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase";

/**
 * The way back from a legal page. Signed in (Account links here), the way
 * back is the dashboard, and "Back to home" read as leaving the app. Until
 * the session check answers it links home, which the middleware sends a
 * signed-in visitor on to the dashboard anyway.
 */
export function LegalBackLink() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    createBrowserClient()
      .auth.getSession()
      .then((res: { data: { session: unknown } }) => {
        if (!cancelled) setSignedIn(!!res.data.session);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Link
      href={signedIn ? "/dashboard" : "/"}
      className="text-label-md text-on-surface-variant hover:text-on-surface transition-colors"
    >
      {signedIn ? "Back to dashboard" : "Back to home"}
    </Link>
  );
}

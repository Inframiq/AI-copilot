"use client";
import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react";
import { FOCUS_RING } from "@/lib/focus";

/**
 * The way out of sign-in and sign-up.
 *
 * Both screens are reachable directly — from the landing page's CTAs, from a
 * bookmark, from an expired session's redirect — and neither offered any way
 * back, so a user who did not want to sign in had only the browser's Back
 * button, which does nothing on a fresh tab. Home is the one screen that
 * genuinely sits before both.
 *
 * <Link> rather than <a>: these pages already live in the app, and a full
 * document load to get back to the landing page throws away the router and
 * re-downloads it.
 */
export function AuthBackLink() {
  return (
    <Link
      href="/"
      className={`inline-flex items-center gap-xs rounded-lg text-label-sm text-on-surface-variant transition-colors hover:text-on-surface ${FOCUS_RING}`}
    >
      <ArrowLeft size={16} />
      Back to home
    </Link>
  );
}

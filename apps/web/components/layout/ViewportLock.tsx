"use client";
import { useEffect } from "react";

/**
 * Keeps the page itself from ever scrolling under a full-screen app layout.
 *
 * The app and builder layouts are exactly one screen tall and scroll inside
 * their own panes. If anything outside them makes the page taller — a
 * browser extension adding its own elements (Monica, Grammarly, password
 * managers), or something portaled to <body> — the browser lets the page
 * scroll too: reach the end of a list, keep scrolling, and the whole app
 * slides up off the screen, header and all, over blank page. Testers met it
 * on the tailoring review as an "infinite scroll".
 *
 * Two layers: globals.css locks <html>/<body> while a [data-app-shell] is on
 * screen, so the page can't be scrolled by the user; this puts it back if
 * anything scrolls it from code (focus, scrollIntoView, an extension).
 * Render it inside the element that carries data-app-shell.
 */
export function ViewportLock() {
  useEffect(() => {
    const reset = () => {
      if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
    };
    reset();
    // Fires only for the page's own scroll, not the panes inside it.
    window.addEventListener("scroll", reset, { passive: true });
    return () => window.removeEventListener("scroll", reset);
  }, []);
  return null;
}

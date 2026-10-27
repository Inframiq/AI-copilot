"use client";
import { useEffect } from "react";
import { leaveWarningsStoodDown } from "@/lib/leave-warnings";

// Marks the extra history entry that lets the browser's Back be asked about.
const GUARD_KEY = "kripaxLeaveGuard";

let releasing = false;
// Warnings in force right now. React may unmount and remount an effect at
// once (development's double run), so the tidy-up below waits for none.
let activeCount = 0;

/**
 * Asks before leaving while `active` — work that exists only in memory and
 * would be lost. Covers every way out:
 *  • refresh, closing the tab, another site → the browser's own prompt
 *  • an in-app link (sidebar, nav, any <a>) → confirm(message)
 *  • the browser's Back → confirm(message)
 *
 * Back can't be cancelled once it happens, so while active an extra history
 * entry for this same page sits on top: Back lands on the real one (still
 * this page), and the question decides whether to go on back or to put the
 * extra entry back. Call releaseLeaveWarning() before navigating away on
 * purpose (after the work is saved), so that entry doesn't linger.
 *
 * A security exit (signed out, another account) never asks: see
 * lib/leave-warnings.ts.
 */
export function useLeaveWarning(active: boolean, message: string): void {
  useEffect(() => {
    if (!active) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (leaveWarningsStoodDown()) return;
      e.preventDefault();
      e.returnValue = "";
    };

    // Capture phase, so the navigation is cancelled before Next's <Link>
    // click handler runs.
    const onDocClick = (e: MouseEvent) => {
      if (leaveWarningsStoodDown()) return;
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || anchor.target === "_blank") return;
      const dest = new URL(href, window.location.href);
      // Another site is the browser's own prompt (beforeunload), not a second one.
      if (dest.origin !== window.location.origin || dest.pathname === window.location.pathname) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    if (!window.history.state?.[GUARD_KEY]) {
      window.history.pushState({ ...window.history.state, [GUARD_KEY]: true }, "", window.location.href);
    }
    const onPopState = () => {
      if (releasing || leaveWarningsStoodDown() || window.history.state?.[GUARD_KEY]) return;
      if (window.confirm(message)) {
        detach();
        window.history.back();
      } else {
        window.history.pushState({ ...window.history.state, [GUARD_KEY]: true }, "", window.location.href);
      }
    };

    function detach() {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onDocClick, true);
      window.removeEventListener("popstate", onPopState);
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onDocClick, true);
    window.addEventListener("popstate", onPopState);
    const path = window.location.pathname;
    activeCount += 1;
    return () => {
      activeCount -= 1;
      detach();
      // Saved and still here: take the extra entry off, or the next Back
      // only lands on this same page. Gone to another page: leave history
      // alone (the navigation has already moved past the entry).
      setTimeout(() => {
        if (activeCount === 0 && window.location.pathname === path && window.history.state?.[GUARD_KEY]) {
          void releaseLeaveWarning();
        }
      }, 0);
    };
  }, [active, message]);
}

/**
 * For the site's own back and navigation buttons (they route in code, so no
 * link click or browser Back to catch): true when it is fine to go — nothing
 * would be lost, the user agreed, or a security exit is under way.
 */
export function confirmLeave(unsaved: boolean, message: string): boolean {
  if (!unsaved || leaveWarningsStoodDown()) return true;
  return window.confirm(message);
}

/**
 * Takes the extra Back entry off the history before a deliberate navigation
 * (the work was saved), so Back afterwards goes where it should. Resolves
 * once the history has settled; a no-op when there is no entry to remove.
 */
export function releaseLeaveWarning(): Promise<void> {
  if (typeof window === "undefined" || !window.history.state?.[GUARD_KEY]) return Promise.resolve();
  releasing = true;
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      window.removeEventListener("popstate", done);
      clearTimeout(timer);
      releasing = false;
      resolve();
    };
    window.addEventListener("popstate", done);
    // A save must never hang on a history event that doesn't come.
    timer = setTimeout(done, 400);
    window.history.back();
  });
}

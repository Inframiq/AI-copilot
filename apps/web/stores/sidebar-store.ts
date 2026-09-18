import { create } from "zustand";
import {
  SIDEBAR_OVERRIDE_KEY,
  parseOverride,
  type SidebarOverride,
} from "@/lib/sidebar";

// Plain zustand + try/catch storage helpers, matching tour-store rather than
// pulling in zustand/persist for one string.
function readOverride(): SidebarOverride | null {
  try {
    return parseOverride(localStorage.getItem(SIDEBAR_OVERRIDE_KEY));
  } catch {
    return null; // storage blocked (private mode, site-data off) — use the breakpoint rule
  }
}

function writeOverride(value: SidebarOverride): void {
  try {
    localStorage.setItem(SIDEBAR_OVERRIDE_KEY, value);
  } catch {
    // best-effort; the in-memory choice still applies for this session
  }
}

interface SidebarState {
  /** null = follow the viewport breakpoint rule (the CSS default). A value
   * here is the user's explicit choice and wins at every width. */
  override: SidebarOverride | null;
  toggle: () => void;
  /** Read the stored choice once on mount. The inline script in app/layout.tsx
   * already applied it to the DOM before paint; this syncs React's copy. */
  hydrate: () => void;
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
  override: null,

  toggle: () => {
    // No override yet means we're following the breakpoint. The only reason to
    // reach for the toggle then is to collapse, so that's the first step.
    const next: SidebarOverride =
      get().override === "collapsed" ? "expanded" : "collapsed";
    writeOverride(next);
    set({ override: next });
  },

  hydrate: () => {
    // Only adopt a choice that was actually stored. Assigning the result
    // unconditionally would wipe an override set before this mount effect
    // ran, replacing a real choice with "follow the breakpoint".
    const stored = readOverride();
    if (stored) set({ override: stored });
  },
}));

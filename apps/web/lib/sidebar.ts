/**
 * One source of truth for the sidebar's width.
 *
 * 280px used to be hardcoded in three places that had to agree: the aside in
 * Sidebar.tsx, the `md:ml-[280px]` offset on <main> in (app)/layout.tsx, and
 * GuidedTour's bubble position. Introducing a second (collapsed) width would
 * have made that four copies, so the number lives here and everything reads it
 * — at runtime through the `--sidebar-w` custom property the layout sets.
 */
export const SIDEBAR_WIDTH = {
  expanded: 280,
  /** Icon-only rail: one 24px icon plus even padding, no labels. */
  collapsed: 72,
} as const;

export type SidebarOverride = "expanded" | "collapsed";

/** localStorage key for the user's explicit choice. */
export const SIDEBAR_OVERRIDE_KEY = "career-copilot-sidebar";

export function sidebarWidthPx(collapsed: boolean): number {
  return collapsed ? SIDEBAR_WIDTH.collapsed : SIDEBAR_WIDTH.expanded;
}

/** Narrow an untrusted stored string to a valid override. */
export function parseOverride(raw: string | null): SidebarOverride | null {
  return raw === "expanded" || raw === "collapsed" ? raw : null;
}

/**
 * The sidebar's current width in px, read from the live `--sidebar-w` custom
 * property so callers follow the breakpoint rule and any user override without
 * duplicating either.
 *
 * Falls back to the expanded width when the property is missing or
 * unparseable (SSR, or a test that never loaded the stylesheet) — clearing a
 * 280px sidebar is the safe wrong answer, since guessing 72 would tuck UI
 * underneath a full-width one.
 */
export function currentSidebarWidth(): number {
  if (typeof window === "undefined") return SIDEBAR_WIDTH.expanded;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--sidebar-w");
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : SIDEBAR_WIDTH.expanded;
}

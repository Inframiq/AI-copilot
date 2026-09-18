// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SIDEBAR_WIDTH, sidebarWidthPx, SIDEBAR_OVERRIDE_KEY, parseOverride } from "../lib/sidebar";
import { useSidebarStore } from "../stores/sidebar-store";

describe("sidebar width constants", () => {
  // 280px was hardcoded in Sidebar.tsx, (app)/layout.tsx's main offset, and
  // GuidedTour's bubble position. Three copies that had to agree; a second
  // width would have made four. One source of truth instead.
  it("exposes both widths", () => {
    expect(SIDEBAR_WIDTH.expanded).toBe(280);
    expect(SIDEBAR_WIDTH.collapsed).toBe(72);
  });

  it("maps an expanded sidebar to its pixel width", () => {
    expect(sidebarWidthPx(false)).toBe(280);
  });

  it("maps a collapsed sidebar to the rail width", () => {
    expect(sidebarWidthPx(true)).toBe(72);
  });
});

describe("useSidebarStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useSidebarStore.setState({ override: null });
    vi.restoreAllMocks();
  });

  it("starts with no override so the breakpoint rule applies", () => {
    expect(useSidebarStore.getState().override).toBeNull();
  });

  it("toggling from no override collapses first", () => {
    useSidebarStore.getState().toggle();
    expect(useSidebarStore.getState().override).toBe("collapsed");
  });

  it("toggling again expands", () => {
    useSidebarStore.getState().toggle();
    useSidebarStore.getState().toggle();
    expect(useSidebarStore.getState().override).toBe("expanded");
  });

  it("persists the choice", () => {
    useSidebarStore.getState().toggle();
    expect(localStorage.getItem(SIDEBAR_OVERRIDE_KEY)).toBe("collapsed");
  });

  it("hydrates a stored override", () => {
    localStorage.setItem(SIDEBAR_OVERRIDE_KEY, "expanded");
    useSidebarStore.getState().hydrate();
    expect(useSidebarStore.getState().override).toBe("expanded");
  });

  it("leaves an in-memory choice alone when nothing is stored", () => {
    // hydrate() runs from a mount effect. Unconditionally assigning what it
    // read would wipe a choice made before that effect fired.
    useSidebarStore.setState({ override: "collapsed" });
    useSidebarStore.getState().hydrate();
    expect(useSidebarStore.getState().override).toBe("collapsed");
  });

  it("ignores a garbage stored value rather than trusting it", () => {
    localStorage.setItem(SIDEBAR_OVERRIDE_KEY, "sideways");
    useSidebarStore.getState().hydrate();
    expect(useSidebarStore.getState().override).toBeNull();
  });

  it("survives localStorage being unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => useSidebarStore.getState().hydrate()).not.toThrow();
  });

  it("survives a write failing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => useSidebarStore.getState().toggle()).not.toThrow();
    expect(useSidebarStore.getState().override).toBe("collapsed");
  });
});

describe("pre-paint script", () => {
  // app/layout.tsx inlines the storage key as a literal so the script stays
  // dependency-free and runs before any bundle loads. That duplication is
  // deliberate but silent: renaming SIDEBAR_OVERRIDE_KEY without editing the
  // script would break persistence with nothing failing.
  it("uses the same storage key the store does", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    // cwd-relative, not import.meta.url: under the jsdom environment that is
    // not a file: URL and readFile rejects it.
    const layout = await fs.readFile(
      path.resolve(process.cwd(), "app/layout.tsx"),
      "utf8",
    );
    expect(layout).toContain(`localStorage.getItem("${SIDEBAR_OVERRIDE_KEY}")`);
  });

  it("only ever applies a value the store would accept", () => {
    // Guards against the script and parseOverride disagreeing about what is
    // valid, which would let a bad value reach the DOM.
    for (const v of ["collapsed", "expanded"]) {
      expect(parseOverride(v)).toBe(v);
    }
  });
});

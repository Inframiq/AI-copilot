// @vitest-environment jsdom
/**
 * The "infinite scroll" testers hit on the tailoring review: a browser
 * extension (Monica) added elements to the page, the page became taller than
 * the window, and scrolling past the end of a pane slid the whole app up over
 * blank space. Full-screen app layouts now lock the page; these keep the
 * pieces of that lock from being dropped. The behaviour itself is checked in
 * a real browser by ~/.kripax-dev/shell-lock.mjs.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { ViewportLock } from "../components/layout/ViewportLock";

const web = join(__dirname, "..");
const read = (p: string) => readFileSync(join(web, p), "utf8");

function scrollPageTo(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
  window.dispatchEvent(new Event("scroll"));
}

describe("ViewportLock", () => {
  afterEach(() => {
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    vi.restoreAllMocks();
  });

  it("puts the page back when anything scrolls it", () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    render(<ViewportLock />);
    scrollPageTo(470);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("leaves a page that hasn't moved alone", () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    render(<ViewportLock />);
    scrollPageTo(0);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("stops guarding once the layout is gone, so other pages scroll", () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { unmount } = render(<ViewportLock />);
    unmount();
    scrollPageTo(800);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe("full-screen layouts lock the page", () => {
  it.each(["app/(app)/layout.tsx", "app/(builder)/layout.tsx"])("%s carries the shell marker and the lock", (file) => {
    const src = read(file);
    expect(src).toMatch(/data-app-shell/);
    expect(src).toMatch(/<ViewportLock \/>/);
  });

  it("globals.css stops the page scrolling while a shell is on screen", () => {
    const css = read("app/globals.css");
    const rule = css.match(/html:has\(\[data-app-shell\]\),\s*html:has\(\[data-app-shell\]\) body\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/overflow:\s*hidden/);
    expect(rule![1]).toMatch(/overscroll-behavior:\s*none/);
  });

  it.each([
    "components/builder/ReviewShell.tsx",
    "components/builder/BuilderShell.tsx",
    "app/(builder)/studio/[resumeId]/preview/page.tsx",
    "app/(app)/layout.tsx",
  ])("%s keeps its scroll inside its pane", (file) => {
    expect(read(file)).toMatch(/overflow-y-auto overscroll-y-contain/);
  });
});

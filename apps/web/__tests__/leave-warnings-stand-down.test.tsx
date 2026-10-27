// @vitest-environment jsdom
// A security exit must never be held up by "leave without saving?" (tests
// ATK-008, ATK-049): choosing Stay on that prompt used to keep a signed-out
// page, and its data, on screen. Own file: the stand-down is one-way for the
// page's lifetime, so it can't share a module with the prompt's own tests.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

const replace = vi.fn();
Object.defineProperty(window, "location", { value: { ...window.location, replace }, writable: true });

import { useLeaveWarning } from "../lib/use-leave-warning";
import { leaveSignedOut } from "../lib/supabase";

function Draft() {
  useLeaveWarning(true, "Leave without saving?");
  return <a href="/dashboard">Dashboard</a>;
}

describe("leave warnings on a security exit", () => {
  it("before: unsaved work asks on the way out", () => {
    render(<Draft />);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("after a sign-out: nothing asks, and the page leaves", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { getByText } = render(<Draft />);

    leaveSignedOut();

    expect(replace).toHaveBeenCalledWith("/login");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    fireEvent.click(getByText("Dashboard"), { button: 0 });
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("every page with its own prompt checks the off switch", async () => {
    const { readFileSync } = await import("node:fs");
    for (const page of ["app/(app)/profile/page.tsx", "app/(app)/cover-letters/[id]/page.tsx"]) {
      const src = readFileSync(page, "utf-8");
      expect(src, page).toMatch(/beforeunload/);
      expect(src, page).toMatch(/leaveWarningsStoodDown\(\)/);
    }
    const guard = readFileSync("components/auth/SessionGuard.tsx", "utf-8");
    expect(guard).toMatch(/standDownLeaveWarnings\(\);\s*window\.location\.replace\("\/dashboard"\)/);
  });
});

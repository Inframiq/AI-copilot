// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { releaseLeaveWarning, useLeaveWarning } from "../lib/use-leave-warning";

const MESSAGE = "This tailored résumé isn't saved. Leave without saving?";

function Page({ active }: { active: boolean }) {
  useLeaveWarning(active, MESSAGE);
  return (
    <nav>
      <a href="/dashboard">Dashboard</a>
      <a href="#section">Same page</a>
      <a href="https://example.com/" target="_blank" rel="noreferrer">Elsewhere</a>
    </nav>
  );
}

let confirm: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.history.replaceState({ __NA: true }, "", "/studio/r1/preview");
  confirm = vi.spyOn(window, "confirm");
});

afterEach(() => {
  cleanup();
  confirm.mockRestore();
});

/** Clicks a link the way a person does; true when the click was allowed. */
function click(name: string, container: HTMLElement) {
  const link = [...container.querySelectorAll("a")].find((a) => a.textContent === name)!;
  return fireEvent.click(link, { button: 0 });
}

describe("useLeaveWarning", () => {
  it("asks before a link leaves the page, and stays when told to", () => {
    confirm.mockReturnValue(false);
    const { container } = render(<Page active />);

    expect(click("Dashboard", container)).toBe(false); // navigation cancelled
    expect(confirm).toHaveBeenCalledWith(MESSAGE);
  });

  it("lets the link go when the user agrees", () => {
    confirm.mockReturnValue(true);
    const { container } = render(<Page active />);

    expect(click("Dashboard", container)).toBe(true);
  });

  it("doesn't ask for a link within the page or one opening a new tab", () => {
    const { container } = render(<Page active />);

    click("Same page", container);
    click("Elsewhere", container);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks nothing when there is nothing unsaved", () => {
    const { container } = render(<Page active={false} />);

    click("Dashboard", container);
    expect(confirm).not.toHaveBeenCalled();
    expect(window.history.state.kripaxLeaveGuard).toBeUndefined();
  });

  it("puts the browser's own prompt on a refresh or a closed tab", () => {
    render(<Page active />);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("asks on Back, and puts the extra entry back when the user stays", () => {
    confirm.mockReturnValue(false);
    render(<Page active />);
    // An extra entry for this same page sits on top, keeping Next's own state.
    expect(window.history.state).toMatchObject({ __NA: true, kripaxLeaveGuard: true });

    // Back lands on the real entry for this page.
    window.history.replaceState({ __NA: true }, "", "/studio/r1/preview");
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));

    expect(confirm).toHaveBeenCalledWith(MESSAGE);
    expect(window.history.state).toMatchObject({ kripaxLeaveGuard: true });
  });

  it("goes on back when the user agrees", () => {
    confirm.mockReturnValue(true);
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    try {
      render(<Page active />);
      window.history.replaceState({ __NA: true }, "", "/studio/r1/preview");
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));

      expect(back).toHaveBeenCalled();
    } finally {
      back.mockRestore();
    }
  });

  it("release takes the extra entry off, without asking", async () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {
      window.history.replaceState({ __NA: true }, "", "/studio/r1/preview");
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    });
    try {
      render(<Page active />);
      await releaseLeaveWarning();

      expect(back).toHaveBeenCalledTimes(1);
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      back.mockRestore();
    }
  });

  it("release is a no-op when there is no extra entry", async () => {
    const back = vi.spyOn(window.history, "back");
    await releaseLeaveWarning();
    expect(back).not.toHaveBeenCalled();
    back.mockRestore();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { StudioControls } from "../../components/studio/StudioControls";
import { useResumeStore } from "../../stores/resume-store";

beforeEach(() => useResumeStore.getState().resetStore());

describe("StudioControls", () => {
  it("offers the template picker the studio lost when the dock was removed", () => {
    render(<StudioControls />);
    expect(screen.getByRole("button", { name: /template/i })).toBeTruthy();
  });

  it("opens the gallery and switches the résumé's template", () => {
    render(<StudioControls />);
    fireEvent.click(screen.getByRole("button", { name: /template/i }));
    fireEvent.click(screen.getByRole("radio", { name: /minimal/i }));
    expect(useResumeStore.getState().templateId).toBe("ats_minimal");
  });

  it("marks the current template as chosen", () => {
    useResumeStore.setState({ templateId: "ats_modern" } as never);
    render(<StudioControls />);
    fireEvent.click(screen.getByRole("button", { name: /template/i }));
    expect(
      screen.getByRole("radio", { name: /ats modern/i }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("closes the gallery on a click outside", () => {
    render(<StudioControls />);
    fireEvent.click(screen.getByRole("button", { name: /template/i }));
    expect(screen.getByRole("dialog", { name: /template/i })).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog", { name: /template/i })).toBeNull();
  });

  it("closes the gallery on Escape, without leaving the trigger unfocusable", () => {
    render(<StudioControls />);
    const trigger = screen.getByRole("button", { name: /template/i });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /template/i })).toBeNull();
  });

  it("carries the type and spacing controls too", () => {
    render(<StudioControls />);
    expect(screen.getByRole("button", { name: /^type$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /spacing/i })).toBeTruthy();
  });

  // The dock opened upward because it sat at the bottom of the screen. In a
  // top header that puts every panel off-screen.
  it("opens its panels downward", () => {
    render(<StudioControls />);
    fireEvent.click(screen.getByRole("button", { name: /template/i }));
    const panel = screen.getByRole("dialog", { name: /template/i });
    expect(panel.className).toContain("top-full");
    expect(panel.className).not.toContain("bottom-full");
  });
});

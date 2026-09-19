// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TextSizePanel } from "../../components/studio/controls/TextSizePanel";
import { useResumeStore } from "../../stores/resume-store";

beforeEach(() => useResumeStore.getState().resetStore());

/**
 * Two groups, three steps each. "Standard" is the template's own sizes, so a
 * résumé nobody has touched is already standard — which is what makes it the
 * ATS-safe default rather than a setting the user has to find.
 */
describe("TextSizePanel", () => {
  it("offers small, standard and large for both headings and body text", () => {
    render(<TextSizePanel />);
    for (const group of ["Headings", "Body text"]) {
      const g = within(screen.getByRole("radiogroup", { name: new RegExp(group, "i") }));
      expect(g.getAllByRole("radio").map((r) => r.textContent)).toEqual([
        "Small", "Standard", "Large",
      ]);
    }
  });

  it("starts on standard, which is the size the résumé is generated at", () => {
    render(<TextSizePanel />);
    const headings = within(screen.getByRole("radiogroup", { name: /headings/i }));
    expect(headings.getByRole("radio", { name: "Standard" }).getAttribute("aria-checked")).toBe("true");
    expect(useResumeStore.getState().bodySizeDelta).toBe(0);
  });

  it("applies a body step to every content point at once", () => {
    render(<TextSizePanel />);
    const body = within(screen.getByRole("radiogroup", { name: /body text/i }));
    fireEvent.click(body.getByRole("radio", { name: "Large" }));
    expect(useResumeStore.getState().bodySizeDelta).toBe(1);
    // and leaves the headings alone
    expect(useResumeStore.getState().headingSizeDelta).toBe(0);
  });

  it("applies a heading step to every heading at once", () => {
    render(<TextSizePanel />);
    const headings = within(screen.getByRole("radiogroup", { name: /headings/i }));
    fireEvent.click(headings.getByRole("radio", { name: "Small" }));
    expect(useResumeStore.getState().headingSizeDelta).toBe(-1);
    expect(useResumeStore.getState().bodySizeDelta).toBe(0);
  });

  it("marks the step in force", () => {
    useResumeStore.setState({ bodySizeDelta: -1 } as never);
    render(<TextSizePanel />);
    const body = within(screen.getByRole("radiogroup", { name: /body text/i }));
    expect(body.getByRole("radio", { name: "Small" }).getAttribute("aria-checked")).toBe("true");
    expect(body.getByRole("radio", { name: "Standard" }).getAttribute("aria-checked")).toBe("false");
  });
});

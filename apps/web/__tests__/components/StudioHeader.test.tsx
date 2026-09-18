// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StudioHeader } from "../../components/studio/StudioHeader";

const props = {
  title: "Jane's Resume",
  mode: "edit" as const,
  onMode: () => {},
  onBack: () => {},
  onExport: () => {},
  isExporting: false,
};

describe("StudioHeader", () => {
  it("offers a way back to the builder", () => {
    render(<StudioHeader {...props} />);
    expect(screen.getByRole("button", { name: /back to builder/i })).toBeTruthy();
  });

  it("shows the resume title", () => {
    render(<StudioHeader {...props} />);
    expect(screen.getByText("Jane's Resume")).toBeTruthy();
  });

  it("marks the active tab", () => {
    render(<StudioHeader {...props} mode="preview" />);
    expect(screen.getByRole("tab", { name: /preview/i }).getAttribute("aria-selected")).toBe("true");
  });

  it("does not mark the inactive tab", () => {
    render(<StudioHeader {...props} mode="preview" />);
    expect(screen.getByRole("tab", { name: /edit/i }).getAttribute("aria-selected")).toBe("false");
  });

  it("switches tabs", () => {
    const onMode = vi.fn();
    render(<StudioHeader {...props} onMode={onMode} />);
    fireEvent.click(screen.getByRole("tab", { name: /preview/i }));
    expect(onMode).toHaveBeenCalledWith("preview");
  });

  it("exports", () => {
    const onExport = vi.fn();
    render(<StudioHeader {...props} onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }));
    expect(onExport).toHaveBeenCalled();
  });

  it("disables export while one is in flight", () => {
    render(<StudioHeader {...props} isExporting />);
    expect(screen.getByRole("button", { name: /export/i }).hasAttribute("disabled")).toBe(true);
  });

  it("goes back", () => {
    const onBack = vi.fn();
    render(<StudioHeader {...props} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /back to builder/i }));
    expect(onBack).toHaveBeenCalled();
  });

  // Having opted into role="tablist"/role="tab", the ARIA pattern's keyboard
  // contract comes with it: a screen-reader user is told this is a tablist
  // and will reach for the arrow keys.
  it("moves to the next tab on ArrowRight", () => {
    const onMode = vi.fn();
    render(<StudioHeader {...props} onMode={onMode} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: /edit/i }), { key: "ArrowRight" });
    expect(onMode).toHaveBeenCalledWith("preview");
  });

  it("wraps to the last tab on ArrowLeft from the first", () => {
    const onMode = vi.fn();
    render(<StudioHeader {...props} onMode={onMode} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: /edit/i }), { key: "ArrowLeft" });
    expect(onMode).toHaveBeenCalledWith("preview");
  });

  it("ignores other keys", () => {
    const onMode = vi.fn();
    render(<StudioHeader {...props} onMode={onMode} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: /edit/i }), { key: "a" });
    expect(onMode).not.toHaveBeenCalled();
  });

  // Roving tabindex: Tab reaches the tablist once and lands on the active
  // tab, rather than stepping through every tab in turn.
  it("keeps only the active tab in the tab order", () => {
    render(<StudioHeader {...props} mode="preview" />);
    expect(screen.getByRole("tab", { name: /preview/i }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("tab", { name: /edit/i }).getAttribute("tabindex")).toBe("-1");
  });

  it("gives every control a keyboard focus ring", () => {
    const { container } = render(<StudioHeader {...props} />);
    const unringed = [...container.querySelectorAll("button")].filter(
      (b) => !b.className.includes("focus-visible:"),
    );
    expect(unringed.map((b) => b.textContent)).toEqual([]);
  });
});

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
});

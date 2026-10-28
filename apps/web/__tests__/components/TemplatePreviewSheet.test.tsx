// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TemplatePreviewSheet } from "../../components/studio/TemplatePreviewSheet";

const TEMPLATES = [
  { id: "ats_clean", label: "ATS Clean", description: "Simple single-column layout." },
  { id: "ats_modern", label: "ATS Modern", description: "Clean sans-serif." },
  { id: "ats_minimal", label: "Minimal", description: "Centered header." },
];

function Harness({ start = 0, onUse = vi.fn(), onClose = vi.fn() }) {
  const [index, setIndex] = useState(start);
  return (
    <TemplatePreviewSheet
      templates={TEMPLATES}
      index={index}
      selectedId="ats_clean"
      onIndexChange={setIndex}
      onUse={onUse}
      onClose={onClose}
    />
  );
}

describe("TemplatePreviewSheet", () => {
  it("shows the whole sample page of the template it was opened on", () => {
    render(<Harness start={1} />);
    expect(screen.getByRole("dialog", { name: "ATS Modern" })).toBeTruthy();
    expect(screen.getByText(/2 of 3/)).toBeTruthy();
    const img = screen.getByAltText("ATS Modern template, full sample page") as HTMLImageElement;
    expect(img.src).toContain("ats_modern.png");
  });

  it("steps through the others, wrapping at both ends", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Previous template" }));
    expect(screen.getByRole("dialog", { name: "Minimal" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Next template" }));
    await userEvent.click(screen.getByRole("button", { name: "Next template" }));
    expect(screen.getByRole("dialog", { name: "ATS Modern" })).toBeTruthy();
  });

  it("uses the template being shown, not the one it was opened on", async () => {
    const onUse = vi.fn();
    render(<Harness onUse={onUse} />);
    expect(screen.getByRole("button", { name: "Keep this template" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Next template" }));
    await userEvent.click(screen.getByRole("button", { name: "Use this template" }));
    expect(onUse).toHaveBeenCalledWith("ats_modern");
  });

  it("closes without choosing anything", async () => {
    const onUse = vi.fn();
    const onClose = vi.fn();
    render(<Harness onUse={onUse} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Back to templates" }));
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onUse).not.toHaveBeenCalled();
  });
});

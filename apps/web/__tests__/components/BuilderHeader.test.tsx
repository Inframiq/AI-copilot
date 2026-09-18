// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { BuilderHeader } from "../../components/builder/BuilderHeader";
import { useResumeStore } from "../../stores/resume-store";

describe("BuilderHeader", () => {
  beforeEach(() =>
    useResumeStore.setState({ isDirty: false, isSaving: false, saveError: null }),
  );

  it("shows the resume title", () => {
    render(<BuilderHeader title="Jane's Resume" onBack={() => {}} backLabel="Back" />);
    expect(screen.getByText("Jane's Resume")).toBeTruthy();
  });

  it("reports saved when there is nothing pending", () => {
    render(<BuilderHeader title="R" onBack={() => {}} backLabel="Back" />);
    expect(screen.getByTestId("save-status").textContent).toMatch(/saved/i);
  });

  it("reports saving while a write is in flight", () => {
    useResumeStore.setState({ isSaving: true });
    render(<BuilderHeader title="R" onBack={() => {}} backLabel="Back" />);
    expect(screen.getByTestId("save-status").textContent).toMatch(/saving/i);
  });

  it("reports unsaved changes when dirty", () => {
    useResumeStore.setState({ isDirty: true });
    render(<BuilderHeader title="R" onBack={() => {}} backLabel="Back" />);
    expect(screen.getByTestId("save-status").textContent).toMatch(/unsaved/i);
  });

  it("surfaces a save error over every other status", () => {
    // A failed write matters more than whatever else is pending.
    useResumeStore.setState({ isDirty: true, isSaving: true, saveError: "Network down" });
    render(<BuilderHeader title="R" onBack={() => {}} backLabel="Back" />);
    expect(screen.getByTestId("save-status").textContent).toMatch(/network down/i);
  });

  it("calls onBack with the caller's label", () => {
    const onBack = vi.fn();
    render(<BuilderHeader title="R" onBack={onBack} backLabel="Back to Analyzer" />);
    screen.getByRole("button", { name: /back to analyzer/i }).click();
    expect(onBack).toHaveBeenCalled();
  });

  it("gives the back control a keyboard focus ring", () => {
    const { container } = render(<BuilderHeader title="R" onBack={() => {}} backLabel="Back" />);
    const unringed = [...container.querySelectorAll("button")].filter(
      (b) => !b.className.includes("focus-visible:"),
    );
    expect(unringed.map((b) => b.textContent)).toEqual([]);
  });

  // On a phone the row is back-label + title + save status, which does not
  // fit. The label collapses to its arrow, so the accessible name has to be
  // carried explicitly or the button becomes unnamed for screen readers.
  it("names the back control even when its label is collapsed", () => {
    const { container } = render(
      <BuilderHeader title="R" onBack={() => {}} backLabel="Back to Analyzer" />,
    );
    const button = container.querySelector("button") as HTMLElement;
    expect(button.getAttribute("aria-label")).toBe("Back to Analyzer");
    const label = button.querySelector("span.hidden");
    expect(label?.className).toContain("sm:inline");
    expect(label?.textContent).toBe("Back to Analyzer");
  });
});


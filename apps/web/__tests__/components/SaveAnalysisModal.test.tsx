// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SaveAnalysisModal } from "../../components/jd/SaveAnalysisModal";

describe("SaveAnalysisModal", () => {
  it("saves immediately with no name conflict", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <SaveAnalysisModal
        defaultName="Senior Engineer at Acme"
        existingTitles={[{ id: "jd-1", title: "Staff Engineer at Beta" }]}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(onConfirm).toHaveBeenCalledWith("Senior Engineer at Acme");
  });

  it("asks to replace on a case-insensitive name collision, and confirms with the matched id", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <SaveAnalysisModal
        defaultName="Senior Engineer at Acme"
        existingTitles={[{ id: "jd-1", title: "senior engineer at acme " }]}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /replace/i }));
    expect(onConfirm).toHaveBeenCalledWith("Senior Engineer at Acme", "jd-1");
  });

  it("returns to the name field instead of closing when Back is clicked on a conflict", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <SaveAnalysisModal
        defaultName="Duplicate Title"
        existingTitles={[{ id: "jd-1", title: "Duplicate Title" }]}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back/i }));

    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText(/name this analysis/i)).toBeInTheDocument();
  });

  it("calls onCancel when Cancel is clicked on the name step", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <SaveAnalysisModal
        defaultName="New JD"
        existingTitles={[]}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});

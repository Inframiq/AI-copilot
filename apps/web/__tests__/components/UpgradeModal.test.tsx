// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { UpgradeModal } from "../../components/plans/UpgradeModal";

describe("UpgradeModal", () => {
  it("shows the coming-soon copy and closes on 'OK'", async () => {
    const onClose = vi.fn();
    render(<UpgradeModal onClose={onClose} />);
    expect(screen.getByText(/premium is not yet available/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^ok$/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<UpgradeModal onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});

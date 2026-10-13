// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HelpButton, SUPPORT_EMAIL } from "@/components/support/HelpButton";

describe("HelpButton", () => {
  it("opens a panel with the support address, an email link and a copy button", async () => {
    render(<HelpButton />);
    await userEvent.click(screen.getByRole("button", { name: "Need help?" }));
    expect(screen.getByRole("dialog", { name: "Need help?" })).toBeInTheDocument();
    expect(screen.getByText(SUPPORT_EMAIL)).toBeInTheDocument();
    const email = screen.getByRole("link", { name: /email support/i });
    expect(email.getAttribute("href")).toMatch(/^mailto:support@inframiq\.com\?subject=/);
  });

  it("copies the address", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<HelpButton />);
    await userEvent.click(screen.getByRole("button", { name: "Need help?" }));
    await userEvent.click(screen.getByRole("button", { name: /copy address/i }));
    expect(writeText).toHaveBeenCalledWith(SUPPORT_EMAIL);
    await waitFor(() => expect(screen.getByRole("button", { name: /copied/i })).toBeInTheDocument());
  });

  it("closes on Escape", async () => {
    render(<HelpButton />);
    await userEvent.click(screen.getByRole("button", { name: "Need help?" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InfoTooltip } from "../../components/ui/InfoTooltip";

describe("InfoTooltip", () => {
  it("hides the text until triggered", () => {
    render(<InfoTooltip text="Explains what this card does" />);
    expect(screen.queryByText("Explains what this card does")).not.toBeInTheDocument();
  });

  it("shows the text on hover and hides it again on mouse leave", async () => {
    const user = userEvent.setup();
    render(<InfoTooltip text="Explains what this card does" />);
    const trigger = screen.getByRole("button", { name: /more info/i });

    await user.hover(trigger);
    expect(await screen.findByText("Explains what this card does")).toBeInTheDocument();

    await user.unhover(trigger);
    expect(screen.queryByText("Explains what this card does")).not.toBeInTheDocument();
  });

  it("shows the text on keyboard focus, for keyboard-only users", async () => {
    const user = userEvent.setup();
    render(<InfoTooltip text="Explains what this card does" />);
    await user.tab();
    expect(await screen.findByText("Explains what this card does")).toBeInTheDocument();
  });

  it("opens on tap, for touch users without hover", async () => {
    const user = userEvent.setup();
    render(<InfoTooltip text="Explains what this card does" />);
    const trigger = screen.getByRole("button", { name: /more info/i });

    await user.click(trigger);
    expect(await screen.findByText("Explains what this card does")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<InfoTooltip text="Explains what this card does" />);
    await user.click(screen.getByRole("button", { name: /more info/i }));
    expect(await screen.findByText("Explains what this card does")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByText("Explains what this card does")).not.toBeInTheDocument();
  });

  it("closes on an outside click", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <InfoTooltip text="Explains what this card does" />
        <button>Elsewhere</button>
      </div>
    );
    await user.click(screen.getByRole("button", { name: /more info/i }));
    expect(await screen.findByText("Explains what this card does")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByText("Explains what this card does")).not.toBeInTheDocument();
  });

  it("links the tooltip to the trigger via aria-describedby when open", async () => {
    const user = userEvent.setup();
    render(<InfoTooltip text="Explains what this card does" />);
    const trigger = screen.getByRole("button", { name: /more info/i });
    expect(trigger).not.toHaveAttribute("aria-describedby");

    await user.hover(trigger);
    const tooltip = await screen.findByRole("tooltip");
    expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.id);
  });

  it("renders outside an overflow-hidden/stacking-context ancestor instead of being clipped or buried under it", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <div className="relative overflow-hidden" style={{ width: 50, height: 50 }}>
        <InfoTooltip text="Explains what this card does" />
      </div>
    );
    await user.hover(screen.getByRole("button", { name: /more info/i }));
    const tooltip = await screen.findByRole("tooltip");

    // Portaled straight to document.body — not a descendant of the clipping
    // container, so no ancestor overflow/stacking context can hide it.
    expect(container.contains(tooltip)).toBe(false);
    expect(document.body.contains(tooltip)).toBe(true);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BuilderNav } from "../../components/builder/BuilderNav";

const noop = () => {};

describe("BuilderNav", () => {
  it("disables Previous on the first section", () => {
    render(<BuilderNav current="contact" onPrevious={noop} onNext={noop} onPreview={noop} />);
    expect(screen.getByRole("button", { name: /previous/i }).hasAttribute("disabled")).toBe(true);
  });

  it("enables Previous once past the first section", () => {
    render(<BuilderNav current="summary" onPrevious={noop} onNext={noop} onPreview={noop} />);
    expect(screen.getByRole("button", { name: /previous/i }).hasAttribute("disabled")).toBe(false);
  });

  it("offers Continue on a middle section", () => {
    render(<BuilderNav current="skills" onPrevious={noop} onNext={noop} onPreview={noop} />);
    expect(screen.getByRole("button", { name: /continue/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /preview resume/i })).toBeNull();
  });

  it("replaces Continue with Preview Resume on the last section", () => {
    render(<BuilderNav current="extras" onPrevious={noop} onNext={noop} onPreview={noop} />);
    expect(screen.getByRole("button", { name: /preview resume/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
  });

  it("calls onPreview from the last section's primary action", () => {
    const onPreview = vi.fn();
    render(<BuilderNav current="extras" onPrevious={noop} onNext={noop} onPreview={onPreview} />);
    screen.getByRole("button", { name: /preview resume/i }).click();
    expect(onPreview).toHaveBeenCalled();
  });

  it("names the next section so the button says where it goes", () => {
    render(<BuilderNav current="contact" onPrevious={noop} onNext={noop} onPreview={noop} />);
    expect(screen.getByRole("button", { name: /continue/i }).textContent).toMatch(/summary/i);
  });

  it("names the previous section too", () => {
    render(<BuilderNav current="education" onPrevious={noop} onNext={noop} onPreview={noop} />);
    expect(screen.getByRole("button", { name: /previous/i }).textContent).toMatch(/experience/i);
  });

  it("gives every control a keyboard focus ring", () => {
    const { container } = render(
      <BuilderNav current="contact" onPrevious={noop} onNext={noop} onPreview={noop} />,
    );
    const unringed = [...container.querySelectorAll("button")].filter(
      (b) => !b.className.includes("focus-visible:"),
    );
    expect(unringed.map((b) => b.textContent)).toEqual([]);
  });

  // The section names push both buttons past a 360px viewport, so they drop
  // out below `sm`. What must never drop out is the verb — a button reading
  // only ": Education" would be nonsense.
  it("keeps the bare verb visible at every width", () => {
    const { container } = render(
      <BuilderNav current="summary" onPrevious={noop} onNext={noop} onPreview={noop} />,
    );
    for (const button of container.querySelectorAll("button")) {
      const alwaysVisible = [...button.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE || !(n as HTMLElement).className?.includes?.("hidden"))
        .map((n) => n.textContent)
        .join("")
        .trim();
      expect(alwaysVisible).toMatch(/previous|continue/i);
    }
  });

  it("hides only the section name on narrow screens", () => {
    const { container } = render(
      <BuilderNav current="summary" onPrevious={noop} onNext={noop} onPreview={noop} />,
    );
    const hidden = [...container.querySelectorAll("span.hidden")];
    expect(hidden.length).toBe(2);
    expect(hidden.every((s) => s.className.includes("sm:inline"))).toBe(true);
    expect(hidden.map((s) => s.textContent?.trim())).toEqual([": Contact", "to Experience"]);
  });
});


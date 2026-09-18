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
});

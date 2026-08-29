// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ImportanceBadge } from "../../components/resume/ImportanceBadge";

afterEach(() => cleanup());

describe("ImportanceBadge", () => {
  it("renders the level as a data attribute and label", () => {
    const { getByTestId } = render(<ImportanceBadge level="high" />);
    const el = getByTestId("importance-badge");
    expect(el.getAttribute("data-level")).toBe("high");
    expect(el.textContent).toContain("High");
  });

  it("uses the error dot for high and the muted dot for low", () => {
    const { getByTestId, rerender } = render(<ImportanceBadge level="high" />);
    expect(getByTestId("importance-badge").querySelector(".bg-error")).not.toBeNull();
    rerender(<ImportanceBadge level="low" />);
    expect(getByTestId("importance-badge").querySelector(".bg-error")).toBeNull();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { TailoringProgress, TAILORING_STEPS } from "@/components/builder/TailoringProgress";

const shown = () => TAILORING_STEPS.filter((s) => screen.queryByText(s.label, { selector: "li span" }));
const live = () => screen.getByText((_, el) => el?.getAttribute("aria-live") === "polite").textContent;

describe("TailoringProgress", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("brings the stages in one after another, on a typical run's pace", () => {
    render(<TailoringProgress />);
    expect(shown()).toHaveLength(1);
    expect(live()).toBe("Reading the job description");

    act(() => vi.advanceTimersByTime(5_000));
    expect(shown()).toHaveLength(2);
    expect(live()).toBe("Matching it to your experience");

    act(() => vi.advanceTimersByTime(26_000));
    expect(shown()).toHaveLength(5);
    expect(live()).toBe("Scoring the result");
  });

  it("never shows the last stage finished, however long the run takes", () => {
    render(<TailoringProgress />);
    act(() => vi.advanceTimersByTime(120_000));
    expect(live()).toBe("Scoring the result");
    expect(screen.getByText(/taking longer than usual/i)).toBeTruthy();
    expect(Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"))).toBeLessThan(100);
  });
});

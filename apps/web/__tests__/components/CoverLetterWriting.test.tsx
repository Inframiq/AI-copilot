// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { CoverLetterWriting, LETTER_STEPS } from "@/components/cover-letter/CoverLetterWriting";

const live = () => screen.getByText((_, el) => el?.getAttribute("aria-live") === "polite").textContent;

describe("CoverLetterWriting", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("moves through the stages and holds the last until the letter arrives", () => {
    render(<CoverLetterWriting />);
    expect(live()).toBe("Reading the job");
    act(() => vi.advanceTimersByTime(9_000));
    expect(live()).toBe("Writing the letter");
    act(() => vi.advanceTimersByTime(120_000));
    expect(live()).toBe(LETTER_STEPS[LETTER_STEPS.length - 1].label);
  });

  it("offers a re-check when the wait runs long", () => {
    const onCheck = vi.fn();
    render(<CoverLetterWriting slow onCheck={onCheck} />);
    fireEvent.click(screen.getByRole("button", { name: /check again/i }));
    expect(onCheck).toHaveBeenCalled();
  });
});

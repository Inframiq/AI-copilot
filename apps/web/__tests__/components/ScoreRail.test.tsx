// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ScoreRail, type ScoreRailProps } from "@/components/studio/review/ScoreRail";

function props(over: Partial<ScoreRailProps> = {}): ScoreRailProps {
  return {
    before: 42, after: 60, updating: false, stale: false, onRetryScore: vi.fn(),
    pointsOn: 3, pointsTotal: 5, skillsAdded: 2,
    onAutoSelect: vi.fn(), onClear: vi.fn(), onApply: vi.fn(), canApply: true,
    onTryAnother: vi.fn(), reusedRun: false,
    ...over,
  };
}

describe("ScoreRail", () => {
  it("announces each change to the score, up or down", () => {
    const { rerender } = render(<ScoreRail {...props()} />);
    rerender(<ScoreRail {...props({ after: 64 })} />);
    expect(screen.getByText("Score up 4 to 64")).toBeTruthy();
    rerender(<ScoreRail {...props({ after: 61 })} />);
    expect(screen.getByText("Score down 3 to 61")).toBeTruthy();
  });

  it("shows the lift from tailoring and the counts", () => {
    render(<ScoreRail {...props()} />);
    expect(screen.getByText("+18 from tailoring")).toBeTruthy();
    expect(screen.getByText("Points on").nextSibling?.textContent).toBe("3/5");
    expect(screen.getByText("Skills added").nextSibling?.textContent).toBe("2");
  });

  it("offers a retry when a re-score failed", () => {
    const p = props({ stale: true });
    render(<ScoreRail {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /score didn’t update — retry/i }));
    expect(p.onRetryScore).toHaveBeenCalled();
  });

  it("cannot apply before there is something to apply", () => {
    render(<ScoreRail {...props({ canApply: false })} />);
    expect((screen.getByRole("button", { name: /apply & preview/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("disarms Try another version if the confirming click never comes", () => {
    vi.useFakeTimers();
    try {
      const p = props();
      render(<ScoreRail {...p} />);
      fireEvent.click(screen.getByRole("button", { name: /try another version/i }));
      act(() => { vi.advanceTimersByTime(4500); });
      fireEvent.click(screen.getByRole("button", { name: /try another version/i }));
      expect(p.onTryAnother).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

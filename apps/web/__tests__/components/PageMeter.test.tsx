// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageMeter } from "../../components/studio/PageMeter";

describe("PageMeter", () => {
  it("states the length plainly when it fits one page", () => {
    render(<PageMeter pages={1} />);
    expect(screen.getByTestId("page-count").textContent).toMatch(/^1 page$/i);
  });

  it("counts the pages when it does not", () => {
    render(<PageMeter pages={3} />);
    expect(screen.getByTestId("page-count").textContent).toMatch(/3 pages/i);
  });

  // The user cannot fix an overflow here — the points that caused it are
  // chosen on the previous screen — so the message has to say where to go.
  it("names the remedy when the résumé spills past one page", () => {
    render(<PageMeter pages={2} />);
    expect(screen.getByRole("status").textContent).toMatch(/go back/i);
  });

  it("says nothing extra when it fits", () => {
    render(<PageMeter pages={1} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("flags the overflow rather than announcing it as a problem", () => {
    // Two pages is a judgement call, not a failure: plenty of résumés should
    // be two. A polite status, not an alert.
    render(<PageMeter pages={2} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

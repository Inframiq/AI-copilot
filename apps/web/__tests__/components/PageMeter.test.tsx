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

  // "Go back and turn points off" was the only advice, and it didn't work:
  // a reworded point turned off returns to the original wording, usually
  // longer. The remedies named now are ones that shorten.
  it("names remedies that shorten: Spacing and Type, here", () => {
    render(<PageMeter pages={2} />);
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toMatch(/Compact in Spacing/);
    expect(text).toMatch(/Small in Type/);
    // Nothing to go back to on a résumé that wasn't tailored.
    expect(text).not.toMatch(/go back/i);
  });

  it("on a tailored draft, says what going back can shorten and what it can't", () => {
    render(<PageMeter pages={2} tailored />);
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toMatch(/go back and turn off added points and the summary for this job/i);
    expect(text).toMatch(/reworded point turned off returns to your original wording/i);
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

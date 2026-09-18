// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { TailoringStar } from "../../components/builder/TailoringStar";

describe("TailoringStar", () => {
  it("renders as decoration, since the heading already says what is happening", () => {
    const { container } = render(<TailoringStar />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders a hero star with smaller ones around it", () => {
    const { container } = render(<TailoringStar />);
    expect(container.querySelector('[data-star="hero"]')).toBeTruthy();
    expect(container.querySelectorAll('[data-star="satellite"]').length).toBeGreaterThan(2);
  });

  it("gives the hero star the shining outline that a flat icon lacks", () => {
    const { container } = render(<TailoringStar />);
    const hero = container.querySelector('[data-star="hero"]');
    expect(hero?.getAttribute("stroke")).toBeTruthy();
    expect(hero?.getAttribute("fill")).toMatch(/^url\(#/);
  });

  it("staggers the satellites so they do not twinkle in unison", () => {
    const { container } = render(<TailoringStar />);
    const delays = [...container.querySelectorAll('[data-star="satellite"]')].map(
      (el) => (el as SVGElement).style.animationDelay,
    );
    expect(delays.every(Boolean)).toBe(true);
    expect(new Set(delays).size).toBe(delays.length);
  });

  // Two instances on one page would otherwise both point at the same gradient
  // ids, and whichever mounted second would silently restyle the first.
  it("scopes its gradient ids per instance", () => {
    const { container } = render(
      <>
        <TailoringStar />
        <TailoringStar />
      </>,
    );
    const ids = [...container.querySelectorAll("linearGradient, radialGradient")].map(
      (el) => el.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => !id.includes(":"))).toBe(true);
  });
});

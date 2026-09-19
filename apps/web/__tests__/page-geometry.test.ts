import { describe, it, expect } from "vitest";
import { pageGeometry, pageCount } from "../lib/page-geometry";

/**
 * The Studio's canvas has to be the same shape as the page WeasyPrint lays
 * out, or its line breaks are not the PDF's line breaks and the page
 * boundary it draws is in the wrong place.
 */
describe("pageGeometry", () => {
  it("defaults to A4, which is what WeasyPrint uses when @page names no size", () => {
    // Every résumé template declares only a margin. Measured off a real
    // render: 793.70 x 1122.52 CSS px.
    const g = pageGeometry("<style>@page { margin: 0.5in; }</style>");
    expect(g.width).toBeCloseTo(793.7, 1);
    expect(g.height).toBeCloseTo(1122.52, 1);
  });

  it("reads a named size when the document declares one", () => {
    const g = pageGeometry("<style>@page { size: Letter; margin: 1in; }</style>");
    expect(g.width).toBeCloseTo(816, 1);
    expect(g.height).toBeCloseTo(1056, 1);
  });

  it("converts the margin to pixels", () => {
    expect(pageGeometry("<style>@page { margin: 0.5in; }</style>").margin).toBeCloseTo(48, 3);
    expect(pageGeometry("<style>@page { size: Letter; margin: 1in; }</style>").margin).toBeCloseTo(96, 3);
  });

  it("gives the height one page of content actually gets", () => {
    // What the boundary maths divides by: the page less both margins.
    const g = pageGeometry("<style>@page { margin: 0.5in; }</style>");
    expect(g.contentHeight).toBeCloseTo(1122.52 - 96, 1);
  });

  it("handles a margin given in other units", () => {
    expect(pageGeometry("<style>@page { margin: 25.4mm; }</style>").margin).toBeCloseTo(96, 1);
    expect(pageGeometry("<style>@page { margin: 36pt; }</style>").margin).toBeCloseTo(48, 1);
  });

  it("falls back to A4 with no margin when the document declares no @page", () => {
    const g = pageGeometry("<p>hello</p>");
    expect(g.width).toBeCloseTo(793.7, 1);
    expect(g.margin).toBe(0);
  });
});

describe("page counting", () => {
  it("counts a page per content height, and never fewer than one", () => {
    expect(pageCount(0, 1026.52)).toBe(1);
    expect(pageCount(988, 1026.52)).toBe(1);
    expect(pageCount(1350, 1026.52)).toBe(2);
    expect(pageCount(2416, 1026.52)).toBe(3);
  });

  it("does not count a second page for a hair over", () => {
    // Sub-pixel rounding between the browser's measurement and the page
    // height must not invent a page the PDF does not have.
    expect(pageCount(1026.8, 1026.52)).toBe(1);
  });
});

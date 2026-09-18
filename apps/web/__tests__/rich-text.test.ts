// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { sanitizeInline, RICH_COMMANDS } from "../lib/rich-text";

describe("sanitizeInline", () => {
  it("keeps the formatting tags the toolbar produces", () => {
    expect(sanitizeInline("a <b>b</b> <i>c</i> <u>d</u>")).toBe("a <b>b</b> <i>c</i> <u>d</u>");
  });

  it("strips the style attribute execCommand adds unprompted", () => {
    expect(sanitizeInline('<i style=""><u style="">x</u></i>')).toBe("<i><u>x</u></i>");
  });

  it("unwraps the divs and spans contenteditable leaves behind", () => {
    expect(sanitizeInline('<div>a</div><span style="color:red">b</span>')).toBe("ab");
  });

  it("drops a script element entirely rather than keeping its source", () => {
    // Unlike the server, which escapes tags the user typed as text, anything
    // reaching here is a real element the browser built — never intent.
    expect(sanitizeInline('<script>alert(1)</script>x')).toBe("x");
  });

  it("escapes text that looks like markup", () => {
    expect(sanitizeInline("5 < 6 & 7")).toBe("5 &lt; 6 &amp; 7");
  });

  it("drops an image and its handler", () => {
    const out = sanitizeInline('<img src=x onerror="alert(1)">hi');
    expect(out).toBe("hi");
  });

  it("normalises the tags execCommand may emit to the same shape", () => {
    expect(sanitizeInline("<strong>a</strong><em>b</em>")).toBe("<strong>a</strong><em>b</em>");
  });

  it("offers exactly the three commands the toolbar exposes", () => {
    expect(RICH_COMMANDS.map((c) => c.command)).toEqual(["bold", "italic", "underline"]);
  });
});

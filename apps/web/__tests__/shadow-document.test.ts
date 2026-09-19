import { describe, it, expect } from "vitest";
import { scopeBodyToHost } from "../lib/shadow-document";

/**
 * A shadow root has no <body>: the parser drops the tag when a whole document
 * is assigned to innerHTML. Every `body { ... }` rule therefore matched
 * nothing, and the résumé's body text rendered at the browser's default 16px
 * instead of the template's 10pt — with none of its font, line-height or
 * colour either. :host is the same element in shadow terms, and font
 * properties inherit from it.
 */
describe("scopeBodyToHost", () => {
  it("retargets the body rule at the host", () => {
    const out = scopeBodyToHost("<style>\n  body { font-size: 10pt; color: #111; }\n</style>");
    expect(out).toContain(":host { font-size: 10pt; color: #111; }");
    expect(out).not.toMatch(/(^|\s)body\s*\{/);
  });

  it("leaves selectors that merely mention body alone", () => {
    // `.bodycopy` and `td.body-cell` are not the body element.
    const css = "<style>.bodycopy { margin: 0 } td.body-cell { padding: 0 }</style>";
    expect(scopeBodyToHost(css)).toBe(css);
  });

  it("does not touch the markup", () => {
    const out = scopeBodyToHost("<style>body { margin: 0 }</style><p>body of the résumé</p>");
    expect(out).toContain("<p>body of the résumé</p>");
  });

  it("handles a grouped selector by scoping only the body part", () => {
    const out = scopeBodyToHost("<style>html, body { margin: 0 }</style>");
    expect(out).toContain(":host");
    expect(out).not.toMatch(/,\s*body\s*\{/);
  });

  it("leaves a document with no body rule unchanged", () => {
    const css = "<style>h1 { font-size: 16pt }</style>";
    expect(scopeBodyToHost(css)).toBe(css);
  });
});

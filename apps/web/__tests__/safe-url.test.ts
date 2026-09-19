import { describe, it, expect } from "vitest";
import { safeHref } from "../lib/safe-url";

describe("safeHref", () => {
  it("keeps http(s) links and completes a bare domain", () => {
    expect(safeHref("https://github.com/jane")).toBe("https://github.com/jane");
    expect(safeHref("linkedin.com/in/jane")).toBe("https://linkedin.com/in/jane");
  });

  it("refuses anything that could run code or isn't a web address", () => {
    expect(safeHref("javascript:alert(document.cookie)")).toBeNull();
    expect(safeHref("  JaVaScRiPt:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeHref("vbscript:msgbox(1)")).toBeNull();
    expect(safeHref("")).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
});

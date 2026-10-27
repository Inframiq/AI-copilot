import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Page sections must never be left a containing block for position:fixed.
 * Their entry animation once kept its end state (an identity transform) and
 * a will-change: transform, so every pop-up inside a section sized to that
 * section and sat under the phone's tab bar, which took its taps. Measured
 * live with ~/.kripax-dev/fixed-trap.mjs; this keeps the CSS from going back.
 */
const css = readFileSync(join(__dirname, "../app/globals.css"), "utf-8");

function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} not found in globals.css`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
}

describe("entry animations leave no containing block for pop-ups", () => {
  for (const selector of [".page-enter > div > *", ".sheet-enter"]) {
    it(`${selector} holds no end state and promises no transform`, () => {
      const body = rule(selector);
      expect(body).toMatch(/animation:[^;]*\bbackwards\b/);
      expect(body).not.toMatch(/animation:[^;]*\b(both|forwards)\b/);
      expect(body).not.toMatch(/will-change:[^;]*transform/);
    });
  }

  it("the page animation's last frame is no transform at all", () => {
    const at = css.indexOf("@keyframes card-enter");
    const block = css.slice(at, css.indexOf("\n}", at));
    expect(block).toMatch(/to\s*{[^}]*transform:\s*none/);
  });
});

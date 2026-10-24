import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// RFC 9116: where to report a vulnerability. A file past its Expires date
// counts as absent, so this fails a month before it lapses.
describe("/.well-known/security.txt", () => {
  const txt = readFileSync(join(process.cwd(), "public/.well-known/security.txt"), "utf8");

  it("names a contact and the canonical address", () => {
    expect(txt).toMatch(/^Contact: mailto:\S+@\S+$/m);
    expect(txt).toMatch(/^Canonical: https:\/\/kripax\.inframiq\.com\/\.well-known\/security\.txt$/m);
  });

  it("has not expired, and will not within the next month", () => {
    const expires = Date.parse(txt.match(/^Expires: (.+)$/m)![1]);
    expect(expires - Date.now()).toBeGreaterThan(30 * 24 * 3600 * 1000);
  });
});

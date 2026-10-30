import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COUNTRY_CODES, tidyPhone } from "@/lib/phone";

const CASES = JSON.parse(
  readFileSync(join(process.cwd(), "..", "..", "packages", "types", "phone-cases.json"), "utf8"),
) as { tidy: [string, string][]; unchanged: string[] };

describe("a phone number is written the standard way", () => {
  it.each(CASES.tidy)("%s → %s", (raw, tidy) => {
    expect(tidyPhone(raw)).toBe(tidy);
    expect(tidyPhone(tidy)).toBe(tidy);
  });

  it.each(CASES.unchanged)("leaves %s as written", (raw) => {
    expect(tidyPhone(raw)).toBe(raw);
  });

  it("knows the same country codes as the résumé reader", () => {
    const py = readFileSync(join(process.cwd(), "..", "api", "app", "services", "phone.py"), "utf8");
    const listed = /COUNTRY_CODES = frozenset\("""([\s\S]*?)"""/.exec(py)?.[1].trim().split(/\s+/) ?? [];
    expect([...COUNTRY_CODES].sort()).toEqual(listed.sort());
  });
});

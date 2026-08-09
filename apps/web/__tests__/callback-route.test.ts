import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/app/(auth)/callback/route";

describe("safeNextPath", () => {
  it("allows a same-origin relative path", () => {
    expect(safeNextPath("/studio")).toBe("/studio");
  });

  it("falls back to /dashboard when next is missing", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
  });

  it("rejects an absolute off-site URL", () => {
    expect(safeNextPath("https://evil.com/login")).toBe("/dashboard");
  });

  it("rejects a protocol-relative off-site URL", () => {
    expect(safeNextPath("//evil.com")).toBe("/dashboard");
  });

  it("rejects a backslash-based off-site URL", () => {
    expect(safeNextPath("/\\evil.com")).toBe("/dashboard");
  });

  it("rejects a javascript: URL", () => {
    expect(safeNextPath("javascript:alert(1)")).toBe("/dashboard");
  });
});

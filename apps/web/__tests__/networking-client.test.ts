import { describe, it, expect } from "vitest";
import { getInitials, getAvatarColor, AVATAR_COLORS } from "../lib/networking-client";

describe("networking-client helpers", () => {
  it("getInitials returns 2 uppercase letters for two-word name", () => {
    expect(getInitials("Sarah Chen")).toBe("SC");
  });

  it("getInitials uses first 2 chars for single word", () => {
    expect(getInitials("Alice")).toBe("AL");
  });

  it("getInitials uses first two words only", () => {
    expect(getInitials("Mary Jane Watson")).toBe("MJ");
  });

  it("getAvatarColor returns a value in AVATAR_COLORS", () => {
    const color = getAvatarColor("some-uuid-123");
    expect(AVATAR_COLORS as readonly string[]).toContain(color);
  });

  it("getAvatarColor is deterministic", () => {
    expect(getAvatarColor("abc-def")).toBe(getAvatarColor("abc-def"));
  });
});

import { describe, it, expect } from "vitest";
import { dayPart, firstName, greeting, isNewAccount } from "../lib/greeting";

describe("greeting", () => {
  it("welcomes a new account, never 'back'", () => {
    for (const pick of [0, 0.5, 0.99]) {
      const { title } = greeting({ name: "Tanishq", isNew: true, hour: 23, pick });
      expect(title).toContain("Tanishq");
      expect(title.toLowerCase()).not.toContain("back");
    }
  });

  it("greets a returning account by the time of day", () => {
    expect(greeting({ name: "Asha", isNew: false, hour: 9, pick: 0 }).title).toBe("Good morning, Asha");
    expect(greeting({ name: "Asha", isNew: false, hour: 14, pick: 0 }).title).toBe("Good afternoon, Asha");
    expect(greeting({ name: "Asha", isNew: false, hour: 19, pick: 0 }).title).toBe("Good evening, Asha");
    expect(greeting({ name: "Asha", isNew: false, hour: 2, pick: 0 }).title).toBe("Hello, night owl Asha");
  });

  it("varies the line, and every variant names the user", () => {
    const titles = new Set(
      [0, 0.3, 0.6, 0.99].map((pick) => greeting({ name: "Asha", isNew: false, hour: 1, pick }).title),
    );
    expect(titles.size).toBeGreaterThan(1);
    for (const t of titles) expect(t).toContain("Asha");
  });

  it("never leaves a dangling comma when there is no name", () => {
    expect(greeting({ name: "", isNew: false, hour: 9, pick: 0.5 }).title).toBe("Good morning");
    expect(greeting({ name: "", isNew: true, hour: 9, pick: 0.5 }).title).toBe("Welcome");
  });

  it("splits the day at 5, 12, 17 and 22", () => {
    expect([4, 5, 11, 12, 16, 17, 21, 22].map(dayPart)).toEqual([
      "night", "morning", "morning", "afternoon", "afternoon", "evening", "evening", "night",
    ]);
  });

  it("greets by first name", () => {
    expect(firstName("  Tanishq Kumar ")).toBe("Tanishq");
    expect(firstName(null)).toBe("");
  });
});

describe("isNewAccount", () => {
  const created = "2026-09-19T10:00:00Z";

  it("is new during the signup session", () => {
    expect(isNewAccount(created, "2026-09-19T10:00:02Z")).toBe(true);
    expect(isNewAccount(created, null)).toBe(true);
  });

  it("is returning once the user has signed in again", () => {
    expect(isNewAccount(created, "2026-09-20T08:00:00Z")).toBe(false);
  });

  it("is returning when nothing is known", () => {
    expect(isNewAccount(null, null)).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { defaultDestination, destinationOptions, type MiscPoint } from "@/lib/misc-points";

const content = {
  contact: { name: "Jane", email: "" },
  experience: [
    { title: "Engineer", company: "Acme", start: "2024", bullets: [] },
    { title: "Intern", company: "Beta", start: "2023", bullets: [] },
  ],
  projects: [{ name: "Campus Marketplace", bullets: [] }],
  education: [],
  skills: [],
} as never;
const bare = { contact: { name: "", email: "" }, experience: [], education: [], skills: [] } as never;

const point = (section: MiscPoint["section"]): MiscPoint => ({
  id: "p", text: "Did a thing", section, created_at: "",
});

describe("defaultDestination", () => {
  it("puts an experience point under the most recent role, a project point under the first project", () => {
    expect(defaultDestination(point("experience"), content)).toBe("exp:0");
    expect(defaultDestination(point("project"), content)).toBe("proj:0");
  });

  it("falls back to Achievements when the résumé has no role or project for a bullet", () => {
    expect(defaultDestination(point("experience"), bare)).toBe("achievements");
    expect(defaultDestination(point("project"), bare)).toBe("achievements");
  });

  it("keeps list sections and skills, and leaves a miscellaneous point unplaced", () => {
    expect(defaultDestination(point("awards"), content)).toBe("awards");
    expect(defaultDestination(point("skills"), content)).toBe("skills");
    expect(defaultDestination(point("miscellaneous"), content)).toBe("");
  });
});

describe("destinationOptions", () => {
  it("offers every role and project on this résumé, then the list sections and skills", () => {
    expect(destinationOptions(content).map((o) => o.label)).toEqual([
      "Bullet in Engineer · Acme",
      "Bullet in Intern · Beta",
      "Bullet in Campus Marketplace",
      "Achievements", "Awards", "Leadership", "Volunteer", "Skills",
    ]);
  });
});

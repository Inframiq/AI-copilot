import { describe, it, expect } from "vitest";
import { defaultDestination, destinationOptions, MAX_MISC_POINTS, resumeContentToMiscPoints, type MiscPoint } from "@/lib/misc-points";

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

describe("resumeContentToMiscPoints", () => {
  const parsed = {
    contact: { name: "", email: "" }, experience: [], education: [], skills: [],
    summary: "Analyst with five years in procurement.",
    objective: "  ",
    awards: ["Spot Award 2023"],
    achievements: ["Cut lead time 30%"],
    leadership: ["Captain, cricket team"],
    volunteer: ["Taught at NGO weekends", ""],
    languages: [{ name: "English", level: "Native" }, { name: "Hindi", level: "" }],
  } as never;

  it("files each section the profile can't hold under its own place, copied as printed", () => {
    const points = resumeContentToMiscPoints(parsed, []);
    expect(points.map((p) => [p.section, p.text])).toEqual([
      ["awards", "Spot Award 2023"],
      ["achievements", "Cut lead time 30%"],
      ["leadership", "Captain, cricket team"],
      ["volunteer", "Taught at NGO weekends"],
      ["miscellaneous", "Analyst with five years in procurement."],
      ["miscellaneous", "Languages: English (Native), Hindi"],
    ]);
    expect(new Set(points.map((p) => p.id)).size).toBe(points.length);
  });

  it("adds nothing already saved, so uploading the same résumé again changes nothing", () => {
    const first = resumeContentToMiscPoints(parsed, []);
    const kept = first.map((p) => ({ ...p, text: `  ${p.text.toUpperCase()} ` }));
    expect(resumeContentToMiscPoints(parsed, kept)).toEqual([]);
  });

  it("stops at the profile's cap instead of failing the upload", () => {
    const full = Array.from({ length: MAX_MISC_POINTS - 2 }, (_, i) => ({ ...point("awards"), id: `${i}`, text: `n${i}` }));
    expect(resumeContentToMiscPoints(parsed, full)).toHaveLength(2);
  });

  it("gives nothing for a résumé with none of these sections", () => {
    expect(resumeContentToMiscPoints(bare, [])).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { applyMiscPoints, buildMergedContent, type MiscMerge } from "@/stores/tailoring-store";
import type { MiscPoint } from "@/lib/misc-points";
import type { ResumeContent } from "@career-copilot/types";

const base = (): ResumeContent => ({
  contact: { name: "Jane", email: "" },
  experience: [
    { title: "Engineer", company: "Acme", start: "2024", bullets: ["Shipped the billing service."] },
    { title: "Intern", company: "Beta", start: "2023", bullets: [] },
  ],
  projects: [{ name: "Campus Marketplace", bullets: ["Built listings."] }],
  education: [],
  skills: ["Python"],
  awards: ["Dean's list"],
});

const pt = (id: string, text: string, section: MiscPoint["section"]): MiscPoint => ({
  id, text, section, created_at: "",
});
const on = (...ids: string[]) => Object.fromEntries(ids.map((id) => [`misc:${id}`, "accept" as const]));
const merge = (points: MiscPoint[], destinations: MiscMerge["destinations"] = {}): MiscMerge => ({ points, destinations });

describe("applyMiscPoints", () => {
  it("returns the same résumé when no Miscellaneous point is ticked", () => {
    const content = base();
    const misc = merge([pt("a", "Won the hackathon", "awards")]);
    expect(applyMiscPoints(content, misc, {})).toBe(content);
    expect(applyMiscPoints(content, misc, { "misc:a": "reject" })).toBe(content);
  });

  it("adds a ticked point where its section says, without touching the input", () => {
    const content = base();
    const out = applyMiscPoints(
      content,
      merge([
        pt("a", "Led a team of five on the migration", "experience"),
        pt("b", "Added search to the marketplace", "project"),
        pt("c", "Won the college hackathon", "awards"),
        pt("d", "Ran a weekly coding club", "leadership"),
        pt("e", "Docker", "skills"),
      ]),
      on("a", "b", "c", "d", "e"),
    );
    expect(out.experience[0].bullets).toEqual(["Shipped the billing service.", "Led a team of five on the migration"]);
    expect(out.projects?.[0].bullets).toEqual(["Built listings.", "Added search to the marketplace"]);
    expect(out.awards).toEqual(["Dean's list", "Won the college hackathon"]);
    expect(out.leadership).toEqual(["Ran a weekly coding club"]);
    expect(out.skills).toEqual(["Python", "Docker"]);
    expect(content).toEqual(base());
  });

  it("follows the review's destination pick over the saved section", () => {
    const out = applyMiscPoints(
      base(), merge([pt("a", "Mentored new interns", "experience")], { a: "exp:1" }), on("a"),
    );
    expect(out.experience[0].bullets).toHaveLength(1);
    expect(out.experience[1].bullets).toEqual(["Mentored new interns"]);
  });

  it("places a miscellaneous point nowhere until a destination is chosen", () => {
    const point = pt("a", "Speaks Telugu and Hindi", "miscellaneous");
    expect(applyMiscPoints(base(), merge([point]), on("a"))).toEqual(base());
    expect(applyMiscPoints(base(), merge([point], { a: "achievements" }), on("a")).achievements)
      .toEqual(["Speaks Telugu and Hindi"]);
  });

  it("skips what the résumé already says and what would break a cap", () => {
    const content = base();
    content.experience[1].bullets = Array.from({ length: 7 }, (_, i) => `Bullet number ${i}`);
    const out = applyMiscPoints(
      content,
      merge(
        [
          pt("a", "Shipped the billing service", "experience"),
          pt("b", "Another thing entirely", "experience"),
          pt("c", "dean's list", "awards"),
          pt("d", "python", "skills"),
        ],
        { b: "exp:1" },
      ),
      on("a", "b", "c", "d"),
    );
    expect(out.experience[0].bullets).toEqual(["Shipped the billing service."]);
    expect(out.experience[1].bullets).toHaveLength(7);
    expect(out.awards).toEqual(["Dean's list"]);
    expect(out.skills).toEqual(["Python"]);
  });

  it("sends a project point to Achievements when the résumé has no projects", () => {
    const content = { ...base(), projects: undefined };
    const out = applyMiscPoints(content, merge([pt("a", "Built a chess engine", "project")]), on("a"));
    expect(out.achievements).toEqual(["Built a chess engine"]);
    expect("projects" in out && out.projects !== undefined).toBe(false);
  });
});

describe("buildMergedContent with Miscellaneous", () => {
  it("is unchanged by untouched Miscellaneous points", () => {
    const misc = merge([pt("a", "Won the hackathon", "awards")]);
    expect(buildMergedContent(base(), base(), {}, [], [], {}, misc)).toEqual(
      buildMergedContent(base(), base(), {}, [], [], {}),
    );
  });

  it("folds in a ticked point", () => {
    const misc = merge([pt("a", "Won the hackathon", "awards")]);
    expect(buildMergedContent(base(), base(), on("a"), [], [], {}, misc).awards)
      .toEqual(["Dean's list", "Won the hackathon"]);
  });
});

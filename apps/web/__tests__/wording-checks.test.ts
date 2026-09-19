import { describe, it, expect } from "vitest";
import type { ResumeContent } from "@career-copilot/types";
import { findRepetition, listBullets, numberGaps, quantifiedShare } from "../lib/wording-checks";

const content = {
  contact: { name: "A", email: "a@b.c" },
  experience: [
    {
      title: "Engineer", company: "Acme", start: "2020",
      bullets: [
        "Led platform development for the internal platform.",
        "Led quarterly planning for platform development.",
        "Led a squad of 6 engineers on platform development work.",
        "Rebuilt the service scaffolding.",
      ],
    },
  ],
  projects: [{ name: "Transit", bullets: ["Built a dashboard for riders."] }],
  education: [],
  skills: [],
} as unknown as ResumeContent;

describe("listBullets", () => {
  it("keys bullets the way the pipeline does", () => {
    expect(listBullets(content).map((b) => b.key)).toEqual([
      "exp0_b0", "exp0_b1", "exp0_b2", "exp0_b3", "proj0_b0",
    ]);
    expect(listBullets(content)[0].where).toBe("Engineer · Acme");
  });
});

describe("findRepetition", () => {
  it("reports an opening verb and a phrase used in three or more bullets", () => {
    const { verbs, phrases } = findRepetition(listBullets(content));
    expect(verbs).toEqual([{ text: "led", count: 3 }]);
    expect(phrases).toContainEqual({ text: "platform development", count: 3 });
  });

  it("counts a phrase once per bullet", () => {
    const b = [{ key: "x", where: "", text: "Built the component library and a component library site." }];
    expect(findRepetition(b).phrases).toEqual([]);
  });

  it("ignores phrases made of filler words", () => {
    const b = ["Fixed it for the team", "Shipped it for the team", "Built it for the team"].map(
      (text, i) => ({ key: `k${i}`, where: "", text }),
    );
    expect(findRepetition(b).phrases).toEqual([]);
  });
});

describe("numberGaps", () => {
  it("lists bullets with a question and no number", () => {
    const gaps = numberGaps(listBullets(content), {
      exp0_b3: "How much faster did new services start?",
      exp0_b2: "How many engineers?", // already has "6" — not a gap
    });
    expect(gaps.map((g) => g.key)).toEqual(["exp0_b3"]);
    expect(gaps[0].question).toMatch(/faster/);
  });
});

describe("quantifiedShare", () => {
  it("is the share of bullets with a number", () => {
    expect(quantifiedShare(listBullets(content))).toBeCloseTo(1 / 5);
  });
});

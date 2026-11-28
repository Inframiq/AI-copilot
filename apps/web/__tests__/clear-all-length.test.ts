import { describe, it, expect } from "vitest";
import { buildMergedContent, deriveBulletChanges } from "@/stores/tailoring-store";
import { clearDecisions } from "@/components/studio/review/PointsLedger";
import type { AtsFix } from "@/lib/api-client";
import type { ResumeContent } from "@career-copilot/types";

// A tester turned every point off, applied, and got a LONGER résumé than
// before. Two reasons: a reworded point turned off returns to the original
// wording (often the longer one), and the summary written for the job stayed
// on — Clear all never touched it, so a résumé without a summary gained one.

const original = (): ResumeContent => ({
  contact: { name: "Jane", email: "" },
  experience: [{
    title: "Engineer", company: "Acme", start: "2023",
    bullets: [
      "Was responsible for building and maintaining the billing service used by every team in the company.",
      "Worked on the payments dashboard.",
    ],
  }],
  education: [],
  skills: ["Python", "React"],
});

const tailored = (): ResumeContent => ({
  ...original(),
  summary: "Backend engineer with three years building billing and payments services in Python for a fintech platform.",
  experience: [{
    ...original().experience[0],
    bullets: ["Built and ran the company-wide billing service.", "Built the payments dashboard in React."],
  }],
});

const fixes: AtsFix[] = [
  { id: "f1", type: "bullet", text: "Cut checkout errors by 30%.", experience_index: 0, gap: "x", importance: "high" } as AtsFix,
];

const words = (c: ResumeContent) =>
  [c.summary ?? "", ...c.experience.flatMap((e) => e.bullets)].join(" ").split(/\s+/).filter(Boolean).length;

describe("Clear all", () => {
  it("gives back the résumé as it was — summary included", () => {
    const changes = deriveBulletChanges(tailored(), original());
    const decisions = clearDecisions(changes, fixes, []);
    const merged = buildMergedContent(tailored(), original(), decisions, [], fixes);
    expect(merged.summary).toBeUndefined();
    expect(merged.experience[0].bullets).toEqual(original().experience[0].bullets);
    expect(words(merged)).toBe(words(original()));
  });

  it("keeps the user's own summary when there was one", () => {
    const mine = { ...original(), summary: "My own summary." };
    const decisions = clearDecisions(deriveBulletChanges(tailored(), mine), fixes, []);
    expect(buildMergedContent(tailored(), mine, decisions, [], fixes).summary).toBe("My own summary.");
  });

  // Why the meter no longer says "turn points off" to shorten: turning off
  // a tighter rewrite brings back the longer original.
  it("can be longer than the tailored version, since rewrites are often tighter", () => {
    const changes = deriveBulletChanges(tailored(), original());
    const allOn = buildMergedContent(tailored(), original(), Object.fromEntries(changes.map((c) => [c.key, "accept"])), [], []);
    const allOff = buildMergedContent(tailored(), original(), clearDecisions(changes, [], []), [], []);
    const bulletWords = (c: ResumeContent) => c.experience[0].bullets.join(" ").split(/\s+/).length;
    expect(bulletWords(allOff)).toBeGreaterThan(bulletWords(allOn));
  });
});

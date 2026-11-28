// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildMergedContent, scoreStepDeltas, scoreSteps, SCORE_STEPS } from "@/stores/tailoring-store";
import { ScoreBreakdown } from "@/components/studio/review/ScoreRail";
import type { AtsFix } from "@/lib/api-client";
import type { ResumeContent } from "@career-copilot/types";

// A tester saw 19 → 100 with one point badged +39 and every reworded point
// ±0, and asked where the rest came from. The review now scores its résumé
// built up one kind of change at a time and lists what each kind added.

const original = (): ResumeContent => ({
  contact: { name: "Jane", email: "" },
  headline: "Sales Associate",
  experience: [{ title: "Rep", company: "Acme", start: "2023", bullets: ["Sold products.", "Met customers."] }],
  education: [],
  skills: ["Sales"],
});
const pending = (): ResumeContent => ({
  ...original(),
  summary: "Pharmaceutical sales representative.",
  experience: [{ ...original().experience[0], bullets: ["Sold pharmaceutical products.", "Met physicians weekly."] }],
});
const fixes = [
  { id: "headline:x", type: "headline", text: "Pharmaceutical Sales Representative", gap: "title", importance: "high", grounded: true },
  { id: "bullet:y", type: "bullet", text: "Hit 120% of quota.", gap: "quota", importance: "medium", grounded: false, experience_index: 0 },
] as AtsFix[];
const misc = { points: [], destinations: {} };

describe("scoreSteps", () => {
  const decisions = { "fix:headline:x": "accept", "fix:bullet:y": "accept", "skill_add:CRM": "accept" } as const;
  const steps = scoreSteps(pending(), original(), { ...decisions }, ["CRM"], fixes, {}, misc);

  it("has one step per kind, in order", () => {
    expect(steps.map((s) => s.key)).toEqual([...SCORE_STEPS]);
  });

  it("starts from the résumé with nothing on", () => {
    const start = steps[0];
    expect(start.content.headline).toBe("Sales Associate");
    expect(start.content.summary).toBeUndefined();
    expect(start.content.experience[0].bullets).toEqual(["Sold products.", "Met customers."]);
    expect(start.content.skills).toEqual(["Sales"]);
    expect(start.accepted_bullet_ids).toEqual([]);
    expect(start.accepted_fix_ids).toEqual([]);
  });

  it("adds one kind at a time", () => {
    const by = Object.fromEntries(steps.map((s) => [s.key, s]));
    expect(by.headline.content.headline).toBe("Pharmaceutical Sales Representative");
    expect(by.headline.content.summary).toBeUndefined();
    expect(by.summary.content.summary).toBe("Pharmaceutical sales representative.");
    expect(by.summary.accepted_bullet_ids).toEqual([]);
    expect(by.reworded.accepted_bullet_ids).toEqual(["exp0_b0", "exp0_b1"]);
    expect(by.reworded.content.experience[0].bullets).toHaveLength(2);
    expect(by.ai_points.content.experience[0].bullets).toContain("Hit 120% of quota.");
    expect(by.ai_points.content.skills).toEqual(["Sales"]);
    expect(by.skills.content.skills).toEqual(["Sales", "CRM"]);
  });

  it("ends on exactly the résumé being scored", () => {
    const merged = buildMergedContent(pending(), original(), { ...decisions }, ["CRM"], fixes, {}, misc);
    expect(steps.at(-1)!.content).toEqual(merged);
    expect(steps.at(-1)!.accepted_fix_ids).toEqual(["headline:x", "bullet:y"]);
  });

  it("keeps a choice the user made to turn something off", () => {
    const off = scoreSteps(pending(), original(), { summary: "reject", exp0_b1: "reject" }, [], fixes, {}, misc);
    expect(off.find((s) => s.key === "summary")!.content.summary).toBeUndefined();
    expect(off.find((s) => s.key === "reworded")!.accepted_bullet_ids).toEqual(["exp0_b0"]);
  });
});

describe("scoreStepDeltas", () => {
  it("adds up to the whole gain", () => {
    const rows = scoreStepDeltas(
      { start: 19, headline: 58, summary: 80, reworded: 92, ai_points: 96, skills: 100, misc: 100 }, 19,
    )!;
    expect(rows.map((r) => r.delta)).toEqual([0, 39, 22, 12, 4, 4, 0]);
    expect(rows.reduce((n, r) => n + r.delta, 0)).toBe(100 - 19);
  });

  it("is null until every step is scored", () => {
    expect(scoreStepDeltas({ start: 19 }, 19)).toBeNull();
    expect(scoreStepDeltas({}, null)).toBeNull();
  });
});

describe("ScoreBreakdown", () => {
  it("lists what each kind added and leaves out what added nothing", () => {
    render(<ScoreBreakdown rows={[
      { key: "start", delta: 0 }, { key: "headline", delta: 39 }, { key: "summary", delta: 22 },
      { key: "reworded", delta: 20 }, { key: "ai_points", delta: 0 }, { key: "skills", delta: 0 }, { key: "misc", delta: 0 },
    ]} />);
    const list = screen.getByLabelText("Where the points come from");
    expect(list.textContent).toBe("Headline+39Summary for this job+22Reworded points+20");
    expect(screen.getByText(/points that share job terms show ±0/)).toBeInTheDocument();
  });

  it("shows a fall as a fall", () => {
    render(<ScoreBreakdown rows={[{ key: "reworded", delta: -3 }]} />);
    expect(screen.getByText("−3")).toBeInTheDocument();
  });
});

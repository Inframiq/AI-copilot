// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SkillsCard, rankForAts } from "@/components/studio/review/SkillsCard";
import type { AtsFix } from "@/lib/api-client";

const fix = (name: string, score_delta: number, importance: AtsFix["importance"] = "medium", default_accept = false): AtsFix => ({
  id: `skill:${name.toLowerCase()}`, type: "skill", gap: name, importance, grounded: true,
  text: name, experience_index: null, score_delta, default_accept,
});

function setup(over: Partial<Parameters<typeof SkillsCard>[0]> = {}) {
  const props = {
    originalSkills: ["Git", "Python"],
    suggestedSkills: [] as string[],
    skillFixes: [fix("Go", 3), fix("Kubernetes", 7, "high", true), fix("Terraform", 5, "high")],
    matchedSkills: ["Python"],
    decisions: {} as Record<string, string>,
    onDecide: vi.fn(),
    onFixDecision: vi.fn(),
    onApply: vi.fn(),
    ...over,
  };
  render(<SkillsCard {...props} />);
  return props;
}

describe("SkillsCard", () => {
  it("lists the skills to add biggest ATS gain first", () => {
    setup();
    const list = screen.getByRole("list", { name: /skills to add/i });
    const names = within(list).getAllByRole("switch").map((s) => s.getAttribute("aria-label"));
    expect(names).toEqual(["Add Kubernetes (+7 pts)", "Add Terraform (+5 pts)", "Add Go (+3 pts)"]);
  });

  it("says which skills your bullets already evidence", () => {
    setup();
    const k8s = screen.getByRole("switch", { name: /add kubernetes/i }).closest("li")!;
    expect(within(k8s).getByText(/in your experience/i)).toBeTruthy();
    const go = screen.getByRole("switch", { name: /add go/i }).closest("li")!;
    expect(within(go).getByText(/only if you have it/i)).toBeTruthy();
  });

  it("toggles a skill through its fix decision", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("switch", { name: /add terraform/i }));
    expect(p.onFixDecision).toHaveBeenCalledWith("skill:terraform", "accept");
  });

  it("puts job-matching skills you already have first", () => {
    setup();
    const current = screen.getByRole("list", { name: /already on your résumé/i });
    const chips = within(current).getAllByRole("button").map((b) => b.textContent);
    expect(chips[0]).toMatch(/Python/);
  });

  it("fills the budget in ATS order with one click", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: /add in ats order/i }));
    expect(p.onApply).toHaveBeenCalledWith({
      "skill_keep:Git": "accept",
      "skill_keep:Python": "accept",
      "fix:skill:kubernetes": "accept",
      "fix:skill:terraform": "accept",
      "fix:skill:go": "accept",
    });
  });
});

describe("rankForAts", () => {
  it("keeps job-matching skills, then adds by gain, then other skills, within the cap", () => {
    const order = rankForAts({
      original: ["Git", "Python", "Excel"],
      matched: ["Python"],
      candidates: [
        { name: "Go", delta: 3 },
        { name: "Kubernetes", delta: 7 },
        { name: "Scrum", delta: 0 },
      ],
      cap: 4,
    });
    expect(order).toEqual(["Python", "Kubernetes", "Go", "Git"]);
  });

  it("never picks a skill that gains nothing", () => {
    const order = rankForAts({
      original: ["Git"],
      matched: [],
      candidates: [{ name: "Scrum", delta: 0 }, { name: "Go", delta: 2 }],
    });
    expect(order).toEqual(["Go", "Git"]);
  });
});

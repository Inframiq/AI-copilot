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
    const list = screen.getByRole("list", { name: /suggested additions/i });
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
    const current = screen.getByRole("list", { name: /on your résumé now/i });
    // Both halves are switches now — the unified control.
    const chips = within(current).getAllByRole("switch").map((b) => b.textContent);
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
  // Same fault as the points ledger: score_delta is measured once at pipeline
  // time, so a skill whose gap another selection already closed still
  // advertised its full value and delivered none of it.
  it("shows what a skill is worth now, not what it was worth at pipeline time", () => {
    setup({ liveDeltas: { "skill:kubernetes": 2 } });
    expect(screen.getByText("+2 pts")).toBeTruthy();
  });

  it("orders the additions by their live value", () => {
    setup({
      skillFixes: [fix("Kubernetes", 9, "high"), fix("Go", 1, "high")],
      liveDeltas: { "skill:kubernetes": 1, "skill:go": 9 },
    });
    const list = screen.getByRole("list", { name: /suggested additions/i });
    const names = within(list).getAllByRole("switch").map((s) => s.getAttribute("aria-label"));
    expect(names[0]).toMatch(/^Add Go/);
  });

  it("falls back to the pipeline value before a live score lands", () => {
    setup({ liveDeltas: {} });
    expect(screen.getByText("+7 pts")).toBeTruthy();
  });
  // The card read as two unrelated widgets: switches in a list for additions,
  // chips for what you already have, with the shared 20-slot budget metered
  // at the top, far from either.
  it("shows your own skills before the suggestions", () => {
    setup();
    const headings = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(headings[0]).toMatch(/on your résumé/i);
    expect(headings[1]).toMatch(/suggested/i);
  });

  it("counts each group in its heading, so the budget is legible", () => {
    setup();
    const headings = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(headings[0]).toMatch(/\b2\b/);   // Git, Python
    expect(headings[1]).toMatch(/\b3\b/);   // Go, Kubernetes, Terraform
  });

  it("drops the per-skill bars, which said nothing the number did not", () => {
    // The top row's bar was always full width — relative to the biggest gain,
    // not to anything absolute — so it read as "complete" rather than "worth
    // the most", directly beside a number that already said so.
    const { container } = render(<div />);
    container.remove();
    setup();
    expect(screen.queryByTestId("skill-gain-bar")).toBeNull();
  });
  // One decision, one control. The two halves used different idioms — chips
  // for what you have, switches for what you might add — so they read as
  // unrelated widgets rather than two sides of one 20-slot budget.
  it("uses the same control for both halves", () => {
    setup();
    const current = within(screen.getByRole("list", { name: /on your résumé now/i }));
    const adds = within(screen.getByRole("list", { name: /suggested additions/i }));
    expect(current.getAllByRole("switch").length).toBe(2);
    expect(adds.getAllByRole("switch").length).toBe(3);
  });

  it("tells the two halves apart without changing the control", () => {
    setup();
    const mine = screen.getByRole("switch", { name: /keep Git/i });
    const theirs = screen.getByRole("switch", { name: /add Go/i });
    expect(mine.dataset.origin).toBe("yours");
    expect(theirs.dataset.origin).toBe("suggested");
  });

  it("still toggles an existing skill off", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("switch", { name: /keep Git/i }));
    expect(props.onDecide).toHaveBeenCalledWith("skill_keep:Git", "reject");
  });

  it("never offers a skill the résumé already lists", () => {
    setup({ originalSkills: ["Git", "Kubernetes"] });
    const adds = within(screen.getByRole("list", { name: /suggested additions/i }));
    expect(adds.queryByRole("switch", { name: /add kubernetes/i })).toBeNull();
  });

  it("matches on name regardless of case", () => {
    setup({ originalSkills: ["kubernetes"] });
    const adds = within(screen.getByRole("list", { name: /suggested additions/i }));
    expect(adds.queryByRole("switch", { name: /add kubernetes/i })).toBeNull();
  });

  it("offers a suggestion only once when a fix and a plain suggestion share a name", () => {
    setup({ suggestedSkills: ["Terraform", "Airflow"] });
    const adds = within(screen.getByRole("list", { name: /suggested additions/i }));
    expect(adds.getAllByRole("switch", { name: /add terraform/i }).length).toBe(1);
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

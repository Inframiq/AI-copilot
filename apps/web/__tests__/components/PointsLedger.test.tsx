// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { PointsLedger } from "@/components/studio/review/PointsLedger";
import type { AtsFix } from "@/lib/api-client";
import type { BulletChange } from "@/stores/tailoring-store";

const ORIGINAL = {
  contact: { name: "Jane" },
  summary: "",
  experience: [{ title: "Engineer", company: "Acme", bullets: ["Managed deploys.", "Wrote Python."] }],
  education: [],
  skills: ["Python"],
} as never;

const reworded: BulletChange = {
  key: "exp0_b1", jobIdx: 0, bulletIdx: 1, jobTitle: "Engineer", company: "Acme",
  original: "Wrote Python.", tailored: "Built Python services.",
};
const addsTerm: BulletChange = {
  key: "exp0_b0", jobIdx: 0, bulletIdx: 0, jobTitle: "Engineer", company: "Acme",
  original: "Managed deploys.", tailored: "Managed Kubernetes deploys.",
};
const aiBullet: AtsFix = {
  id: "bullet:terraform", type: "bullet", gap: "Terraform", importance: "high", grounded: false,
  text: "Provisioned staging with Terraform.", experience_index: 0, score_delta: 6, default_accept: false,
};

function setup(overrides: Partial<Parameters<typeof PointsLedger>[0]> = {}) {
  const props = {
    changes: [reworded, addsTerm],
    decisions: { exp0_b1: "accept", exp0_b0: "reject" } as Record<string, "accept" | "reject">,
    rationale: {
      exp0_b1: { responsibility: "", keywords: ["Python"], score_delta: 4 },
      exp0_b0: { responsibility: "", keywords: ["Kubernetes"] },
    },
    original: ORIGINAL,
    aiFixes: [aiBullet],
    roles: ["Engineer · Acme"],
    fixExperienceIndex: {},
    onDecide: vi.fn(),
    onBulk: vi.fn(),
    onFixDecide: vi.fn(),
    onFixRole: vi.fn(),
    onRewrite: vi.fn(),
    onEdit: vi.fn(),
    ...overrides,
  };
  render(<PointsLedger {...props} />);
  return props;
}

describe("PointsLedger", () => {
  it("sorts points into reworded, adds-a-term and AI-written groups", () => {
    setup();
    const reworded = screen.getByRole("region", { name: /reworded from your résumé/i });
    expect(within(reworded).getByText(/Built Python services/)).toBeTruthy();
    const adds = screen.getByRole("region", { name: /adds a job-description term/i });
    expect(within(adds).getByText(/adds: Kubernetes/)).toBeTruthy();
    const ai = screen.getByRole("region", { name: /written by ai/i });
    expect(within(ai).getByText(/Provisioned staging with Terraform/)).toBeTruthy();
    expect(within(ai).getByText("+6 pts")).toBeTruthy();
    expect(within(reworded).getByText("+4 pts")).toBeTruthy();
  });

  it("toggles a rewrite with its switch", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("switch", { name: /use this rewrite: Managed Kubernetes/i }));
    expect(p.onDecide).toHaveBeenCalledWith("exp0_b0", "accept");
  });

  it("locks an AI-written point until confirmed, and confirming adds it in one click", () => {
    const p = setup();
    const add = screen.getByRole("switch", { name: /add this new bullet/i }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /i have actually done this/i }));
    expect(add.disabled).toBe(false);
    expect(p.onFixDecide).toHaveBeenCalledWith("bullet:terraform", "accept");
  });

  it("remembers a confirmation when the AI group is filtered away and back", () => {
    setup();
    fireEvent.click(screen.getByRole("checkbox", { name: /i have actually done this/i }));
    fireEvent.click(screen.getByRole("button", { name: /^reworded/i }));
    fireEvent.click(screen.getByRole("button", { name: /^all/i }));
    const vouch = screen.getByRole("checkbox", { name: /i have actually done this/i }) as HTMLInputElement;
    expect(vouch.checked).toBe(true);
  });

  it("puts the points that move the score most first", () => {
    const second: BulletChange = { ...reworded, key: "exp0_b2", bulletIdx: 2, original: "Fixed bugs.", tailored: "Fixed 40 production bugs." };
    setup({
      changes: [reworded, second],
      rationale: {
        exp0_b1: { responsibility: "", keywords: [], score_delta: 2 },
        exp0_b2: { responsibility: "", keywords: [], score_delta: 9 },
      },
    });
    const group = screen.getByRole("region", { name: /reworded from your résumé/i });
    const switches = within(group).getAllByRole("switch");
    expect(switches[0].getAttribute("aria-label")).toMatch(/Fixed 40 production bugs/);
  });

  it("marks a wording-only point as not moving the score", () => {
    setup({
      rationale: {
        exp0_b1: { responsibility: "", keywords: ["Python"], score_delta: 0 },
        exp0_b0: { responsibility: "", keywords: ["Kubernetes"] },
      },
    });
    expect(screen.getByTitle(/wording only/i).textContent).toBe("±0");
  });

  it("flags a JD term the rewrite added without targeting it", () => {
    setup({
      changes: [{ ...reworded, tailored: "Built Python services on Terraform." }],
      rationale: { exp0_b1: { responsibility: "", keywords: [] } },
      jdTerms: ["Terraform"],
    });
    expect(screen.getByText("adds: Terraform")).toBeTruthy();
  });

  it("shows why a point's rewrite failed", () => {
    setup({ rewriteErrors: { exp0_b1: "Couldn't rewrite this point — Out of credits." } });
    expect(screen.getByRole("alert").textContent).toMatch(/out of credits/i);
  });

  it("lists bullets the fact-lock kept as written", () => {
    setup({
      reverted: [{ bullet_id: "exp0_b2", original_text: "Mentored two interns.", rejected_text: "Mentored 5 interns.", reasons: ["added a metric"] }],
    });
    expect(screen.getByText(/1 bullet kept as you wrote it/i)).toBeTruthy();
    expect(screen.getByText(/added a metric/)).toBeTruthy();
  });

  it("withdraws an accepted AI point when the confirmation is withdrawn", () => {
    const p = setup({ decisions: { "fix:bullet:terraform": "accept" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /i have actually done this/i }));
    expect(p.onFixDecide).toHaveBeenCalledWith("bullet:terraform", "reject");
  });

  it("filters to one group", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /written by ai/i }));
    expect(screen.queryByRole("region", { name: /reworded from your résumé/i })).toBeNull();
    expect(screen.getByRole("region", { name: /written by ai/i })).toBeTruthy();
  });

  it("auto-selects every point built on the user's bullets, leaving AI-written ones", () => {
    const p = setup({ decisions: { exp0_b1: "reject", exp0_b0: "reject" } });
    fireEvent.click(screen.getByRole("button", { name: /auto-select/i }));
    expect(p.onBulk).toHaveBeenCalledWith({ exp0_b1: "accept", exp0_b0: "accept" });
  });

  it("clears every point, AI-written included", () => {
    const p = setup({ decisions: { exp0_b1: "accept", "fix:bullet:terraform": "accept" } });
    fireEvent.click(screen.getByRole("button", { name: /clear all/i }));
    expect(p.onBulk).toHaveBeenCalledWith({
      exp0_b1: "reject", exp0_b0: "reject", "fix:bullet:terraform": "reject",
    });
  });

  it("counts how many points are on", () => {
    setup();
    expect(screen.getByText("1 of 3 on")).toBeTruthy();
  });

  it("moves an AI bullet to another role", () => {
    const p = setup({ roles: ["Engineer · Acme", "Intern · Beta"] });
    fireEvent.change(screen.getByRole("combobox", { name: /add to role/i }), { target: { value: "1" } });
    expect(p.onFixRole).toHaveBeenCalledWith("bullet:terraform", 1);
  });
});

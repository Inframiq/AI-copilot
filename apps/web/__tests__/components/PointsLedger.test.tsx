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
      exp0_b1: { responsibility: "", keywords: ["Python"] },
      exp0_b0: { responsibility: "", keywords: ["Kubernetes"] },
    },
    original: ORIGINAL,
    aiFixes: [aiBullet],
    roles: ["Engineer · Acme"],
    fixExperienceIndex: {},
    onDecide: vi.fn(),
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
  });

  it("toggles a rewrite with its checkbox", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("checkbox", { name: /use this rewrite: Managed Kubernetes/i }));
    expect(p.onDecide).toHaveBeenCalledWith("exp0_b0", "accept");
  });

  it("will not add an AI-written point until the user confirms having done it", () => {
    const p = setup();
    const add = screen.getByRole("checkbox", { name: /add this new bullet/i }) as HTMLInputElement;
    expect(add.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /i have actually done this/i }));
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    expect(p.onFixDecide).toHaveBeenCalledWith("bullet:terraform", "accept");
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

  it("accepts every unticked rewording at once", () => {
    const p = setup({ decisions: { exp0_b1: "reject", exp0_b0: "reject" } });
    fireEvent.click(screen.getByRole("button", { name: /accept all reworded/i }));
    expect(p.onDecide).toHaveBeenCalledWith("exp0_b1", "accept");
    expect(p.onDecide).not.toHaveBeenCalledWith("exp0_b0", "accept");
  });

  it("moves an AI bullet to another role", () => {
    const p = setup({ roles: ["Engineer · Acme", "Intern · Beta"] });
    fireEvent.change(screen.getByRole("combobox", { name: /add to role/i }), { target: { value: "1" } });
    expect(p.onFixRole).toHaveBeenCalledWith("bullet:terraform", 1);
  });
});

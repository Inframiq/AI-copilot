// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { AtsGapFixPanel } from "@/components/resume/AtsGapFixPanel";
import { useTailoringStore } from "@/stores/tailoring-store";
import type { AtsFix } from "@/lib/api-client";

const bulletFix: AtsFix = {
  id: "bullet:k8s", type: "bullet", gap: "Kubernetes", importance: "high",
  grounded: false, text: "Operated Kubernetes clusters.", experience_index: 0,
  score_delta: 5, default_accept: false,
};
const skillFix: AtsFix = {
  id: "skill:redis", type: "skill", gap: "Redis", importance: "medium",
  grounded: true, text: "Redis", experience_index: null, score_delta: 3, default_accept: false,
};

describe("AtsGapFixPanel", () => {
  beforeEach(() => {
    useTailoringStore.getState().resetStore();
    useTailoringStore.setState({
      atsScore: 60,
      atsFixes: [bulletFix, skillFix],
      bulletDecisions: {},
      pendingContent: {
        contact: { name: "", email: "" },
        experience: [
          { company: "Acme", title: "Senior Eng", start: "2021", bullets: [] },
          { company: "Beta", title: "Eng", start: "2018", bullets: [] },
        ],
        education: [],
        skills: [],
      },
    } as never);
  });
  afterEach(() => cleanup());

  it("renders bullet/headline fixes only — skill fixes belong in the skills section", () => {
    const { queryByText } = render(<AtsGapFixPanel />);
    expect(queryByText(/Operated Kubernetes clusters/)).not.toBeNull();
    expect(queryByText(/Add skill/)).toBeNull();
  });

  it("has a role picker per bullet fix that calls setFixExperienceIndex", () => {
    const { getByLabelText } = render(<AtsGapFixPanel />);
    const select = getByLabelText(/role for Kubernetes/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "1" } });
    expect(useTailoringStore.getState().fixExperienceIndex["bullet:k8s"]).toBe(1);
  });

  it("accept button calls setFixDecision", () => {
    const { getByRole } = render(<AtsGapFixPanel />);
    fireEvent.click(getByRole("button", { name: /Accept Kubernetes/i }));
    expect(useTailoringStore.getState().bulletDecisions["fix:bullet:k8s"]).toBe("accept");
  });

  it("renders nothing when there are no bullet or headline fixes", () => {
    useTailoringStore.setState({ atsFixes: [skillFix] } as never);
    const { container } = render(<AtsGapFixPanel />);
    expect(container.textContent).toBe("");
  });
});

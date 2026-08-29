// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    rewriteBullet: vi.fn(),
    analyzeJd: vi.fn(),
    generatePdf: vi.fn(),
  },
}));

import { BulletReviewPanel } from "../../components/resume/BulletReviewPanel";
import { useResumeStore } from "../../stores/resume-store";
import { useTailoringStore } from "../../stores/tailoring-store";

describe("BulletReviewPanel", () => {
  beforeEach(() => {
    useResumeStore.getState().resetStore();
    useTailoringStore.getState().resetStore();
  });
  afterEach(() => cleanup());

  it("shows an importance badge on a bullet the JD mapping rated", () => {
    useResumeStore.getState().setResume(
      "resume-1",
      {
        contact: { name: "Jane", email: "jane@example.com" },
        experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did the thing"] }],
        education: [],
        skills: [],
      },
      "ats_clean",
    );
    useTailoringStore.setState({
      pendingContent: {
        contact: { name: "Jane", email: "jane@example.com" },
        experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did the thing with Python"] }],
        education: [],
        skills: [],
      },
      bulletImportance: { exp0_b0: "high" },
    } as never);

    const { getAllByTestId } = render(<BulletReviewPanel />);
    expect(
      getAllByTestId("importance-badge").some((b) => b.getAttribute("data-level") === "high"),
    ).toBe(true);
  });

  const emptyContent = {
    contact: { name: "Jane", email: "jane@example.com" },
    experience: [],
    education: [],
    skills: [],
  };

  const skillFix = {
    id: "skill:kubernetes", type: "skill", gap: "Kubernetes", importance: "high",
    grounded: true, text: "Kubernetes", experience_index: null, score_delta: 8, default_accept: false,
  };

  it("hides a SkillsBlock suggested skill that already appears as a panel skill fix", () => {
    useResumeStore.getState().setResume("resume-1", emptyContent, "ats_clean");
    useTailoringStore.setState({
      pendingContent: emptyContent,
      suggestedSkills: ["Kubernetes", "Redis"],
      atsFixes: [skillFix],
    } as never);

    const { queryByRole } = render(<BulletReviewPanel />);
    expect(queryByRole("button", { name: /Redis/ })).not.toBeNull();
    expect(queryByRole("button", { name: /Kubernetes/ })).toBeNull();
  });

  it("keeps every suggested skill when there are no ats fixes (legacy session)", () => {
    useResumeStore.getState().setResume("resume-1", emptyContent, "ats_clean");
    useTailoringStore.setState({
      pendingContent: emptyContent,
      suggestedSkills: ["Kubernetes", "Redis"],
      atsFixes: [],
    } as never);

    const { queryByRole } = render(<BulletReviewPanel />);
    expect(queryByRole("button", { name: /Redis/ })).not.toBeNull();
    expect(queryByRole("button", { name: /Kubernetes/ })).not.toBeNull();
  });
});

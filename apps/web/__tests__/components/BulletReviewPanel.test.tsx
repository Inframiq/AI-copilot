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

  it("shows a JD-gap skill fix once, as a chip in the single skills section", () => {
    useResumeStore.getState().setResume("resume-1", emptyContent, "ats_clean");
    useTailoringStore.setState({
      pendingContent: emptyContent,
      suggestedSkills: ["Kubernetes", "Redis"],
      atsFixes: [skillFix],
    } as never);

    const { queryAllByRole } = render(<BulletReviewPanel />);
    const k8s = queryAllByRole("button", { name: /Kubernetes/ });
    expect(k8s.length).toBe(1); // the fix chip, not also a plain suggestion
    expect(queryAllByRole("button", { name: /Redis/ }).length).toBe(1);
  });

  it("accepting the gap-skill chip records a fix: decision", () => {
    useResumeStore.getState().setResume("resume-1", emptyContent, "ats_clean");
    useTailoringStore.setState({
      pendingContent: emptyContent,
      suggestedSkills: ["Redis"],
      atsFixes: [skillFix],
    } as never);

    const { getByRole } = render(<BulletReviewPanel />);
    getByRole("button", { name: /Kubernetes/ }).click();
    expect(useTailoringStore.getState().bulletDecisions["fix:skill:kubernetes"]).toBe("accept");
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

  it("shows current → projected ATS score in the review header", () => {
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
      atsScore: 60,
      projectedAtsScore: 72,
      pendingContent: {
        contact: { name: "Jane", email: "jane@example.com" },
        experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did the thing better"] }],
        education: [],
        skills: [],
      },
    } as never);

    const { container } = render(<BulletReviewPanel />);
    expect(container.textContent).toMatch(/ATS Score:\s*60%\s*→\s*72%/);
  });
});

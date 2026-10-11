// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/career-profile-client", () => ({
  getCareerProfile: vi.fn().mockResolvedValue({
    experience: [
      { title: "Intern", company: "Old Co", current: false },
      { title: "Technical Head", company: "Inframiq", current: true },
    ],
  }),
}));
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getResumes: vi.fn().mockResolvedValue([{ id: "r1" }, { id: "r2" }]),
    getJds: vi.fn().mockResolvedValue([
      { id: "jd1", title: "Backend Engineer", created_at: "2026-09-01", ats_score: 70, status: "applied" },
      { id: "jd2", title: "Platform Engineer", created_at: "2026-10-01", ats_score: 80, status: "not_applied" },
    ]),
    getMyQuestions: vi.fn().mockResolvedValue([
      { id: "q1", jd_id: "jd2", practiced_at: "2026-10-02" },
      { id: "q2", jd_id: "jd2", practiced_at: null },
    ]),
    getLatestSession: vi.fn().mockResolvedValue({
      session_id: "s1", jd_id: "jd2", matched_skills: ["Python"], missing_skills: ["Kubernetes", "Terraform"],
    }),
    getLearningItems: vi.fn().mockResolvedValue([
      { id: "l1", skill: "Terraform", source_jd_title: "Platform Engineer", status: "learning", created_at: "2026-10-01" },
    ]),
    addLearningItem: vi.fn().mockResolvedValue({
      id: "l2", skill: "Kubernetes", source_jd_title: "Platform Engineer", status: "not_started", created_at: "2026-10-03",
    }),
    updateLearningItemStatus: vi.fn().mockResolvedValue({}),
    getCareerMilestones: vi.fn().mockResolvedValue([]),
  },
}));

import CareerPathPage from "../app/(app)/career-path/page";
import { apiClient } from "../lib/api-client";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><CareerPathPage /></QueryClientProvider>);
}

describe("CareerPathPage — real data, nothing made up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try { localStorage.clear(); } catch {}
  });

  it("takes the current role from My Profile, and the target from the newest job", async () => {
    renderPage();
    expect(await screen.findByText("Technical Head")).toBeInTheDocument();
    expect(screen.getByText(/· Inframiq/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Target Role/)).toHaveValue("Platform Engineer");
    expect(screen.queryByText(/~6 months/)).not.toBeInTheDocument();
  });

  it("counts milestones from activity", async () => {
    renderPage();
    expect(await screen.findByText(/2 of 3 so far/)).toBeInTheDocument(); // tailored
    expect(screen.getByText(/1 of 10 so far/)).toBeInTheDocument(); // applied
    expect(screen.getByText("1 interview question practiced.")).toBeInTheDocument();
    // résumé + interview prep done; tailoring is the one in progress
    expect(screen.getByText("2/5")).toBeInTheDocument();
    const tailorCard = screen.getByText("Tailor it to 3 target roles").closest("div.flex-1") as HTMLElement;
    expect(within(tailorCard).getByText("In Progress")).toBeInTheDocument();
  });

  it("shows the latest run's skills gap, and adds a missing skill to the learning list", async () => {
    renderPage();
    expect(await screen.findByRole("link", { name: "Platform Engineer" })).toHaveAttribute("href", "/jd/jd2");
    expect(screen.getByText("Python")).toBeInTheDocument();
    // Terraform is already on the list; Kubernetes isn't.
    expect(screen.getByText("On your list")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add Kubernetes to your learning list" }));
    expect(apiClient.addLearningItem).toHaveBeenCalledWith({ skill: "Kubernetes", source_jd_title: "Platform Engineer" });
    expect(await screen.findAllByText("On your list")).toHaveLength(2);
  });

  it("cycles a learning item's status", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /Terraform: Learning — change status/ }));
    expect(apiClient.updateLearningItemStatus).toHaveBeenCalledWith("l1", "done");
    expect(screen.getByRole("button", { name: /Terraform: Done — change status/ })).toBeInTheDocument();
  });
});

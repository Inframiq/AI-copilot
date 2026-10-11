// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getResumes: vi.fn().mockResolvedValue([{ id: "r1", title: "Backend résumé" }]),
    getJds: vi.fn().mockResolvedValue([
      { id: "jd-acme", title: "Senior Backend Engineer — Acme", created_at: "2026-10-01T00:00:00Z", ats_score: 82 },
      { id: "jd-globex", title: "Staff Engineer — Globex", created_at: "2026-09-01T00:00:00Z", ats_score: null },
      { id: "jd-4", title: "JD4", created_at: "2026-08-01T00:00:00Z", ats_score: null, raw_text: "We need a Kubernetes platform engineer." },
    ]),
    getCoverLetters: vi.fn().mockResolvedValue([
      { id: "cl1", jd_id: "jd-globex", status: "completed" },
      { id: "cl2", jd_id: "jd-acme", status: "failed" },
    ]),
    getMyQuestions: vi.fn().mockResolvedValue([{ jd_id: "jd-acme", jd_title: "Senior Backend Engineer — Acme" }]),
  },
}));

import { GlobalSearch } from "../../components/layout/GlobalSearch";
import { apiClient } from "../../lib/api-client";

function renderSearch() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GlobalSearch />
    </QueryClientProvider>,
  );
}

describe("GlobalSearch", () => {
  beforeEach(() => {
    push.mockClear();
    vi.mocked(apiClient.getJds).mockClear();
  });

  it("loads nothing until it's opened", () => {
    renderSearch();
    expect(apiClient.getJds).not.toHaveBeenCalled();
  });

  it("finds a job by any of its words and opens it on Enter", async () => {
    renderSearch();
    const box = screen.getByRole("combobox");
    await userEvent.click(box);
    await userEvent.type(box, "acme back");

    const options = await screen.findAllByRole("option");
    expect(options[0]).toHaveTextContent("Senior Backend Engineer — Acme");
    expect(screen.getByRole("option", { name: /Interview questions — Senior Backend Engineer — Acme/ })).toBeInTheDocument();
    expect(screen.queryByText(/Globex/)).not.toBeInTheDocument();

    await userEvent.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/jd/jd-acme");
  });

  it("finds a generically named job by its text, after title matches", async () => {
    renderSearch();
    const box = screen.getByRole("combobox");
    await userEvent.click(box);
    await userEvent.type(box, "kubernetes");
    const hit = await screen.findByRole("option", { name: /JD4/ });
    expect(hit).toHaveTextContent("in the job text");

    await userEvent.clear(box);
    await userEvent.type(box, "engineer");
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(3));
    const labels = screen.getAllByRole("option").map((o) => o.textContent);
    expect(labels.findIndex((t) => t?.includes("JD4"))).toBeGreaterThan(labels.findIndex((t) => t?.includes("Globex")));
  });

  it("moves through results with the arrow keys", async () => {
    renderSearch();
    const box = screen.getByRole("combobox");
    await userEvent.click(box);
    await userEvent.type(box, "backend");
    await screen.findByRole("option", { name: /Backend résumé/ });
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(push).toHaveBeenCalledWith("/studio/r1");
  });

  it("lists only finished cover letters, named by their job", async () => {
    renderSearch();
    const box = screen.getByRole("combobox");
    await userEvent.click(box);
    await userEvent.type(box, "cover");
    expect(await screen.findByRole("option", { name: /Cover letter — Staff Engineer — Globex/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Cover letter — Senior Backend/ })).not.toBeInTheDocument();
  });

  it("finds pages too, and says when nothing matches", async () => {
    renderSearch();
    const box = screen.getByRole("combobox");
    await userEvent.click(box);
    await userEvent.type(box, "interview cent");
    expect(await screen.findByRole("option", { name: /Interview Center/ })).toBeInTheDocument();

    await userEvent.clear(box);
    await userEvent.type(box, "zzzz");
    await waitFor(() => expect(screen.getByText(/Nothing matches “zzzz”/)).toBeInTheDocument());
  });

  it("Ctrl+K focuses it from anywhere; Escape closes it", async () => {
    renderSearch();
    await userEvent.keyboard("{Control>}k{/Control}");
    const box = screen.getByRole("combobox");
    expect(box).toHaveFocus();
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

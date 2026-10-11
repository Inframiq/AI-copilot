// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({
  apiClient: { getCareerPlan: vi.fn(), saveCareerPlan: vi.fn() },
}));

import { TargetRole } from "../../components/career/TargetRole";
import { apiClient } from "../../lib/api-client";

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TargetRole inputClassName="" />
    </QueryClientProvider>,
  );
}

describe("TargetRole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try { localStorage.clear(); } catch {}
    vi.mocked(apiClient.getCareerPlan).mockResolvedValue({ target_role: "Staff Engineer" });
    vi.mocked(apiClient.saveCareerPlan).mockImplementation(async (p) => p);
  });
  afterEach(() => vi.useRealTimers());

  it("shows the role saved to the account", async () => {
    renderIt();
    expect(await screen.findByDisplayValue("Staff Engineer")).toBeInTheDocument();
  });

  it("saves a moment after typing stops, not on every key", async () => {
    renderIt();
    const box = await screen.findByDisplayValue("Staff Engineer");
    vi.useFakeTimers();
    fireEvent.change(box, { target: { value: "Principal" } });
    fireEvent.change(box, { target: { value: "Principal Engineer" } });
    expect(apiClient.saveCareerPlan).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(800); });
    expect(apiClient.saveCareerPlan).toHaveBeenCalledTimes(1);
    expect(apiClient.saveCareerPlan).toHaveBeenCalledWith({ target_role: "Principal Engineer" });
    vi.useRealTimers();
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("saves straight away on leaving the field; clearing it saves null", async () => {
    renderIt();
    const box = await screen.findByDisplayValue("Staff Engineer");
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.blur(box);
    await waitFor(() => expect(apiClient.saveCareerPlan).toHaveBeenCalledWith({ target_role: null }));
  });

  it("says so when it couldn't save, and retries", async () => {
    vi.mocked(apiClient.saveCareerPlan).mockRejectedValueOnce(new Error("500"));
    renderIt();
    const box = await screen.findByDisplayValue("Staff Engineer");
    fireEvent.change(box, { target: { value: "CTO" } });
    fireEvent.blur(box);
    const retry = await screen.findByRole("button", { name: /Couldn't save — try again/ });
    expect(box).toHaveValue("CTO"); // what you typed is kept
    fireEvent.click(retry);
    await waitFor(() => expect(apiClient.saveCareerPlan).toHaveBeenLastCalledWith({ target_role: "CTO" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("moves a role kept on this device into the account, once", async () => {
    vi.mocked(apiClient.getCareerPlan).mockResolvedValue({ target_role: null });
    localStorage.setItem("career-copilot-target-role", "Engineering Manager");
    renderIt();
    await waitFor(() => expect(apiClient.saveCareerPlan).toHaveBeenCalledWith({ target_role: "Engineering Manager" }));
    expect(await screen.findByDisplayValue("Engineering Manager")).toBeInTheDocument();
    expect(localStorage.getItem("career-copilot-target-role")).toBeNull();
  });

  it("an account role wins over a stale one on this device", async () => {
    localStorage.setItem("career-copilot-target-role", "Old note");
    renderIt();
    expect(await screen.findByDisplayValue("Staff Engineer")).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem("career-copilot-target-role")).toBeNull());
    expect(apiClient.saveCareerPlan).not.toHaveBeenCalled();
  });
});

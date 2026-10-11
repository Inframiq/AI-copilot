// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getCareerMilestones: vi.fn(),
    addCareerMilestone: vi.fn(),
    updateCareerMilestone: vi.fn(),
    deleteCareerMilestone: vi.fn(),
  },
}));

import { UserMilestones } from "../../components/career/UserMilestones";
import { apiClient } from "../../lib/api-client";

const aws = { id: "m1", title: "Get AWS certified", description: "Associate level", done: false, created_at: "2026-10-01" };

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <UserMilestones />
    </QueryClientProvider>,
  );
}

describe("UserMilestones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.getCareerMilestones).mockResolvedValue([aws]);
  });

  it("adds a milestone from the inline form", async () => {
    vi.mocked(apiClient.addCareerMilestone).mockResolvedValue({
      id: "m2", title: "Ship a side project", description: null, done: false, created_at: "2026-10-02",
    });
    renderIt();
    await screen.findByText("Get AWS certified");

    await userEvent.click(screen.getByRole("button", { name: "Add milestone" }));
    const name = screen.getByLabelText("Milestone");
    expect(name).toHaveFocus();
    await userEvent.type(name, "  Ship a side project ");
    await userEvent.click(screen.getByRole("button", { name: "Add milestone" }));

    expect(apiClient.addCareerMilestone).toHaveBeenCalledWith({ title: "Ship a side project", description: null });
    expect(await screen.findByText("Ship a side project")).toBeInTheDocument();
    expect(screen.queryByLabelText("Milestone")).not.toBeInTheDocument();
  });

  it("won't add a nameless milestone", async () => {
    renderIt();
    await userEvent.click(await screen.findByRole("button", { name: "Add milestone" }));
    await userEvent.click(screen.getByRole("button", { name: "Add milestone" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Give the milestone a name.");
    expect(apiClient.addCareerMilestone).not.toHaveBeenCalled();
  });

  it("ticks one off, and undoes the tick with a message if it didn't save", async () => {
    vi.mocked(apiClient.updateCareerMilestone).mockResolvedValueOnce({ ...aws, done: true });
    renderIt();
    const box = await screen.findByRole("checkbox", { name: /Mark done: Get AWS certified/ });
    await userEvent.click(box);
    expect(apiClient.updateCareerMilestone).toHaveBeenCalledWith("m1", { done: true });
    expect(screen.getByRole("checkbox", { name: /Mark not done/ })).toHaveAttribute("aria-checked", "true");

    vi.mocked(apiClient.updateCareerMilestone).mockRejectedValueOnce(new Error("500"));
    await userEvent.click(screen.getByRole("checkbox", { name: /Mark not done/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save that. Try again.");
    expect(screen.getByRole("checkbox", { name: /Get AWS certified/ })).toHaveAttribute("aria-checked", "true");
  });

  it("deletes only on the second tap", async () => {
    vi.mocked(apiClient.deleteCareerMilestone).mockResolvedValue(undefined);
    renderIt();
    await userEvent.click(await screen.findByRole("button", { name: /Delete milestone: Get AWS certified/ }));
    expect(apiClient.deleteCareerMilestone).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete?" }));
    expect(apiClient.deleteCareerMilestone).toHaveBeenCalledWith("m1");
    await waitFor(() => expect(screen.queryByText("Get AWS certified")).not.toBeInTheDocument());
  });
});

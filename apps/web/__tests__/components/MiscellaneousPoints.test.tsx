// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { getCareerProfile, setMiscPoints } = vi.hoisted(() => ({
  getCareerProfile: vi.fn(),
  setMiscPoints: vi.fn(),
}));
vi.mock("@/lib/career-profile-client", () => ({ getCareerProfile, setMiscPoints }));

import { MiscellaneousPoints } from "@/components/profile/MiscellaneousPoints";

const a = { id: "a", text: "Won the hackathon", section: "awards", created_at: "" };
const b = { id: "b", text: "Docker", section: "skills", created_at: "" };

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MiscellaneousPoints />
    </QueryClientProvider>,
  );
}

describe("MiscellaneousPoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCareerProfile.mockResolvedValue({ miscellaneous: [a, b] });
    setMiscPoints.mockImplementation(async (points) => ({ miscellaneous: points }));
  });

  it("lists the saved points under their sections", async () => {
    renderList();
    expect(await screen.findByRole("heading", { name: "Awards" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Skills" })).toBeTruthy();
    expect(
      screen.getAllByRole("textbox", { name: "Saved point" }).map((t) => (t as HTMLTextAreaElement).value),
    ).toEqual(["Won the hackathon", "Docker"]);
  });

  it("saves an edit when the field loses focus, and puts back an emptied one", async () => {
    renderList();
    const user = userEvent.setup();
    const [first] = await screen.findAllByRole("textbox", { name: "Saved point" });
    await user.clear(first);
    await user.tab();
    expect(setMiscPoints).not.toHaveBeenCalled();
    expect(first).toHaveValue("Won the hackathon");

    await user.type(first, " in 2024");
    await user.tab();
    await waitFor(() =>
      expect(setMiscPoints).toHaveBeenCalledWith([{ ...a, text: "Won the hackathon in 2024" }, b]),
    );
  });

  it("re-files and deletes straight away", async () => {
    renderList();
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByRole("combobox", { name: /Docker/ }), "achievements");
    await waitFor(() => expect(setMiscPoints).toHaveBeenLastCalledWith([a, { ...b, section: "achievements" }]));
    await user.click(await screen.findByRole("button", { name: /Delete: Won the hackathon/ }));
    await waitFor(() => expect(setMiscPoints).toHaveBeenLastCalledWith([{ ...b, section: "achievements" }]));
  });

  it("lists an upload's loose points under the heading they were printed under", async () => {
    const duty = { id: "d", text: "Monitored SOC alerts", section: "miscellaneous", heading: "Roles and Responsibilities", created_at: "" };
    const note = { id: "n", text: "Mentors juniors", section: "miscellaneous", created_at: "" };
    getCareerProfile.mockResolvedValue({ miscellaneous: [a, duty, note] });
    renderList();
    expect(await screen.findByRole("heading", { name: "Roles and Responsibilities" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Miscellaneous" })).toBeTruthy();

    // Filed under a section, it's that section's now — the heading goes.
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole("combobox", { name: /Monitored SOC alerts/ }), "experience");
    await waitFor(() => expect(setMiscPoints).toHaveBeenLastCalledWith([
      a, { id: "d", text: "Monitored SOC alerts", section: "experience", created_at: "" }, note,
    ]));
  });

  it("explains an empty list", async () => {
    getCareerProfile.mockResolvedValue({ miscellaneous: [] });
    renderList();
    expect(await screen.findByText(/Nothing here yet/)).toBeTruthy();
  });

  it("says when Miscellaneous isn't available yet", async () => {
    getCareerProfile.mockResolvedValue({ contact: {} });
    renderList();
    expect(await screen.findByText(/isn't available yet/)).toBeTruthy();
  });
});

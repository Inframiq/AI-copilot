// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { getCareerProfile, appendMiscPoints, restructureNotes } = vi.hoisted(() => ({
  getCareerProfile: vi.fn(),
  appendMiscPoints: vi.fn(),
  restructureNotes: vi.fn(),
}));
vi.mock("@/lib/career-profile-client", () => ({ getCareerProfile, appendMiscPoints }));
vi.mock("@/lib/api-client", () => ({ apiClient: { restructureNotes } }));

import { MiscNotesCanvas } from "@/components/misc/MiscNotesCanvas";

const profile = (miscellaneous?: unknown[]) => ({
  user_id: "u", contact: {}, ...(miscellaneous ? { miscellaneous } : {}),
});

function renderCanvas() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MiscNotesCanvas />
    </QueryClientProvider>,
  );
}

async function typeAndSave(text: string) {
  renderCanvas();
  const user = userEvent.setup();
  await user.type(await screen.findByRole("textbox", { name: "Your note" }), text);
  await waitFor(() => expect(screen.getByRole("button", { name: /^save/i })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: /^save/i }));
  return user;
}

describe("MiscNotesCanvas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCareerProfile.mockResolvedValue(profile([]));
  });

  it("tidies the note, lets the user edit and re-file, and saves what they confirm", async () => {
    restructureNotes.mockResolvedValue({
      points: [
        { text: "Led the college robotics club", section: "leadership", flags: [] },
        { text: "Won the 2024 hackathon", section: "awards", flags: [] },
      ],
    });
    appendMiscPoints.mockImplementation(async (points) => profile(points));
    const user = await typeAndSave("led robotics club, won 2024 hackathon");

    expect(restructureNotes).toHaveBeenCalledWith("led robotics club, won 2024 hackathon");
    const first = await screen.findByRole("textbox", { name: "Point 1" });
    await user.clear(first);
    await user.type(first, "Led the robotics club for two years");
    await user.selectOptions(screen.getByRole("combobox", { name: "Section for point 2" }), "achievements");
    await user.click(screen.getByRole("button", { name: "Save to profile" }));

    await waitFor(() => expect(appendMiscPoints).toHaveBeenCalled());
    expect(appendMiscPoints.mock.calls[0][0]).toMatchObject([
      { text: "Led the robotics club for two years", section: "leadership" },
      { text: "Won the 2024 hackathon", section: "achievements" },
    ]);
    expect(await screen.findByRole("status")).toHaveTextContent("Saved 2 points to your profile.");
  });

  it("shows the fact-lock's flags, and saves nothing for a removed point", async () => {
    restructureNotes.mockResolvedValue({
      points: [
        { text: "Cut build time by 40%", section: "experience", flags: ["Adds a number you didn't write: 40"] },
        { text: "Docker", section: "skills", flags: [] },
      ],
    });
    appendMiscPoints.mockImplementation(async (points) => profile(points));
    const user = await typeAndSave("made builds faster with docker");

    expect(await screen.findByText(/Adds a number you didn't write: 40/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Remove point 1" }));
    await user.click(screen.getByRole("button", { name: "Save to profile" }));
    await waitFor(() => expect(appendMiscPoints).toHaveBeenCalled());
    expect(appendMiscPoints.mock.calls[0][0]).toHaveLength(1);
    expect(appendMiscPoints.mock.calls[0][0][0]).toMatchObject({ text: "Docker", section: "skills" });
  });

  it("measures a bullet against the résumé standard and asks for what would make it stronger", async () => {
    restructureNotes.mockResolvedValue({
      points: [
        {
          text: "Led the college robotics club", section: "leadership", flags: [],
          ask: "How many members did it grow to?",
        },
        { text: "First place, Inter-College Hackathon 2024", section: "awards", flags: [], ask: "" },
      ],
    });
    const user = await typeAndSave("led robotics club, won 2024 hackathon");

    expect(await screen.findByText(/5 words · short — strong bullets run 15–28/)).toBeTruthy();
    expect(screen.getByText(/How many members did it grow to\?/)).toBeTruthy();
    // An award is a line, not a bullet: no word count for it.
    expect(screen.getAllByText(/words ·/)).toHaveLength(1);

    const first = screen.getByRole("textbox", { name: "Point 1" });
    await user.type(first, ", growing it from 12 to 40 members through weekly build nights and a regional competition entry");
    expect(screen.getByText(/2[0-9] words · a good length/)).toBeTruthy();
  });

  it("keeps the user's text when tidying fails, and says so", async () => {
    restructureNotes.mockRejectedValue(new Error("Not enough credits"));
    await typeAndSave("won an award");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Not enough credits.*Your text is unchanged/);
    expect(screen.getByRole("textbox", { name: "Your note" })).toHaveValue("won an award");
  });

  it("Discard goes back to the note as written", async () => {
    restructureNotes.mockResolvedValue({ points: [{ text: "Won an award", section: "awards", flags: [] }] });
    const user = await typeAndSave("won an award");
    await user.click(await screen.findByRole("button", { name: /discard/i }));
    expect(screen.getByRole("textbox", { name: "Your note" })).toHaveValue("won an award");
    expect(appendMiscPoints).not.toHaveBeenCalled();
  });

  it("says a save failed without losing the points", async () => {
    restructureNotes.mockResolvedValue({ points: [{ text: "Won an award", section: "awards", flags: [] }] });
    appendMiscPoints.mockRejectedValue(new Error("network down"));
    const user = await typeAndSave("won an award");
    await user.click(await screen.findByRole("button", { name: "Save to profile" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/network down.*Nothing was lost/);
    expect(screen.getByRole("textbox", { name: "Point 1" })).toHaveValue("Won an award");
  });

  it.each([
    ["there is no profile yet", null, /once first/],
    ["the database isn't ready", profile(), /isn't available yet/],
    ["the profile is full", profile(Array.from({ length: 50 }, (_, i) => ({ id: String(i) }))), /already keeps 50 points/],
  ])("won't spend a credit when %s", async (_why, row, message) => {
    getCareerProfile.mockResolvedValue(row);
    renderCanvas();
    await userEvent.setup().type(await screen.findByRole("textbox", { name: "Your note" }), "won an award");
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^save/i })).toBeDisabled();
    expect(restructureNotes).not.toHaveBeenCalled();
  });

  it("won't send a note over 2,000 characters", async () => {
    renderCanvas();
    const user = userEvent.setup();
    const box = await screen.findByRole("textbox", { name: "Your note" });
    // Pasted, not typed: 2,001 keystrokes is slow for no gain.
    await user.click(box);
    await user.paste("a".repeat(2001));
    expect(screen.getByText("2001 / 2000")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^save/i })).toBeDisabled();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Resume, ResumeContent } from "@career-copilot/types";

vi.mock("@/lib/api-client", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { updateResume: vi.fn(), getResume: vi.fn() } };
});

import { ResumeConflictModal } from "../../components/resume/ResumeConflictModal";
import { useResumeStore } from "../../stores/resume-store";
import { apiClient, ApiError } from "../../lib/api-client";

const CONTENT: ResumeContent = { contact: { name: "Jane", email: "jane@example.com" }, experience: [], education: [], skills: ["Mine"] };
const V1 = "2026-10-12T10:00:00+00:00";
const V2 = "2026-10-12T10:05:00+00:00";
const V3 = "2026-10-12T10:06:00+00:00";

const resume = (updated_at: string, skills: string[]): Resume => ({
  id: "r1", user_id: "u1", title: "Mine", template_id: "ats_clean", content: { ...CONTENT, skills },
  line_spacing: 1.25, paragraph_spacing: 12, font_choice: "sans", accent_color: null,
  heading_size_delta: 0, body_size_delta: 0, created_at: V1, updated_at,
});

const refused = (theirs: string) =>
  new ApiError(409, "This résumé was changed on another device.", {
    code: "resume_changed", message: "This résumé was changed on another device.", updated_at: theirs,
  });

/** An edit here whose save the server refused: the conflict is open. */
async function conflict() {
  const s = useResumeStore.getState();
  s.setResume("r1", CONTENT, "ats_clean", undefined, undefined, undefined, undefined, undefined, undefined, V1);
  vi.mocked(apiClient.updateResume).mockRejectedValueOnce(refused(V2));
  s.updateContent({ skills: ["Mine"] });
  await s.saveNow().catch(() => {});
}

describe("ResumeConflictModal", () => {
  beforeEach(() => {
    useResumeStore.getState().resetStore();
    vi.clearAllMocks();
  });

  it("stays out of the way until a save is refused", async () => {
    render(<ResumeConflictModal />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await conflict();
    expect(await screen.findByRole("alertdialog", { name: /changed on another device/i })).toBeTruthy();
  });

  it("can't be waved away — Escape and the backdrop leave it asking", async () => {
    await conflict();
    render(<ResumeConflictModal />);
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("Keep mine saves this copy over the other and closes", async () => {
    await conflict();
    vi.mocked(apiClient.updateResume).mockResolvedValueOnce(resume(V3, ["Mine"]));
    render(<ResumeConflictModal />);
    await userEvent.click(screen.getByRole("button", { name: /keep mine/i }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(vi.mocked(apiClient.updateResume).mock.calls.at(-1)?.[1].expected_updated_at).toBe(V2);
  });

  it("Use the other one loads it and closes", async () => {
    await conflict();
    vi.mocked(apiClient.getResume).mockResolvedValueOnce(resume(V2, ["Theirs"]));
    render(<ResumeConflictModal />);
    await userEvent.click(screen.getByRole("button", { name: /use the other one/i }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(useResumeStore.getState().content?.skills).toEqual(["Theirs"]);
  });

  it("says so when loading the other one fails, and still asks", async () => {
    await conflict();
    vi.mocked(apiClient.getResume).mockRejectedValueOnce(new Error("Network down"));
    render(<ResumeConflictModal />);
    await userEvent.click(screen.getByRole("button", { name: /use the other one/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/network down/i);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
});

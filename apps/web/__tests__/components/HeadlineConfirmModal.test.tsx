// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Resume } from "@career-copilot/types";

vi.mock("@/lib/api-client", () => ({ apiClient: { updateResume: vi.fn() } }));

import { HeadlineConfirmModal } from "../../components/resume/HeadlineConfirmModal";
import { confirmHeadline, useHeadlineConfirmStore } from "../../stores/headline-confirm-store";
import { apiClient } from "../../lib/api-client";

function resume(headline?: string): Resume {
  return {
    id: "r1",
    updated_at: "2026-10-13T10:00:00Z",
    content: { contact: { name: "Jane", email: "j@x.com" }, headline, experience: [], education: [], skills: [] },
  } as unknown as Resume;
}

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
  useHeadlineConfirmStore.setState({ resume: null, resolve: null, mounted: 0 });
});

describe("confirmHeadline", () => {
  it("resolves straight away when no popup is mounted", async () => {
    const r = resume("Analyst");
    await expect(confirmHeadline(r)).resolves.toBe(r);
  });
});

describe("HeadlineConfirmModal", () => {
  it("shows the headline it read and keeps it on 'Looks right' without saving", async () => {
    render(<HeadlineConfirmModal />);
    const r = resume("Supply Chain Analyst | SAP");
    let result: Promise<Resume>;
    act(() => { result = confirmHeadline(r); });

    expect(screen.getByRole("heading", { name: "Is this your headline?" })).toBeTruthy();
    expect((screen.getByLabelText("Headline") as HTMLInputElement).value).toBe("Supply Chain Analyst | SAP");
    await userEvent.click(screen.getByRole("button", { name: "Looks right" }));

    await expect(result!).resolves.toBe(r);
    expect(apiClient.updateResume).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("saves a corrected headline and hands back the saved résumé", async () => {
    const saved = resume("Senior Supply Chain Analyst");
    vi.mocked(apiClient.updateResume).mockResolvedValue(saved);
    render(<HeadlineConfirmModal />);
    let result: Promise<Resume>;
    act(() => { result = confirmHeadline(resume("Supply Chain")); });

    const input = screen.getByLabelText("Headline");
    await userEvent.clear(input);
    await userEvent.type(input, "Senior Supply Chain Analyst");
    await userEvent.click(screen.getByRole("button", { name: "Save headline" }));

    await expect(result!).resolves.toBe(saved);
    expect(apiClient.updateResume).toHaveBeenCalledWith("r1", {
      content: expect.objectContaining({ headline: "Senior Supply Chain Analyst" }),
      expected_updated_at: "2026-10-13T10:00:00Z",
    });
  });

  it("asks to add one when none was found, and Skip leaves the résumé as read", async () => {
    render(<HeadlineConfirmModal />);
    const r = resume(undefined);
    let result: Promise<Resume>;
    act(() => { result = confirmHeadline(r); });

    expect(screen.getByRole("heading", { name: "Add a headline?" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Looks right" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getAllByRole("button", { name: "Skip" })[0]);

    await expect(result!).resolves.toBe(r);
    expect(apiClient.updateResume).not.toHaveBeenCalled();
  });

  it("keeps the popup open with the reason when the save fails", async () => {
    vi.mocked(apiClient.updateResume).mockRejectedValue(new Error("Network down"));
    render(<HeadlineConfirmModal />);
    act(() => { void confirmHeadline(resume("Analyst")); });

    await userEvent.type(screen.getByLabelText("Headline"), " II");
    await userEvent.click(screen.getByRole("button", { name: "Save headline" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Network down");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

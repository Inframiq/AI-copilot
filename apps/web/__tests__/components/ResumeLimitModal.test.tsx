// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api-client", () => ({
  apiClient: { deleteResume: vi.fn(), generatePdf: vi.fn() },
}));
vi.mock("@/lib/download", () => ({ downloadFile: vi.fn().mockResolvedValue(undefined) }));

import { ResumeLimitModal } from "../../components/resume/ResumeLimitModal";
import {
  useResumeLimitStore,
  withResumeRoom,
  isResumeLimitCancelled,
  type ResumeLimitInfo,
} from "../../stores/resume-limit-store";
import { apiClient } from "../../lib/api-client";
import { downloadFile } from "../../lib/download";

const day = 86_400_000;
const at = (daysAgo: number) => new Date(Date.now() - daysAgo * day).toISOString();

function info(over: Partial<ResumeLimitInfo> = {}): ResumeLimitInfo {
  return {
    code: "resume_limit",
    message: "You can keep up to 5 résumés. Delete one to add another.",
    limit: 5,
    need: 1,
    suggested: ["r1"],
    resumes: [
      { id: "r5", title: "Newest", updated_at: at(0), template_id: "ats_clean", is_master: false, jd_title: null },
      { id: "r4", title: "Main CV", updated_at: at(2), template_id: "ats_clean", is_master: true, jd_title: null },
      { id: "r3", title: "Acme copy", updated_at: at(5), template_id: "ats_modern", is_master: false, jd_title: "Backend @ Acme" },
      { id: "r2", title: "Draft", updated_at: at(9), template_id: "ats_clean", is_master: false, jd_title: null },
      { id: "r1", title: "Oldest", updated_at: at(40), template_id: "ats_clean", is_master: false, jd_title: null },
    ],
    ...over,
  };
}

/** The server's refusal, as the API client throws it. */
const refusal = (i: ResumeLimitInfo) => Object.assign(new Error(i.message), { status: 409, detail: i });

function mount() {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}><ResumeLimitModal /></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useResumeLimitStore.setState({ info: null, resolve: null });
});

describe("withResumeRoom", () => {
  it("passes a create straight through when there's room", async () => {
    const create = vi.fn().mockResolvedValue("made");
    await expect(withResumeRoom(create)).resolves.toBe("made");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("passes other errors through untouched", async () => {
    const boom = Object.assign(new Error("server down"), { status: 500, detail: "server down" });
    await expect(withResumeRoom(() => Promise.reject(boom))).rejects.toBe(boom);
    expect(useResumeLimitStore.getState().info).toBeNull();
  });

  it("asks at the limit, then retries once room is made", async () => {
    const create = vi.fn().mockRejectedValueOnce(refusal(info())).mockResolvedValueOnce("made");
    const result = withResumeRoom(create);
    await waitFor(() => expect(useResumeLimitStore.getState().info).not.toBeNull());
    act(() => useResumeLimitStore.getState().resolve!(true));
    await expect(result).resolves.toBe("made");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("ends with ResumeLimitCancelled when the user cancels", async () => {
    const result = withResumeRoom(() => Promise.reject(refusal(info())));
    await waitFor(() => expect(useResumeLimitStore.getState().info).not.toBeNull());
    act(() => useResumeLimitStore.getState().resolve!(false));
    const err = await result.catch((e) => e);
    expect(isResumeLimitCancelled(err)).toBe(true);
    expect(useResumeLimitStore.getState().info).toBeNull();
  });
});

describe("ResumeLimitModal", () => {
  it("names the résumé that will be deleted, preselected", async () => {
    useResumeLimitStore.setState({ info: info(), resolve: vi.fn() });
    mount();
    expect(screen.getByRole("heading", { name: "“Oldest” will be deleted" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Oldest/ })).toBeChecked();
    expect(screen.getByText(/Export it first to keep a copy, or choose a different résumé to delete/)).toBeInTheDocument();
  });

  it("choosing another changes what will be deleted, and warns about a JD's résumé", async () => {
    useResumeLimitStore.setState({ info: info(), resolve: vi.fn() });
    mount();
    await userEvent.click(screen.getByRole("radio", { name: /Acme copy/ }));
    expect(screen.getByRole("heading", { name: "“Acme copy” will be deleted" })).toBeInTheDocument();
    expect(screen.getByText(/the résumé saved for Backend @ Acme/)).toBeInTheDocument();
  });

  it("Delete & continue deletes the choice, then reports room made", async () => {
    vi.mocked(apiClient.deleteResume).mockResolvedValue(undefined);
    const resolve = vi.fn();
    useResumeLimitStore.setState({ info: info(), resolve });
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Delete & continue" }));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(true));
    expect(apiClient.deleteResume).toHaveBeenCalledWith("r1");
  });

  it("a failed delete says so and keeps the popup open", async () => {
    vi.mocked(apiClient.deleteResume).mockRejectedValue(new Error("Couldn't reach the server"));
    const resolve = vi.fn();
    useResumeLimitStore.setState({ info: info(), resolve });
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Delete & continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach the server");
    expect(resolve).not.toHaveBeenCalled();
  });

  it("over the limit, it needs as many as the server asked for", async () => {
    vi.mocked(apiClient.deleteResume).mockResolvedValue(undefined);
    const resolve = vi.fn();
    useResumeLimitStore.setState({ info: info({ need: 2, suggested: ["r1"] }), resolve });
    mount();
    const del = screen.getByRole("button", { name: "Delete & continue" });
    expect(del).toBeDisabled();
    expect(screen.getByText("Choose 1 more to delete.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /Draft/ }));
    expect(del).toBeEnabled();
    await userEvent.click(del);
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(true));
    expect(apiClient.deleteResume).toHaveBeenCalledTimes(2);
  });

  it("Export renders that résumé's PDF and saves it under its title", async () => {
    vi.mocked(apiClient.generatePdf).mockResolvedValue({ signed_url: "data:application/pdf;base64,JVBERg==" });
    useResumeLimitStore.setState({ info: info(), resolve: vi.fn() });
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Export Acme copy as PDF" }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledWith("data:application/pdf;base64,JVBERg==", "Acme copy.pdf"));
    expect(apiClient.generatePdf).toHaveBeenCalledWith("r3", "ats_modern");
    expect(apiClient.deleteResume).not.toHaveBeenCalled();
  });

  it("Cancel and Escape delete nothing", async () => {
    const resolve = vi.fn();
    useResumeLimitStore.setState({ info: info(), resolve });
    mount();
    await userEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    expect(resolve).toHaveBeenCalledWith(false);
    await userEvent.keyboard("{Escape}");
    expect(resolve).toHaveBeenLastCalledWith(false);
    expect(apiClient.deleteResume).not.toHaveBeenCalled();
  });
});

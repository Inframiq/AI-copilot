import { describe, it, expect, vi, beforeEach } from "vitest";

const getSessionMock = vi.fn();

vi.mock("@/lib/supabase", () => ({
  createBrowserClient: () => ({
    auth: { getSession: getSessionMock },
  }),
}));

import { apiClient, ApiError } from "../lib/api-client";

function jsonResponse(body: unknown, init: Partial<Response> = {}) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    ...init,
  } as Response;
}

describe("apiClient", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "test-token-123" } },
    });
    vi.stubGlobal("fetch", vi.fn());
  });

  it("attaches the auth header and content type on every request", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse([]));
    await apiClient.getResumes();

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/resumes"),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token-123",
          "Content-Type": "application/json",
        }),
      })
    );
  });

  it("sends the JSON-encoded body for write requests", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: "jd-1" }));
    await apiClient.createJd({ title: "Eng", raw_text: "..." });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ title: "Eng", raw_text: "..." });
  });

  it("constructs the correct URL and payload for a PATCH status update", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: "jd-1", status: "offer" }));
    await apiClient.updateJdStatus("jd-1", "offer");

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/jd/jd-1/status");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ status: "offer" });
  });

  it("throws using the server's detail message on a non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ detail: "Resume not found" }, { ok: false, status: 404 })
    );
    await expect(apiClient.getResume("missing-id")).rejects.toThrow("Resume not found");
  });

  it("throws an ApiError carrying the HTTP status, so callers can distinguish 404 from other failures", async () => {
    // Profile page's master-resume lookup relies on this to tell "the linked
    // resume was deleted" (404) apart from a network/server error.
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ detail: "Resume not found" }, { ok: false, status: 404 })
    );
    let caught: unknown;
    try {
      await apiClient.getResume("missing-id");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(404);
  });

  it("falls back to statusText when the error body isn't valid JSON", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);
    await expect(apiClient.getResumes()).rejects.toThrow("Internal Server Error");
  });

  it("returns undefined for a 204 No Content response without parsing a body", async () => {
    const jsonSpy = vi.fn();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 204,
      statusText: "No Content",
      json: jsonSpy,
    } as unknown as Response);

    const result = await apiClient.deleteResume("resume-1");
    expect(result).toBeUndefined();
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it("rejects with Not authenticated when there is no session", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    await expect(apiClient.getResumes()).rejects.toThrow("Not authenticated");
    expect(fetch).not.toHaveBeenCalled();
  });

  describe("parseResumeFile", () => {
    it("uploads via multipart FormData with the auth header, no Content-Type override", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: "resume-1" }));
      const file = new File(["fake"], "resume.pdf", { type: "application/pdf" });

      await apiClient.parseResumeFile(file, "ats_clean");

      const [url, init] = vi.mocked(fetch).mock.calls[0];
      expect(url).toContain("/resumes/parse-upload");
      expect(init?.headers).toEqual({ Authorization: "Bearer test-token-123" });
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect(form.get("file")).toBe(file);
      expect(form.get("template_id")).toBe("ats_clean");
    });

    it("throws the server's detail message on upload failure", async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ detail: "File too large" }, { ok: false, status: 400 })
      );
      const file = new File(["fake"], "resume.pdf", { type: "application/pdf" });
      await expect(apiClient.parseResumeFile(file, "ats_clean")).rejects.toThrow("File too large");
    });
  });

  describe("getOriginalResumeFile", () => {
    it("fetches the signed URL for the untouched uploaded file", async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ signed_url: "https://signed.example/original.pdf", file_name: "resume.pdf" })
      );

      const result = await apiClient.getOriginalResumeFile("resume-1");

      const [url, init] = vi.mocked(fetch).mock.calls[0];
      expect(url).toContain("/resumes/resume-1/original");
      expect(init?.method).toBe("GET");
      expect(result).toEqual({ signed_url: "https://signed.example/original.pdf", file_name: "resume.pdf" });
    });

    it("throws when the resume has no original file", async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ detail: "No original file for this resume" }, { ok: false, status: 404 })
      );
      await expect(apiClient.getOriginalResumeFile("resume-1")).rejects.toThrow(
        "No original file for this resume"
      );
    });
  });

  describe("getQuestionBank", () => {
    it("fetches the shared question bank, optionally filtered by topic", async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse([
          { id: "q-1", skill: "kubernetes", topic: "Technical", question: "...", answer_framework: "..." },
        ])
      );

      const result = await apiClient.getQuestionBank("Technical");

      const [url] = vi.mocked(fetch).mock.calls[0];
      expect(url).toContain("/ai/questions/browse?topic=Technical");
      expect(result).toHaveLength(1);
    });

    it("omits the topic query param when not provided", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse([]));

      await apiClient.getQuestionBank();

      const [url] = vi.mocked(fetch).mock.calls[0];
      expect(url).toContain("/ai/questions/browse");
      expect(url).not.toContain("topic=");
    });
  });

  it("generateCoverLetter POSTs to /cover-letters with the right body", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ cover_letter_id: "cl-1", status: "pending" }));

    const result = await apiClient.generateCoverLetter("resume-1", "jd-1", 60, "session-1");

    expect(result).toEqual({ cover_letter_id: "cl-1", status: "pending" });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/cover-letters");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      resume_id: "resume-1",
      jd_id: "jd-1",
      humanize_level: 60,
      tailoring_session_id: "session-1",
      company_name: undefined,
    });
  });

  it("getJdCoverLetter GETs /jd/{id}/cover-letter", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ cover_letter_id: null, status: null, created_at: null }));

    const result = await apiClient.getJdCoverLetter("jd-1");

    expect(result.cover_letter_id).toBeNull();
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain("/jd/jd-1/cover-letter");
  });

  it("projectScore posts session id + accepted ids and returns the score", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ projected_score: 82 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await apiClient.projectScore("sess-1", ["skill:k8s", "bullet:x"]);

    expect(out).toEqual({ projected_score: 82 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/ai/project-score");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      session_id: "sess-1", accepted_fix_ids: ["skill:k8s", "bullet:x"],
    });
  });
});

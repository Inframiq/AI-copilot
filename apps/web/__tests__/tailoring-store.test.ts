import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ResumeContent, JobDescription } from "@career-copilot/types";

// ── Mock apiClient ────────────────────────────────────────────────────────
// NOTE: vi.mock is hoisted, so the factory must NOT reference outer variables.
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    tailorResume: vi.fn(),
    getSession: vi.fn(),
    updateResume: vi.fn().mockResolvedValue({}),
    createResume: vi.fn(),
    generatePdf: vi.fn().mockResolvedValue({ signed_url: "https://example.com/tailored.pdf" }),
    createJd: vi.fn(),
    analyzeJd: vi.fn(),
    projectScore: vi.fn(),
  },
}));

const K8S_FIX = {
  id: "skill:k8s", type: "skill" as const, gap: "Kubernetes", importance: "high" as const,
  grounded: true, text: "Kubernetes", experience_index: null,
  score_delta: 10, default_accept: false,
};

const mockCompletedSession = {
  session_id: "session-xyz",
  resume_id: "resume-abc",
  jd_id: "jd-001",
  status: "completed" as const,
  ats_score: 82,
  matched_skills: ["TypeScript", "React"],
  missing_skills: ["GraphQL"],
  tailored_content: {
    contact: { name: "Jane Doe", email: "jane@example.com" },
    experience: [],
    education: [],
    skills: ["TypeScript", "React"],
  },
  company_keywords: [],
  suggested_skills: [],
};

import { useTailoringStore, MAX_MERGED_SKILLS, deriveBulletChanges } from "../stores/tailoring-store";
import { useResumeStore } from "../stores/resume-store";
import { apiClient } from "../lib/api-client";

const SAMPLE_CONTENT: ResumeContent = {
  contact: { name: "Jane Doe", email: "jane@example.com" },
  experience: [],
  education: [],
  skills: [],
};

describe("useTailoringStore", () => {
  beforeEach(() => {
    useTailoringStore.getState().resetStore();
    useResumeStore.getState().resetStore();
    vi.clearAllMocks();
    // Default: tailorResume kicks off a session, getSession reports it done
    // on the very first poll — most tests don't care about the pending phase.
    vi.mocked(apiClient.tailorResume).mockResolvedValue({
      session_id: "session-xyz",
      status: "pending",
    });
    vi.mocked(apiClient.getSession).mockResolvedValue(mockCompletedSession);
    vi.mocked(apiClient.updateResume).mockResolvedValue({} as any);
    vi.mocked(apiClient.generatePdf).mockResolvedValue({
      signed_url: "https://example.com/tailored.pdf",
    });
    vi.mocked(apiClient.createJd).mockResolvedValue({
      id: "jd-created-001",
      user_id: "user-1",
      title: "Senior TypeScript Engineer",
      raw_text: "Senior TypeScript Engineer\nWe need 5+ years of React.",
      parsed_skills: [],
      status: "applied",
      created_at: new Date().toISOString(),
      ats_score: null,
    } satisfies JobDescription);
  });

  it("initial state has correct defaults", () => {
    const state = useTailoringStore.getState();
    expect(state.jdId).toBeNull();
    expect(state.jdText).toBe("");
    expect(state.sessionId).toBeNull();
    expect(state.atsScore).toBeNull();
    expect(state.matchedSkills).toEqual([]);
    expect(state.missingSkills).toEqual([]);
    expect(state.humanizeLevel).toBe(50);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("setJd updates jdId and jdText", () => {
    useTailoringStore.getState().setJd("jd-001", "We need TypeScript engineers");
    const state = useTailoringStore.getState();
    expect(state.jdId).toBe("jd-001");
    expect(state.jdText).toBe("We need TypeScript engineers");
  });

  it("setHumanizeLevel updates humanizeLevel", () => {
    useTailoringStore.getState().setHumanizeLevel(75);
    expect(useTailoringStore.getState().humanizeLevel).toBe(75);
  });

  it("setJd resets companyName — a previous JD's target company must not silently apply to the next one", () => {
    useTailoringStore.getState().setJd("jd-1", "First JD text");
    useTailoringStore.getState().setCompanyName("Acme Corp");
    expect(useTailoringStore.getState().companyName).toBe("Acme Corp");

    useTailoringStore.getState().setJd("jd-2", "Second, unrelated JD text");

    expect(useTailoringStore.getState().companyName).toBe("");
  });

  describe("runAnalysis", () => {
    it("populates atsScore/matchedSkills/missingSkills from the API result", async () => {
      useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
      useTailoringStore.getState().setJd("jd-1", "raw text");
      vi.mocked(apiClient.analyzeJd).mockResolvedValueOnce({
        ats_score: 88,
        matched_skills: ["Python"],
        missing_skills: ["AWS"],
        company_keywords: ["fast-paced"],
      });

      await useTailoringStore.getState().runAnalysis("resume-abc");

      const state = useTailoringStore.getState();
      expect(state.atsScore).toBe(88);
      expect(state.matchedSkills).toEqual(["Python"]);
      expect(state.missingSkills).toEqual(["AWS"]);
      expect(state.companyKeywords).toEqual(["fast-paced"]);
      expect(state.isAnalyzing).toBe(false);
    });

    // Regression class: the same bug shape already found twice in this
    // store (setJd not resetting a field, a page re-syncing and wiping
    // results it shouldn't) — here the gap is a missing staleness guard.
    // runTailoring already re-checks `get().isLoading` before applying a
    // late-arriving result (see the "aborts polling updates" test below);
    // runAnalysis has no equivalent check, so a response for a JD the user
    // has since navigated away from can silently attach itself to whatever
    // they're now looking at. Realistic trigger: JD Analyzer's textarea
    // calls setJd() on every keystroke once the pasted text diverges from
    // what's stored — so editing the JD while a prior analysis for it is
    // still in flight (a plausible thing for an impatient user to do)
    // fires this exact race.
    it("discards an in-flight analysis result if the JD changes before it resolves", async () => {
      useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
      useTailoringStore.getState().setJd("jd-1", "First JD text");

      let resolveAnalyze: (val: unknown) => void = () => {};
      const pending = new Promise((res) => {
        resolveAnalyze = res;
      });
      vi.mocked(apiClient.analyzeJd).mockReturnValueOnce(pending as any);

      const analysisPromise = useTailoringStore.getState().runAnalysis("resume-abc");

      // User starts editing a different JD before the first analysis returns.
      useTailoringStore.getState().setJd("", "Second, unrelated JD text");

      resolveAnalyze({
        ats_score: 91,
        matched_skills: ["Stale"],
        missing_skills: [],
        company_keywords: [],
      });
      await analysisPromise;

      const state = useTailoringStore.getState();
      expect(state.atsScore).toBeNull();
      expect(state.matchedSkills).toEqual([]);
      expect(state.jdText).toBe("Second, unrelated JD text");
    });

    it("does not discard results when the JD is unchanged when the request resolves", async () => {
      useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
      useTailoringStore.getState().setJd("jd-1", "First JD text");
      vi.mocked(apiClient.analyzeJd).mockResolvedValueOnce({
        ats_score: 91,
        matched_skills: ["Python"],
        missing_skills: [],
        company_keywords: [],
      });

      await useTailoringStore.getState().runAnalysis("resume-abc");

      expect(useTailoringStore.getState().atsScore).toBe(91);
    });

    it("stores jdImportance from the analyze response", async () => {
      useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
      useTailoringStore.getState().setJd("jd-1", "jd text");
      vi.mocked(apiClient.analyzeJd).mockResolvedValueOnce({
        ats_score: 80,
        matched_skills: ["Python"],
        missing_skills: ["AWS"],
        company_keywords: [],
        importance: { python: "high", aws: "low" },
      });

      await useTailoringStore.getState().runAnalysis("resume-abc");

      expect(useTailoringStore.getState().jdImportance).toEqual({ python: "high", aws: "low" });
    });

    it("defaults jdImportance to {} when the analyze response omits importance", async () => {
      useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
      useTailoringStore.getState().setJd("jd-1", "jd text");
      vi.mocked(apiClient.analyzeJd).mockResolvedValueOnce({
        ats_score: 80,
        matched_skills: ["Python"],
        missing_skills: [],
        company_keywords: [],
      });

      await useTailoringStore.getState().runAnalysis("resume-abc");

      expect(useTailoringStore.getState().jdImportance).toEqual({});
    });
  });

  it("setAnalysisResults hydrates jdImportance from its argument", () => {
    useTailoringStore.getState().setAnalysisResults({
      atsScore: 70,
      matchedSkills: ["Python"],
      missingSkills: ["AWS"],
      companyKeywords: [],
      jdImportance: { python: "high", aws: "medium" },
    });

    expect(useTailoringStore.getState().jdImportance).toEqual({ python: "high", aws: "medium" });
  });

  it("setJd to a genuinely different JD resets jdImportance", () => {
    useTailoringStore.setState({ jdImportance: { python: "high" } });
    useTailoringStore.getState().setJd("jd-2", "A different JD entirely");
    expect(useTailoringStore.getState().jdImportance).toEqual({});
  });

  it("resetStore clears jdImportance", () => {
    useTailoringStore.setState({ jdImportance: { python: "high" } });
    useTailoringStore.getState().resetStore();
    expect(useTailoringStore.getState().jdImportance).toEqual({});
  });

  it("runTailoring succeeds and hydrates session state", async () => {
    // Set up resume store
    useResumeStore
      .getState()
      .setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "We need TypeScript engineers");

    await useTailoringStore.getState().runTailoring("resume-abc");

    expect(apiClient.tailorResume).toHaveBeenCalledWith(
      "resume-abc",
      "jd-001",
      50,
      undefined,
      false,
    );

    const state = useTailoringStore.getState();
    expect(state.sessionId).toBe("session-xyz");
    expect(state.atsScore).toBe(82);
    expect(state.matchedSkills).toEqual(["TypeScript", "React"]);
    expect(state.missingSkills).toEqual(["GraphQL"]);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("runTailoring without jdId or jdText sets error and does not call API", async () => {
    await useTailoringStore.getState().runTailoring("resume-abc");
    expect(apiClient.tailorResume).not.toHaveBeenCalled();
    expect(apiClient.createJd).not.toHaveBeenCalled();
    expect(useTailoringStore.getState().error).toBe(
      "No job description selected"
    );
  });

  it("runTailoring creates a JD from pasted text when only jdText is set (the editor's JD Context box never has a jdId)", async () => {
    useResumeStore
      .getState()
      .setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    // This is what EditorPanel's JD Context textarea does: setJd("", text).
    useTailoringStore.getState().setJd("", "Senior TypeScript Engineer\nWe need 5+ years of React.");

    await useTailoringStore.getState().runTailoring("resume-abc");

    expect(apiClient.createJd).toHaveBeenCalledWith({
      title: "Senior TypeScript Engineer",
      raw_text: "Senior TypeScript Engineer\nWe need 5+ years of React.",
    });
    expect(apiClient.tailorResume).toHaveBeenCalledWith(
      "resume-abc",
      "jd-created-001",
      50,
      undefined,
      false,
    );
    const state = useTailoringStore.getState();
    expect(state.jdId).toBe("jd-created-001");
    expect(state.error).toBeNull();
    expect(state.sessionId).toBe("session-xyz");
  });

  it("runTailoring surfaces an error if creating the JD fails", async () => {
    useResumeStore
      .getState()
      .setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("", "Some JD text");
    vi.mocked(apiClient.createJd).mockRejectedValueOnce(new Error("Save failed"));

    await useTailoringStore.getState().runTailoring("resume-abc");

    expect(apiClient.tailorResume).not.toHaveBeenCalled();
    expect(useTailoringStore.getState().error).toBe("Save failed");
    expect(useTailoringStore.getState().isLoading).toBe(false);
  });

  it("runTailoring populates pendingContent for review, without touching the resume store or backend", async () => {
    useResumeStore
      .getState()
      .setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");

    await useTailoringStore.getState().runTailoring("resume-abc");

    // Tailored content is staged for review, not written into the resume store.
    expect(useTailoringStore.getState().pendingContent?.skills).toEqual([
      "TypeScript",
      "React",
    ]);
    expect(useResumeStore.getState().content).toEqual(SAMPLE_CONTENT);
    expect(apiClient.updateResume).not.toHaveBeenCalled();
    expect(apiClient.generatePdf).not.toHaveBeenCalled();
  });

  it("generatePreview merges accepted bullets and renders a preview without persisting", async () => {
    const original: ResumeContent = {
      ...SAMPLE_CONTENT,
      experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff"] }],
    };
    useResumeStore.getState().setResume("resume-abc", original, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.getSession).mockResolvedValueOnce({
      ...mockCompletedSession,
      tailored_content: {
        ...mockCompletedSession.tailored_content,
        experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff, tailored"] }],
      },
    });
    await useTailoringStore.getState().runTailoring("resume-abc");

    await useTailoringStore.getState().generatePreview("resume-abc");

    expect(apiClient.generatePdf).toHaveBeenCalledWith(
      "resume-abc",
      "ats_clean",
      expect.objectContaining({
        experience: [expect.objectContaining({ bullets: ["Did stuff, tailored"] })],
      }),
      1.25,
      12,
      "sans",
      null
    );
    // Nothing persisted, and the original resume is untouched.
    expect(apiClient.updateResume).not.toHaveBeenCalled();
    expect(useResumeStore.getState().content).toEqual(original);
    expect(useTailoringStore.getState().previewPdfUrl).toBe(
      "https://example.com/tailored.pdf"
    );
    // The Studio page's dedicated PDF Preview panel reads pdfSignedUrl off
    // the resume store, not previewPdfUrl off the tailoring store — without
    // this, "Preview Tailored Resume" would only ever render inline under
    // the bullet list, never in the panel it's supposed to occupy.
    expect(useResumeStore.getState().pdfSignedUrl).toBe(
      "https://example.com/tailored.pdf"
    );
  });

  it("generatePreview uses the current spacing settings, not always the defaults", async () => {
    // Previously omitted entirely, so adjusting the spacing sliders while
    // reviewing a tailored resume had no effect on the rendered preview.
    const original: ResumeContent = {
      ...SAMPLE_CONTENT,
      experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff"] }],
    };
    useResumeStore.getState().setResume("resume-abc", original, "ats_clean", 1.5, 20);
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.getSession).mockResolvedValueOnce(mockCompletedSession);
    await useTailoringStore.getState().runTailoring("resume-abc");

    await useTailoringStore.getState().generatePreview("resume-abc");

    expect(apiClient.generatePdf).toHaveBeenCalledWith(
      "resume-abc",
      "ats_clean",
      expect.any(Object),
      1.5,
      20,
      "sans",
      null
    );
  });

  it("generatePreview caps merged skills at MAX_MERGED_SKILLS instead of piling up an unbounded list", async () => {
    const manyOriginalSkills = Array.from({ length: MAX_MERGED_SKILLS - 2 }, (_, i) => `Original Skill ${i}`);
    const original: ResumeContent = {
      ...SAMPLE_CONTENT,
      skills: manyOriginalSkills,
      experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff"] }],
    };
    useResumeStore.getState().setResume("resume-abc", original, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.getSession).mockResolvedValueOnce({
      ...mockCompletedSession,
      suggested_skills: ["Kubernetes", "Docker", "Terraform", "GraphQL", "gRPC"],
      tailored_content: {
        ...mockCompletedSession.tailored_content,
        experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff, tailored"] }],
      },
    });
    await useTailoringStore.getState().runTailoring("resume-abc");

    // Accept every suggested skill — more than the 2 remaining slots allow.
    for (const skill of ["Kubernetes", "Docker", "Terraform", "GraphQL", "gRPC"]) {
      useTailoringStore.getState().setBulletDecision(`skill_add:${skill}`, "accept");
    }

    await useTailoringStore.getState().generatePreview("resume-abc");

    const mergedContent = vi.mocked(apiClient.generatePdf).mock.calls.at(-1)?.[2];
    expect(mergedContent?.skills.length).toBe(MAX_MERGED_SKILLS);
    // Original skills are never displaced by additions — only the overflow
    // of newly-added ones gets trimmed.
    expect(mergedContent?.skills.slice(0, manyOriginalSkills.length)).toEqual(manyOriginalSkills);
  });

  it("generatePreview keeps every existing skill by default when the resume is under the cap", async () => {
    const fewOriginalSkills = ["React", "TypeScript", "Node.js"];
    const original: ResumeContent = {
      ...SAMPLE_CONTENT,
      skills: fewOriginalSkills,
      experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff"] }],
    };
    useResumeStore.getState().setResume("resume-abc", original, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.getSession).mockResolvedValueOnce({
      ...mockCompletedSession,
      suggested_skills: [],
      tailored_content: {
        ...mockCompletedSession.tailored_content,
        experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff, tailored"] }],
      },
    });
    await useTailoringStore.getState().runTailoring("resume-abc");

    // No skill_keep decisions made — under the cap, nothing forces a
    // choice, so every existing skill stays in by default as before.
    await useTailoringStore.getState().generatePreview("resume-abc");

    const mergedContent = vi.mocked(apiClient.generatePdf).mock.calls.at(-1)?.[2];
    expect(mergedContent?.skills).toEqual(fewOriginalSkills);
  });

  it("generatePreview keeps none of a resume's existing skills by default once they already exceed MAX_MERGED_SKILLS, until the user explicitly picks some", async () => {
    // A resume parsed/uploaded with more skills than the cap (e.g. 34) must
    // never have any of them auto-selected — that's an auto-populate in
    // disguise (the first N would get picked FOR the user via the merge's
    // trailing slice). The user has to explicitly keep the ones they want.
    const manyOriginalSkills = Array.from({ length: MAX_MERGED_SKILLS + 14 }, (_, i) => `Original Skill ${i}`);
    const original: ResumeContent = {
      ...SAMPLE_CONTENT,
      skills: manyOriginalSkills,
      experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff"] }],
    };
    useResumeStore.getState().setResume("resume-abc", original, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.getSession).mockResolvedValueOnce({
      ...mockCompletedSession,
      suggested_skills: ["Kubernetes"],
      tailored_content: {
        ...mockCompletedSession.tailored_content,
        experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff, tailored"] }],
      },
    });
    await useTailoringStore.getState().runTailoring("resume-abc");
    useTailoringStore.getState().setBulletDecision("skill_add:Kubernetes", "accept");

    // No skill_keep decisions made — none of the 34 should be pre-selected.
    await useTailoringStore.getState().generatePreview("resume-abc");

    let mergedContent = vi.mocked(apiClient.generatePdf).mock.calls.at(-1)?.[2];
    expect(mergedContent?.skills).toEqual(["Kubernetes"]);

    // Explicitly keeping a couple of the original skills adds exactly
    // those, and only those.
    useTailoringStore.getState().setBulletDecision("skill_keep:Original Skill 0", "accept");
    useTailoringStore.getState().setBulletDecision("skill_keep:Original Skill 5", "accept");
    await useTailoringStore.getState().generatePreview("resume-abc");

    mergedContent = vi.mocked(apiClient.generatePdf).mock.calls.at(-1)?.[2];
    expect(mergedContent?.skills).toEqual(["Original Skill 0", "Original Skill 5", "Kubernetes"]);
  });

  it("generatePreview leaves the summary untouched by default, since the tailoring pass never rewrites it", async () => {
    const original: ResumeContent = {
      ...SAMPLE_CONTENT,
      summary: "Original summary text.",
      experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff"] }],
    };
    useResumeStore.getState().setResume("resume-abc", original, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.getSession).mockResolvedValueOnce({
      ...mockCompletedSession,
      tailored_content: {
        ...mockCompletedSession.tailored_content,
        summary: "Original summary text.",
        experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff, tailored"] }],
      },
    });
    await useTailoringStore.getState().runTailoring("resume-abc");

    await useTailoringStore.getState().generatePreview("resume-abc");

    const mergedContent = vi.mocked(apiClient.generatePdf).mock.calls.at(-1)?.[2];
    expect(mergedContent?.summary).toBe("Original summary text.");
  });

  it("generatePreview uses the AI-rewritten summary once updatePendingSummary sets one, and reverts to the original when rejected", async () => {
    const original: ResumeContent = {
      ...SAMPLE_CONTENT,
      summary: "Original summary text.",
      experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff"] }],
    };
    useResumeStore.getState().setResume("resume-abc", original, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.getSession).mockResolvedValueOnce({
      ...mockCompletedSession,
      tailored_content: {
        ...mockCompletedSession.tailored_content,
        summary: "Original summary text.",
        experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff, tailored"] }],
      },
    });
    await useTailoringStore.getState().runTailoring("resume-abc");

    useTailoringStore.getState().updatePendingSummary("Rewritten summary text.");
    useTailoringStore.getState().setBulletDecision("summary", "accept");
    await useTailoringStore.getState().generatePreview("resume-abc");
    let mergedContent = vi.mocked(apiClient.generatePdf).mock.calls.at(-1)?.[2];
    expect(mergedContent?.summary).toBe("Rewritten summary text.");

    useTailoringStore.getState().setBulletDecision("summary", "reject");
    await useTailoringStore.getState().generatePreview("resume-abc");
    mergedContent = vi.mocked(apiClient.generatePdf).mock.calls.at(-1)?.[2];
    expect(mergedContent?.summary).toBe("Original summary text.");
  });

  it("reanalyzePreview re-scores the current merged bullets against the JD without persisting", async () => {
    const original: ResumeContent = {
      ...SAMPLE_CONTENT,
      experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff"] }],
    };
    useResumeStore.getState().setResume("resume-abc", original, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.getSession).mockResolvedValueOnce({
      ...mockCompletedSession,
      ats_score: 60,
      tailored_content: {
        ...mockCompletedSession.tailored_content,
        experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Humanized, fewer keywords"] }],
      },
    });
    await useTailoringStore.getState().runTailoring("resume-abc");
    expect(useTailoringStore.getState().atsScore).toBe(60);

    vi.mocked(apiClient.analyzeJd).mockResolvedValueOnce({
      ats_score: 45,
      matched_skills: ["React"],
      missing_skills: ["TypeScript", "GraphQL"],
      company_keywords: [],
    });

    await useTailoringStore.getState().reanalyzePreview("resume-abc");

    // Scored the current unsaved bullet state, not what's saved on the resume.
    expect(apiClient.analyzeJd).toHaveBeenCalledWith(
      "resume-abc",
      "jd-001",
      "",
      expect.objectContaining({
        experience: [expect.objectContaining({ bullets: ["Humanized, fewer keywords"] })],
      })
    );
    expect(useTailoringStore.getState().atsScore).toBe(45);
    expect(useTailoringStore.getState().matchedSkills).toEqual(["React"]);
    expect(useTailoringStore.getState().missingSkills).toEqual(["TypeScript", "GraphQL"]);
    // Nothing persisted.
    expect(apiClient.updateResume).not.toHaveBeenCalled();
    expect(useResumeStore.getState().content).toEqual(original);
  });

  it("saveTailoredResume('update') persists the merged content to the same resume", async () => {
    useResumeStore
      .getState()
      .setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    await useTailoringStore.getState().runTailoring("resume-abc");
    await useTailoringStore.getState().generatePreview("resume-abc");

    const targetId = await useTailoringStore.getState().saveTailoredResume("resume-abc", "update");

    expect(targetId).toBe("resume-abc");
    expect(apiClient.updateResume).toHaveBeenCalledWith(
      "resume-abc",
      expect.objectContaining({ content: expect.any(Object) })
    );
    // Skills are opt-in via the suggested-skills chips, not a blind copy of
    // the AI's full tailored skill list — none were accepted here, so the
    // original (empty) skill list carries through unchanged.
    expect(useResumeStore.getState().content?.skills).toEqual([]);
    expect(useTailoringStore.getState().previewPdfUrl).toBeNull();
    expect(useTailoringStore.getState().pendingContent).toBeNull();
  });

  it("saveTailoredResume('new') creates a separate resume and leaves the original untouched", async () => {
    useResumeStore
      .getState()
      .setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.createResume).mockResolvedValueOnce({
      id: "resume-new",
      user_id: "user-1",
      title: "Tailored Resume",
      content: SAMPLE_CONTENT,
      template_id: "ats_clean",
      line_spacing: 1.25,
      paragraph_spacing: 12,
      font_choice: "sans",
      accent_color: null, heading_size_delta: 0, body_size_delta: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await useTailoringStore.getState().runTailoring("resume-abc");
    await useTailoringStore.getState().generatePreview("resume-abc");

    const targetId = await useTailoringStore.getState().saveTailoredResume(
      "resume-abc",
      "new",
      "Resume — Acme"
    );

    expect(targetId).toBe("resume-new");
    expect(apiClient.createResume).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Resume — Acme", content: expect.any(Object) })
    );
    expect(apiClient.updateResume).not.toHaveBeenCalled();
    // The original resume record on the backend is untouched (a separate
    // row was created above) — but the store now points at the newly saved
    // resume and its freshly generated PDF, since the caller is about to
    // navigate to /studio/{targetId} and that page should show the tailored
    // PDF immediately instead of a blank preview.
    expect(useResumeStore.getState().resumeId).toBe("resume-new");
    expect(useResumeStore.getState().pdfSignedUrl).toBe("https://example.com/tailored.pdf");
  });

  it("saveTailoredResume('new') links the save to the current JD", async () => {
    useResumeStore
      .getState()
      .setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.createResume).mockResolvedValueOnce({
      id: "resume-new",
      user_id: "user-1",
      title: "Tailored Resume",
      content: SAMPLE_CONTENT,
      template_id: "ats_clean",
      line_spacing: 1.25,
      paragraph_spacing: 12,
      font_choice: "sans",
      accent_color: null, heading_size_delta: 0, body_size_delta: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await useTailoringStore.getState().runTailoring("resume-abc");
    await useTailoringStore.getState().generatePreview("resume-abc");

    await useTailoringStore.getState().saveTailoredResume("resume-abc", "new");

    expect(apiClient.createResume).toHaveBeenCalledWith(
      expect.objectContaining({ jd_id: "jd-001" })
    );
  });

  it("runTailoring handles API errors gracefully", async () => {
    vi.mocked(apiClient.tailorResume).mockRejectedValueOnce(
      new Error("Server error")
    );

    useTailoringStore.getState().setJd("jd-001", "raw text");

    await useTailoringStore.getState().runTailoring("resume-abc");

    const state = useTailoringStore.getState();
    expect(state.error).toBe("Server error");
    expect(state.isLoading).toBe(false);
    expect(state.sessionId).toBeNull();
  });

  it("resetStore clears all fields", () => {
    useTailoringStore.getState().setJd("jd-001", "text");
    useTailoringStore.getState().setHumanizeLevel(80);
    useTailoringStore.getState().resetStore();

    const state = useTailoringStore.getState();
    expect(state.jdId).toBeNull();
    expect(state.humanizeLevel).toBe(50);
  });

  it("runTailoring auto-accepts every suggested skill — the AI's plausible-from-your-résumé set", async () => {
    useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.getSession).mockResolvedValueOnce({
      ...mockCompletedSession,
      suggested_skills: ["Kubernetes", "Docker"],
    });

    await useTailoringStore.getState().runTailoring("resume-abc");

    const decisions = useTailoringStore.getState().bulletDecisions;
    expect(decisions["skill_add:Kubernetes"]).toBe("accept");
    // suggested_skills is Agent 2's plausible-from-the-résumé set; starting it
    // off left the "after" score measuring rewording alone.
    expect(decisions["skill_add:Docker"]).toBe("accept");
  });

  it("runTailoring asks for a fresh run only when told to", async () => {
    useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");

    await useTailoringStore.getState().runTailoring("resume-abc");
    expect(vi.mocked(apiClient.tailorResume).mock.calls[0][4]).toBe(false);

    await useTailoringStore.getState().runTailoring("resume-abc", { fresh: true });
    expect(vi.mocked(apiClient.tailorResume).mock.calls[1][4]).toBe(true);
  });

  it("runTailoring remembers when the server handed back an identical earlier run", async () => {
    useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.tailorResume).mockResolvedValueOnce({
      session_id: "session-xyz", status: "completed", reused: true,
    });
    await useTailoringStore.getState().runTailoring("resume-abc");
    expect(useTailoringStore.getState().reusedRun).toBe(true);

    await useTailoringStore.getState().runTailoring("resume-abc", { fresh: true });
    expect(useTailoringStore.getState().reusedRun).toBe(false);
  });

  it("runTailoring starts a rewrite that adds an unevidenced JD term unticked", async () => {
    const original = {
      ...SAMPLE_CONTENT,
      experience: [{ title: "Eng", company: "Acme", bullets: ["Managed deploys.", "Wrote Python."] }],
    } as ResumeContent;
    useResumeStore.getState().setResume("resume-abc", original, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.getSession).mockResolvedValueOnce({
      ...mockCompletedSession,
      tailored_content: {
        ...original,
        experience: [{ title: "Eng", company: "Acme", start: "2020",
          bullets: ["Managed Kubernetes deploys.", "Wrote Python services."] }],
      },
      bullet_rationale: {
        exp0_b0: { responsibility: "", keywords: ["Kubernetes"] },
        exp0_b1: { responsibility: "", keywords: ["Python"] },
      },
    });

    await useTailoringStore.getState().runTailoring("resume-abc");

    const d = useTailoringStore.getState().bulletDecisions;
    expect(d.exp0_b0).toBe("reject"); // adds Kubernetes, never in the résumé
    expect(d.exp0_b1).toBe("accept"); // Python was already there
  });

  it("re-scores with the list of rewrites being kept, so each tick moves the number", async () => {
    vi.useFakeTimers();
    try {
      const original = {
        ...SAMPLE_CONTENT,
        experience: [{ title: "Eng", company: "Acme", start: "2020", bullets: ["A.", "B."] }],
      } as ResumeContent;
      useResumeStore.getState().setResume("resume-abc", original, "ats_clean");
      useTailoringStore.setState({
        sessionId: "s1",
        pendingContent: {
          ...original,
          experience: [{ title: "Eng", company: "Acme", start: "2020", bullets: ["A2.", "B2."] }],
        },
        bulletDecisions: { exp0_b0: "accept", exp0_b1: "accept" },
      } as never);

      useTailoringStore.getState().setBulletDecision("exp0_b1", "reject");
      await vi.runAllTimersAsync();

      const call = vi.mocked(apiClient.projectScore).mock.calls.at(-1)!;
      expect(call[3]).toEqual(["exp0_b0"]);
    } finally {
      vi.useRealTimers();
    }
  });

  // Regression: a skill that was both an AI suggestion and a JD-gap fix was
  // seeded twice (skill_add:X and fix:skill:x). The chip controls only the
  // fix, so deselecting it left skill_add accepted and the skill was added
  // anyway — the chip looked unresponsive.
  it("lets the fix decision alone decide a skill that is also a suggestion", () => {
    useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.setState({
      pendingContent: SAMPLE_CONTENT,
      suggestedSkills: ["Docker"],
      atsFixes: [{
        id: "skill:docker", type: "skill", gap: "Docker", importance: "high", grounded: true,
        text: "Docker", experience_index: null, score_delta: 3, default_accept: true,
      }],
      bulletDecisions: { "skill_add:Docker": "accept", "fix:skill:docker": "reject" },
    } as never);

    useTailoringStore.getState().commitReview();

    expect(useResumeStore.getState().content?.skills).not.toContain("Docker");
  });

  it("flags the projected score as updating until the re-score lands", async () => {
    vi.useFakeTimers();
    try {
      useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
      useTailoringStore.setState({ sessionId: "s1", pendingContent: SAMPLE_CONTENT } as never);
      vi.mocked(apiClient.projectScore).mockResolvedValueOnce({ projected_score: 70 });

      useTailoringStore.getState().refreshProjectedScore();
      expect(useTailoringStore.getState().isProjecting).toBe(true);
      await vi.runAllTimersAsync();
      expect(useTailoringStore.getState().isProjecting).toBe(false);
      expect(useTailoringStore.getState().projectedAtsScore).toBe(70);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never lets an older re-score overwrite a newer one", async () => {
    vi.useFakeTimers();
    try {
      useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
      useTailoringStore.setState({ sessionId: "s1", pendingContent: SAMPLE_CONTENT } as never);
      let first!: (v: { projected_score: number }) => void;
      let second!: (v: { projected_score: number }) => void;
      vi.mocked(apiClient.projectScore)
        .mockReturnValueOnce(new Promise((r) => { first = r; }))
        .mockReturnValueOnce(new Promise((r) => { second = r; }));

      useTailoringStore.getState().refreshProjectedScore();
      await vi.advanceTimersByTimeAsync(500);   // request 1 in flight
      useTailoringStore.getState().refreshProjectedScore();
      await vi.advanceTimersByTimeAsync(500);   // request 2 in flight

      second({ projected_score: 81 });
      await vi.runAllTimersAsync();
      first({ projected_score: 52 });           // the stale one lands last
      await vi.runAllTimersAsync();

      expect(useTailoringStore.getState().projectedAtsScore).toBe(81);
      expect(useTailoringStore.getState().isProjecting).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("runTailoring re-scores with the default selections applied", async () => {
    vi.useFakeTimers();
    try {
      useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
      useTailoringStore.getState().setJd("jd-001", "raw text");
      vi.mocked(apiClient.getSession).mockResolvedValueOnce({
        ...mockCompletedSession,
        suggested_skills: ["Docker"],
      });
      vi.mocked(apiClient.projectScore).mockResolvedValueOnce({ projected_score: 83 } as never);

      await useTailoringStore.getState().runTailoring("resume-abc");
      await vi.runAllTimersAsync();

      expect(apiClient.projectScore).toHaveBeenCalled();
      expect(useTailoringStore.getState().projectedAtsScore).toBe(83);
    } finally {
      vi.useRealTimers();
    }
  });

  it("runTailoring polls until the session status is completed", async () => {
    vi.useFakeTimers();
    try {
      useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
      useTailoringStore.getState().setJd("jd-001", "raw text");
      vi.mocked(apiClient.getSession)
        .mockResolvedValueOnce({ ...mockCompletedSession, status: "pending", tailored_content: null })
        .mockResolvedValueOnce(mockCompletedSession);

      const promise = useTailoringStore.getState().runTailoring("resume-abc");
      await vi.advanceTimersByTimeAsync(3000);
      await promise;

      expect(apiClient.getSession).toHaveBeenCalledTimes(2);
      const state = useTailoringStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.atsScore).toBe(82);
      expect(state.sessionId).toBe("session-xyz");
    } finally {
      vi.useRealTimers();
    }
  });

  it("runTailoring tolerates a couple of transient poll failures and still completes", async () => {
    // A dropped connection or a 502 from the hosting proxy on one or two
    // polls shouldn't abort a run that's still succeeding server-side.
    vi.useFakeTimers();
    try {
      useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
      useTailoringStore.getState().setJd("jd-001", "raw text");
      vi.mocked(apiClient.getSession)
        .mockRejectedValueOnce(new Error("Network error"))
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce(mockCompletedSession);

      const promise = useTailoringStore.getState().runTailoring("resume-abc");
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(3000);
      await promise;

      expect(apiClient.getSession).toHaveBeenCalledTimes(3);
      const state = useTailoringStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.atsScore).toBe(82);
      expect(state.sessionId).toBe("session-xyz");
    } finally {
      vi.useRealTimers();
    }
  });

  it("runTailoring surfaces a generic error when the session status is failed", async () => {
    useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.getSession).mockResolvedValueOnce({
      ...mockCompletedSession,
      status: "failed",
      tailored_content: null,
    });

    await useTailoringStore.getState().runTailoring("resume-abc");

    const state = useTailoringStore.getState();
    expect(state.error).toBe("Tailoring failed — please try again.");
    expect(state.isLoading).toBe(false);
    expect(state.pendingContent).toBeNull();
  });

  it("updatePendingBullet updates the specified bullet text in pendingContent", () => {
    const initialContent: ResumeContent = {
      ...SAMPLE_CONTENT,
      experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Bullet 1", "Bullet 2"] }],
    };
    useTailoringStore.setState({ pendingContent: initialContent });

    useTailoringStore.getState().updatePendingBullet("exp0_b1", "Bullet 2 updated");

    const updated = useTailoringStore.getState().pendingContent;
    expect(updated?.experience[0].bullets[1]).toBe("Bullet 2 updated");
    expect(updated?.experience[0].bullets[0]).toBe("Bullet 1");
  });

  it("setAllBulletDecisions sets decisions for multiple bullet changes at once", () => {
    const changes = [
      { key: "exp0_b0", jobIdx: 0, bulletIdx: 0, jobTitle: "Eng", company: "Co", original: "a", tailored: "b" },
      { key: "exp0_b1", jobIdx: 0, bulletIdx: 1, jobTitle: "Eng", company: "Co", original: "c", tailored: "d" },
    ];

    useTailoringStore.getState().setAllBulletDecisions(changes, "reject");

    const decisions = useTailoringStore.getState().bulletDecisions;
    expect(decisions["exp0_b0"]).toBe("reject");
    expect(decisions["exp0_b1"]).toBe("reject");
  });

  it("discardPending clears staged tailoring state", () => {
    useTailoringStore.setState({
      pendingContent: SAMPLE_CONTENT,
      bulletDecisions: { exp0_b0: "accept" },
      suggestedSkills: ["Python"],
      previewPdfUrl: "https://example.com/test.pdf",
    });

    useTailoringStore.getState().discardPending();

    const state = useTailoringStore.getState();
    expect(state.pendingContent).toBeNull();
    expect(state.bulletDecisions).toEqual({});
    expect(state.suggestedSkills).toEqual([]);
    expect(state.previewPdfUrl).toBeNull();
  });

  // Regression: tailoring a second, different JD against the same resume
  // (the normal case — a user has one master resume, multiple JDs) left
  // the PreviewPanel showing the *first* JD's generated PDF, because
  // useResumeStore.pdfSignedUrl was never cleared. The Studio page's
  // resume-hydration effect only re-syncs when resume.id !== storeResumeId
  // (see studio/[resumeId]/page.tsx) — since it's the same resume both
  // times, that effect is a no-op, so nothing else clears it either.
  it("discardPending also clears the stale generated-PDF preview on the resume store", async () => {
    useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    await useTailoringStore.getState().runTailoring("resume-abc");
    await useTailoringStore.getState().generatePreview("resume-abc");
    expect(useResumeStore.getState().pdfSignedUrl).toBe("https://example.com/tailored.pdf");

    // User starts tailoring against a second JD without ever saving or
    // discarding — both jd/page.tsx and jd/[jdId]/page.tsx call
    // discardPending() as part of kicking off that new run.
    useTailoringStore.getState().discardPending();

    expect(useResumeStore.getState().pdfSignedUrl).toBeNull();
  });

  it("runTailoring aborts polling updates if resetStore is called during polling", async () => {
    vi.useFakeTimers();
    try {
      useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
      useTailoringStore.getState().setJd("jd-001", "raw text");

      let resolvePoll: (val: any) => void = () => {};
      const pendingPollPromise = new Promise((res) => {
        resolvePoll = res;
      });
      vi.mocked(apiClient.getSession).mockReturnValue(pendingPollPromise as any);

      const runPromise = useTailoringStore.getState().runTailoring("resume-abc");

      // While polling is waiting, user resets the store
      useTailoringStore.getState().resetStore();

      // Resolve the background request
      resolvePoll(mockCompletedSession);
      await runPromise;

      // Store should remain reset and not hydrated by completed session
      const state = useTailoringStore.getState();
      expect(state.sessionId).toBeNull();
      expect(state.atsScore).toBeNull();
      expect(state.pendingContent).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  describe("ats fixes", () => {
    it("seeds fix decisions from default_accept and folds accepted skill fixes into merged content", async () => {
      useResumeStore.getState().setResume(
        "resume-abc",
        { contact: { name: "", email: "" }, experience: [], education: [], skills: ["Python"] },
        "ats_clean",
      );
      useTailoringStore.getState().setJd("jd-001", "raw text");
      vi.mocked(apiClient.getSession).mockResolvedValueOnce({
        ...mockCompletedSession,
        tailored_content: { contact: { name: "", email: "" }, experience: [], education: [], skills: ["Python"] },
        ats_fixes: [
          K8S_FIX,
          { ...K8S_FIX, id: "skill:tf", gap: "Terraform", text: "Terraform", default_accept: true },
        ],
        bullet_importance: { exp0_b0: "high" },
      } as never);

      await useTailoringStore.getState().runTailoring("resume-abc");

      // Terraform default-accepts; Kubernetes starts rejected
      expect(useTailoringStore.getState().bulletDecisions["fix:skill:k8s"]).toBe("reject");
      expect(useTailoringStore.getState().bulletDecisions["fix:skill:tf"]).toBe("accept");
      expect(useTailoringStore.getState().bulletImportance).toEqual({ exp0_b0: "high" });

      useTailoringStore.getState().setFixDecision("skill:k8s", "accept");
      await useTailoringStore.getState().generatePreview("resume-abc");

      const merged = vi.mocked(apiClient.generatePdf).mock.calls.at(-1)?.[2];
      expect(merged?.skills).toEqual(expect.arrayContaining(["Python", "Kubernetes", "Terraform"]));
    });

    it("setFixDecision calls projectScore with the accepted ids (debounced)", async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(apiClient.projectScore).mockResolvedValue({ projected_score: 88 });
        useTailoringStore.setState({
          sessionId: "sess-1",
          atsFixes: [K8S_FIX],
          bulletDecisions: {},
        } as never);

        useTailoringStore.getState().setFixDecision("skill:k8s", "accept");
        await vi.advanceTimersByTimeAsync(400);

        // No pendingContent in this setup, so no merged content to send —
        // the server falls back to scoring tailored_content + these ids.
        expect(apiClient.projectScore).toHaveBeenCalledWith("sess-1", ["skill:k8s"], undefined, undefined, {});
        expect(useTailoringStore.getState().projectedAtsScore).toBe(88);
      } finally {
        vi.useRealTimers();
      }
    });

    const bulletFix = {
      id: "bullet:kubernetes", type: "bullet" as const, gap: "Kubernetes", importance: "high" as const,
      grounded: false, text: "Operated Kubernetes clusters.", experience_index: 0,
      score_delta: 4, default_accept: false,
    };
    const twoRoles = {
      contact: { name: "Jane", email: "jane@example.com" },
      experience: [
        { company: "Acme", title: "Senior Eng", start: "2021", bullets: ["Did A"] },
        { company: "Beta", title: "Eng", start: "2018", bullets: ["Did B"] },
      ],
      education: [],
      skills: [],
    };

    it("setFixExperienceIndex moves an accepted bullet fix to the chosen role in the preview", async () => {
      useResumeStore.getState().setResume("resume-1", twoRoles, "ats_clean");
      useTailoringStore.setState({
        pendingContent: twoRoles,
        atsFixes: [bulletFix],
        bulletDecisions: { "fix:bullet:kubernetes": "accept" },
      } as never);

      await useTailoringStore.getState().generatePreview("resume-1");
      let merged = vi.mocked(apiClient.generatePdf).mock.calls.at(-1)?.[2];
      expect(merged?.experience[0].bullets).toContain("Operated Kubernetes clusters.");
      expect(merged?.experience[1].bullets).not.toContain("Operated Kubernetes clusters.");

      useTailoringStore.getState().setFixExperienceIndex("bullet:kubernetes", 1);
      await useTailoringStore.getState().generatePreview("resume-1");
      merged = vi.mocked(apiClient.generatePdf).mock.calls.at(-1)?.[2];
      expect(merged?.experience[1].bullets).toContain("Operated Kubernetes clusters.");
      expect(merged?.experience[0].bullets).not.toContain("Operated Kubernetes clusters.");
    });

    it("does not add a bullet fix that restates a bullet already in the target role", async () => {
      const content = {
        contact: { name: "", email: "" },
        experience: [
          { company: "Acme", title: "Eng", start: "2021", bullets: ["Operated Kubernetes clusters in production"] },
        ],
        education: [],
        skills: [],
      };
      useResumeStore.getState().setResume("resume-1", content, "ats_clean");
      useTailoringStore.setState({
        pendingContent: content,
        atsFixes: [{
          id: "bullet:k8s", type: "bullet", gap: "Kubernetes", importance: "high",
          grounded: false, text: "Operated Kubernetes clusters in production.",
          experience_index: 0, score_delta: 0, default_accept: false,
        }],
        bulletDecisions: { "fix:bullet:k8s": "accept" },
      } as never);

      await useTailoringStore.getState().generatePreview("resume-1");
      const merged = vi.mocked(apiClient.generatePdf).mock.calls.at(-1)?.[2];
      expect(merged?.experience[0].bullets).toEqual(["Operated Kubernetes clusters in production"]);
    });

    it("refreshProjectedScore re-scores with the current accepted fix ids (debounced)", async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(apiClient.projectScore).mockResolvedValue({ projected_score: 91 });
        useTailoringStore.setState({
          sessionId: "sess-9",
          atsFixes: [K8S_FIX, bulletFix],
          bulletDecisions: { "fix:skill:k8s": "accept", "fix:bullet:kubernetes": "accept" },
        } as never);

        useTailoringStore.getState().refreshProjectedScore();
        await vi.advanceTimersByTimeAsync(400);

        expect(apiClient.projectScore).toHaveBeenCalledWith(
          "sess-9", ["skill:k8s", "bullet:kubernetes"], undefined, undefined, {},
        );
        expect(useTailoringStore.getState().projectedAtsScore).toBe(91);
      } finally {
        vi.useRealTimers();
      }
    });
  });


  describe("refreshProjectedScore", () => {
    // Regression: the projected score was computed from the session's stored
    // tailored_content (every bullet accepted) plus the accepted fix ids, so
    // rejecting a tailored bullet left the "→ N%" on screen unmoved.
    async function tailorWithOneBullet() {
      const original: ResumeContent = {
        ...SAMPLE_CONTENT,
        experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff"] }],
      };
      useResumeStore.getState().setResume("resume-abc", original, "ats_clean");
      useTailoringStore.getState().setJd("jd-001", "raw text");
      vi.mocked(apiClient.getSession).mockResolvedValueOnce({
        ...mockCompletedSession,
        tailored_content: {
          ...mockCompletedSession.tailored_content,
          experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff, tailored"] }],
        },
      });
      await useTailoringStore.getState().runTailoring("resume-abc");
      vi.mocked(apiClient.projectScore).mockResolvedValue({ projected_score: 70 });
    }

    it("sends the merged content, not just the accepted fix ids", async () => {
      vi.useFakeTimers();
      try {
        await tailorWithOneBullet();
        useTailoringStore.getState().setBulletDecision("exp0_b0", "reject");
        useTailoringStore.getState().refreshProjectedScore();
        await vi.advanceTimersByTimeAsync(500);

        const content = vi.mocked(apiClient.projectScore).mock.calls.at(-1)?.[2];
        expect(content?.experience[0].bullets).toEqual(["Did stuff"]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("sends the tailored bullet when the user keeps it", async () => {
      vi.useFakeTimers();
      try {
        await tailorWithOneBullet();
        useTailoringStore.getState().setBulletDecision("exp0_b0", "accept");
        useTailoringStore.getState().refreshProjectedScore();
        await vi.advanceTimersByTimeAsync(500);

        const content = vi.mocked(apiClient.projectScore).mock.calls.at(-1)?.[2];
        expect(content?.experience[0].bullets).toEqual(["Did stuff, tailored"]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("recomputes when a bullet decision changes, not only when a fix is toggled", async () => {
      vi.useFakeTimers();
      try {
        await tailorWithOneBullet();
        vi.mocked(apiClient.projectScore).mockClear();
        useTailoringStore.getState().setBulletDecision("exp0_b0", "reject");
        await vi.advanceTimersByTimeAsync(500);

        expect(apiClient.projectScore).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("seeds an accept decision for a rewritten project bullet, like experience", async () => {
    const original: ResumeContent = {
      ...SAMPLE_CONTENT,
      experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff"] }],
      projects: [{ name: "Pipeline", bullets: ["Built a thing"] }],
    };
    useResumeStore.getState().setResume("resume-abc", original, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.getSession).mockResolvedValueOnce({
      ...mockCompletedSession,
      tailored_content: {
        ...mockCompletedSession.tailored_content,
        experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff, tailored"] }],
        projects: [{ name: "Pipeline", bullets: ["Engineered a thing"] }],
      },
    });
    await useTailoringStore.getState().runTailoring("resume-abc");

    const decisions = useTailoringStore.getState().bulletDecisions;
    expect(decisions["exp0_b0"]).toBe("accept");
    expect(decisions["proj0_b0"]).toBe("accept");
  });

  it("hydrates revertedBullets from the session", async () => {
    const original: ResumeContent = {
      ...SAMPLE_CONTENT,
      experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Built checkout."] }],
    };
    useResumeStore.getState().setResume("resume-abc", original, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.getSession).mockResolvedValueOnce({
      ...mockCompletedSession,
      tailored_content: {
        ...mockCompletedSession.tailored_content,
        experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Built checkout."] }],
      },
      reverted_bullets: [{
        bullet_id: "exp0_b0",
        reasons: ["invented metric(s) not in the original bullet: 2"],
        original_text: "Built checkout.",
        rejected_text: "Built checkout for 2M users.",
      }],
    });
    await useTailoringStore.getState().runTailoring("resume-abc");

    const reverted = useTailoringStore.getState().revertedBullets;
    expect(reverted).toHaveLength(1);
    expect(reverted[0].bullet_id).toBe("exp0_b0");
  });

  it("defaults revertedBullets to empty when the session omits them", async () => {
    useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.getSession).mockResolvedValueOnce(mockCompletedSession);
    await useTailoringStore.getState().runTailoring("resume-abc");
    expect(useTailoringStore.getState().revertedBullets).toEqual([]);
  });

  it("clears revertedBullets on reset", async () => {
    useTailoringStore.setState({ revertedBullets: [{ bullet_id: "x", reasons: [], original_text: "", rejected_text: "" }] } as never);
    useTailoringStore.getState().resetStore();
    expect(useTailoringStore.getState().revertedBullets).toEqual([]);
  });

  it("hydrates bulletRationale from the session", async () => {
    useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.getSession).mockResolvedValueOnce({
      ...mockCompletedSession,
      bullet_rationale: { exp0_b0: { responsibility: "own checkout delivery", keywords: ["Python"] } },
    });
    await useTailoringStore.getState().runTailoring("resume-abc");
    expect(useTailoringStore.getState().bulletRationale["exp0_b0"].keywords).toEqual(["Python"]);
  });

  it("defaults bulletRationale to empty when the session omits it", async () => {
    useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.getSession).mockResolvedValueOnce(mockCompletedSession);
    await useTailoringStore.getState().runTailoring("resume-abc");
    expect(useTailoringStore.getState().bulletRationale).toEqual({});
  });

  it("hydrates atsScoreBefore from the session", async () => {
    useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.getSession).mockResolvedValueOnce({
      ...mockCompletedSession, ats_score: 81, ats_score_before: 62,
    });
    await useTailoringStore.getState().runTailoring("resume-abc");
    expect(useTailoringStore.getState().atsScoreBefore).toBe(62);
    expect(useTailoringStore.getState().atsScore).toBe(81);
  });

  it("leaves atsScoreBefore null for a session tailored before it was recorded", async () => {
    useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    vi.mocked(apiClient.getSession).mockResolvedValueOnce(mockCompletedSession);
    await useTailoringStore.getState().runTailoring("resume-abc");
    expect(useTailoringStore.getState().atsScoreBefore).toBeNull();
  });

  describe("every decision that changes the resume re-scores it", () => {
    // The review screen shows a live "before -> now" score. Any mutator that
    // changes what the merged resume contains must refresh it, or the number
    // silently goes stale and the feature reads as broken.
    async function tailored() {
      const original: ResumeContent = {
        ...SAMPLE_CONTENT,
        skills: ["React"],
        experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff"] }],
      };
      useResumeStore.getState().setResume("resume-abc", original, "ats_clean");
      useTailoringStore.getState().setJd("jd-001", "raw text");
      vi.mocked(apiClient.getSession).mockResolvedValueOnce({
        ...mockCompletedSession,
        suggested_skills: ["Kubernetes", "Docker"],
        tailored_content: {
          ...mockCompletedSession.tailored_content,
          experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff, tailored"] }],
        },
      });
      await useTailoringStore.getState().runTailoring("resume-abc");
      vi.mocked(apiClient.projectScore).mockClear();
      vi.mocked(apiClient.projectScore).mockResolvedValue({ projected_score: 77 });
    }

    it("re-scores when every bullet is accepted at once", async () => {
      vi.useFakeTimers();
      try {
        await tailored();
        const changes = [{ key: "exp0_b0", jobIdx: 0, bulletIdx: 0, jobTitle: "Engineer",
                           company: "Acme", original: "Did stuff", tailored: "Did stuff, tailored" }];
        useTailoringStore.getState().setAllBulletDecisions(changes, "reject");
        await vi.advanceTimersByTimeAsync(500);
        expect(apiClient.projectScore).toHaveBeenCalled();
      } finally { vi.useRealTimers(); }
    });

    it("re-scores when skills are chosen in bulk", async () => {
      vi.useFakeTimers();
      try {
        await tailored();
        useTailoringStore.getState().applyBulletDecisions({ "skill_add:Kubernetes": "accept" });
        await vi.advanceTimersByTimeAsync(500);
        expect(apiClient.projectScore).toHaveBeenCalled();
      } finally { vi.useRealTimers(); }
    });

    it("re-scores when a bullet is rewritten in place", async () => {
      vi.useFakeTimers();
      try {
        await tailored();
        useTailoringStore.getState().updatePendingBullet("exp0_b0", "Engineered Kubernetes pipelines");
        await vi.advanceTimersByTimeAsync(500);
        expect(apiClient.projectScore).toHaveBeenCalled();
      } finally { vi.useRealTimers(); }
    });

    it("re-scores when the summary is rewritten", async () => {
      vi.useFakeTimers();
      try {
        await tailored();
        useTailoringStore.getState().updatePendingSummary("Kubernetes platform engineer");
        await vi.advanceTimersByTimeAsync(500);
        expect(apiClient.projectScore).toHaveBeenCalled();
      } finally { vi.useRealTimers(); }
    });

    it("surfaces a re-score failure instead of leaving a stale number", async () => {
      vi.useFakeTimers();
      try {
        await tailored();
        vi.mocked(apiClient.projectScore).mockRejectedValue(new Error("409 no cached analysis"));
        useTailoringStore.getState().setBulletDecision("exp0_b0", "reject");
        await vi.advanceTimersByTimeAsync(500);
        expect(useTailoringStore.getState().projectedScoreStale).toBe(true);
      } finally { vi.useRealTimers(); }
    });

    it("clears the stale flag once a re-score succeeds again", async () => {
      vi.useFakeTimers();
      try {
        await tailored();
        vi.mocked(apiClient.projectScore).mockRejectedValueOnce(new Error("boom"));
        useTailoringStore.getState().setBulletDecision("exp0_b0", "reject");
        await vi.advanceTimersByTimeAsync(500);
        expect(useTailoringStore.getState().projectedScoreStale).toBe(true);

        useTailoringStore.getState().setBulletDecision("exp0_b0", "accept");
        await vi.advanceTimersByTimeAsync(500);
        expect(useTailoringStore.getState().projectedScoreStale).toBe(false);
      } finally { vi.useRealTimers(); }
    });
  });

  describe("project bullets in the review merge", () => {
    // The pipeline now rewrites project bullets too (bullet_id "proj{i}_b{j}").
    // buildMergedContent must honour accept/reject on them — otherwise a
    // rewritten project bullet ships no matter what the user decided.
    function setup() {
      const original: ResumeContent = {
        ...SAMPLE_CONTENT,
        experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff"] }],
        projects: [{ name: "Pipeline", bullets: ["Built a thing"] }],
      };
      useResumeStore.getState().setResume("resume-abc", original, "ats_clean");
      useTailoringStore.getState().setJd("jd-001", "raw text");
      vi.mocked(apiClient.getSession).mockResolvedValueOnce({
        ...mockCompletedSession,
        tailored_content: {
          ...mockCompletedSession.tailored_content,
          experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff, tailored"] }],
          projects: [{ name: "Pipeline", bullets: ["Engineered a thing, tailored"] }],
        },
      });
      return useTailoringStore.getState().runTailoring("resume-abc");
    }

    it("keeps a rejected project bullet at its original text", async () => {
      await setup();
      useTailoringStore.getState().setBulletDecision("proj0_b0", "reject");
      await useTailoringStore.getState().generatePreview("resume-abc");

      const merged = vi.mocked(apiClient.generatePdf).mock.calls.at(-1)?.[2];
      expect(merged?.projects?.[0].bullets).toEqual(["Built a thing"]);
    });

    it("uses the tailored project bullet when accepted", async () => {
      await setup();
      useTailoringStore.getState().setBulletDecision("proj0_b0", "accept");
      await useTailoringStore.getState().generatePreview("resume-abc");

      const merged = vi.mocked(apiClient.generatePdf).mock.calls.at(-1)?.[2];
      expect(merged?.projects?.[0].bullets).toEqual(["Engineered a thing, tailored"]);
    });

    it("leaves a resume with no projects untouched", async () => {
      const original: ResumeContent = {
        ...SAMPLE_CONTENT,
        experience: [{ company: "Acme", title: "Engineer", start: "2020", bullets: ["Did stuff"] }],
      };
      useResumeStore.getState().setResume("resume-abc", original, "ats_clean");
      useTailoringStore.getState().setJd("jd-001", "raw text");
      vi.mocked(apiClient.getSession).mockResolvedValueOnce(mockCompletedSession);
      await useTailoringStore.getState().runTailoring("resume-abc");
      await useTailoringStore.getState().generatePreview("resume-abc");

      const merged = vi.mocked(apiClient.generatePdf).mock.calls.at(-1)?.[2];
      expect(merged?.projects ?? []).toEqual([]);
    });
  });

});

describe("deriveBulletChanges", () => {
  // What the review screen lists. A bullet the pipeline rewrote but this
  // function doesn't return is a change that ships with no review at all.
  const base = { contact: { name: "J", email: "j@j.com" }, education: [], skills: [] };

  it("lists a changed experience bullet", () => {
    const original = { ...base, experience: [{ company: "Acme", title: "Eng", start: "2020", bullets: ["Did stuff"] }] };
    const pending = { ...base, experience: [{ company: "Acme", title: "Eng", start: "2020", bullets: ["Did stuff, tailored"] }] };
    const changes = deriveBulletChanges(pending as never, original as never);
    expect(changes.map((c) => c.key)).toEqual(["exp0_b0"]);
    expect(changes[0].original).toBe("Did stuff");
    expect(changes[0].tailored).toBe("Did stuff, tailored");
  });

  it("lists a changed project bullet", () => {
    const original = { ...base, experience: [], projects: [{ name: "Pipeline", bullets: ["Built a thing"] }] };
    const pending = { ...base, experience: [], projects: [{ name: "Pipeline", bullets: ["Engineered a thing"] }] };
    const changes = deriveBulletChanges(pending as never, original as never);
    expect(changes.map((c) => c.key)).toEqual(["proj0_b0"]);
    expect(changes[0].tailored).toBe("Engineered a thing");
  });

  it("labels a project change by its project name", () => {
    const original = { ...base, experience: [], projects: [{ name: "Pipeline", bullets: ["Built a thing"] }] };
    const pending = { ...base, experience: [], projects: [{ name: "Pipeline", bullets: ["Engineered a thing"] }] };
    expect(deriveBulletChanges(pending as never, original as never)[0].jobTitle).toBe("Pipeline");
  });

  it("omits an unchanged bullet", () => {
    const original = { ...base, experience: [{ company: "Acme", title: "Eng", start: "2020", bullets: ["Did stuff"] }] };
    expect(deriveBulletChanges(original as never, original as never)).toEqual([]);
  });

  it("ignores whitespace-only differences", () => {
    const original = { ...base, experience: [{ company: "Acme", title: "Eng", start: "2020", bullets: ["Did stuff"] }] };
    const pending = { ...base, experience: [{ company: "Acme", title: "Eng", start: "2020", bullets: ["  Did stuff  "] }] };
    expect(deriveBulletChanges(pending as never, original as never)).toEqual([]);
  });

  it("lists experience changes before project changes", () => {
    const original = {
      ...base,
      experience: [{ company: "Acme", title: "Eng", start: "2020", bullets: ["Did stuff"] }],
      projects: [{ name: "Pipeline", bullets: ["Built a thing"] }],
    };
    const pending = {
      ...base,
      experience: [{ company: "Acme", title: "Eng", start: "2020", bullets: ["Did stuff, tailored"] }],
      projects: [{ name: "Pipeline", bullets: ["Engineered a thing"] }],
    };
    expect(deriveBulletChanges(pending as never, original as never).map((c) => c.key))
      .toEqual(["exp0_b0", "proj0_b0"]);
  });

  it("returns nothing when either side is missing", () => {
    expect(deriveBulletChanges(null as never, null as never)).toEqual([]);
  });
});

describe("updatePendingBullet across sections", () => {
  // The review screen's Rewrite/Humanize buttons write back through this.
  // Addressing by bare index would send a project bullet's rewrite into the
  // experience entry at the same index.
  const pending = {
    contact: { name: "J", email: "j@j.com" }, education: [], skills: [],
    experience: [{ company: "Acme", title: "Eng", start: "2020", bullets: ["Exp bullet"] }],
    projects: [{ name: "Pipeline", bullets: ["Proj bullet"] }],
  };

  it("writes an experience bullet by its key", () => {
    useTailoringStore.setState({ pendingContent: pending } as never);
    useTailoringStore.getState().updatePendingBullet("exp0_b0", "Rewritten exp");
    const c = useTailoringStore.getState().pendingContent!;
    expect(c.experience[0].bullets).toEqual(["Rewritten exp"]);
    expect(c.projects![0].bullets).toEqual(["Proj bullet"]);
  });

  it("writes a project bullet by its key without touching experience", () => {
    useTailoringStore.setState({ pendingContent: pending } as never);
    useTailoringStore.getState().updatePendingBullet("proj0_b0", "Rewritten proj");
    const c = useTailoringStore.getState().pendingContent!;
    expect(c.projects![0].bullets).toEqual(["Rewritten proj"]);
    expect(c.experience[0].bullets).toEqual(["Exp bullet"]);
  });

  it("ignores a key for a section the resume does not have", () => {
    const noProjects = { ...pending, projects: undefined };
    useTailoringStore.setState({ pendingContent: noProjects } as never);
    useTailoringStore.getState().updatePendingBullet("proj0_b0", "nope");
    expect(useTailoringStore.getState().pendingContent!.experience[0].bullets).toEqual(["Exp bullet"]);
  });
});

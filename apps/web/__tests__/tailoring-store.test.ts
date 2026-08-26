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
  },
}));

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

import { useTailoringStore, MAX_MERGED_SKILLS } from "../stores/tailoring-store";
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
      []
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
      []
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
      12
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
      20
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

  it("setPrioritySkills and togglePrioritySkill manage the priority list", () => {
    useTailoringStore.getState().setPrioritySkills(["Kubernetes", "Terraform"]);
    expect(useTailoringStore.getState().prioritySkills).toEqual(["Kubernetes", "Terraform"]);

    useTailoringStore.getState().togglePrioritySkill("Kubernetes"); // already present → removed
    expect(useTailoringStore.getState().prioritySkills).toEqual(["Terraform"]);

    useTailoringStore.getState().togglePrioritySkill("Docker"); // absent → added
    expect(useTailoringStore.getState().prioritySkills).toEqual(["Terraform", "Docker"]);
  });

  it("runTailoring forwards the current prioritySkills to apiClient.tailorResume", async () => {
    useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    useTailoringStore.getState().setPrioritySkills(["Kubernetes"]);

    await useTailoringStore.getState().runTailoring("resume-abc");

    expect(apiClient.tailorResume).toHaveBeenCalledWith(
      "resume-abc",
      "jd-001",
      50,
      undefined,
      ["Kubernetes"]
    );
  });

  it("runTailoring auto-accepts skill_add decisions for priority skills present in the result", async () => {
    useResumeStore.getState().setResume("resume-abc", SAMPLE_CONTENT, "ats_clean");
    useTailoringStore.getState().setJd("jd-001", "raw text");
    useTailoringStore.getState().setPrioritySkills(["Kubernetes"]);
    vi.mocked(apiClient.getSession).mockResolvedValueOnce({
      ...mockCompletedSession,
      suggested_skills: ["Kubernetes", "Docker"],
    });

    await useTailoringStore.getState().runTailoring("resume-abc");

    const decisions = useTailoringStore.getState().bulletDecisions;
    // The user's pick is pre-accepted...
    expect(decisions["skill_add:Kubernetes"]).toBe("accept");
    // ...but an AI-only suggestion the user didn't ask for is not auto-decided.
    expect(decisions["skill_add:Docker"]).toBeUndefined();
  });

  it("resetStore clears prioritySkills", () => {
    useTailoringStore.getState().setPrioritySkills(["Kubernetes"]);
    useTailoringStore.getState().resetStore();
    expect(useTailoringStore.getState().prioritySkills).toEqual([]);
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

    useTailoringStore.getState().updatePendingBullet(0, 1, "Bullet 2 updated");

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
});


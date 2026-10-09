"use client";
import { use, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { Card } from "@/components/ui/Card";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { TargetCompanyField } from "@/components/tailoring/TargetCompanyField";
import { useTailoringStore } from "@/stores/tailoring-store";
import { usePrepQuestionsStore, startPrepQuestions } from "@/stores/prep-questions-store";
import { getCareerProfile, type CareerProfile } from "@/lib/career-profile-client";
import type { AnalyzeOut, JobDescription, Resume, JDDetails, JDCoverLetter } from "@career-copilot/types";
import {
  CheckCircle,
  WarningCircle,
  ArrowLeft,
  Sparkle,
  FolderOpen,
  Target,
  FileText,
  Microphone,
  EnvelopeSimple,
} from "@phosphor-icons/react";

export default function JDPage({
  params,
}: {
  params: Promise<{ jdId: string }>;
}) {
  const { jdId } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isOpening, setIsOpening] = useState(false);
  const [tailorError, setTailorError] = useState<string | null>(null);
  // Prefilled only when the store's company was given for this same JD.
  const [company, setCompany] = useState(() => {
    const s = useTailoringStore.getState();
    return s.jdId === jdId ? s.companyName : "";
  });

  const setJd = useTailoringStore((s) => s.setJd);
  const setAnalysisResults = useTailoringStore((s) => s.setAnalysisResults);

  const { data: jd } = useQuery<JobDescription>({
    queryKey: ["jd", jdId],
    queryFn: () => apiClient.getJd(jdId),
  });

  const { data: careerProfile } = useQuery<CareerProfile | null>({
    queryKey: ["careerProfile"],
    queryFn: () => getCareerProfile(),
  });

  const { data: resumes = [] } = useQuery<Resume[]>({
    queryKey: ["resumes"],
    queryFn: () => apiClient.getResumes(),
  });

  // Everything already generated for this JD — the latest tailored resume
  // and its interview prep progress — so this page can show that work
  // instead of only ever offering to start it over.
  const { data: jdDetails } = useQuery<JDDetails>({
    queryKey: ["jdDetails", jdId],
    queryFn: () => apiClient.getJdDetails(jdId),
  });

  const [isGeneratingLetter, setIsGeneratingLetter] = useState(false);
  const [letterError, setLetterError] = useState<string | null>(null);

  const { data: coverLetter } = useQuery<JDCoverLetter>({
    queryKey: ["jdCoverLetter", jdId],
    queryFn: () => apiClient.getJdCoverLetter(jdId),
  });

  async function handleGenerateCoverLetter() {
    if (!masterResume) return;
    setIsGeneratingLetter(true);
    setLetterError(null);
    try {
      const { cover_letter_id } = await apiClient.generateCoverLetter(masterResume.id, jdId, 50);
      // Invalidate so a return-navigation to this page within the default
      // 60s staleTime window (see providers.tsx) doesn't show the stale
      // "Not generated yet" state with a re-clickable Generate button.
      queryClient.invalidateQueries({ queryKey: ["jdCoverLetter", jdId] });
      queryClient.invalidateQueries({ queryKey: ["coverLetters"] });
      router.push(`/cover-letters/${cover_letter_id}`);
    } catch (e: unknown) {
      setLetterError(e instanceof Error ? e.message : "Failed to generate cover letter");
      setIsGeneratingLetter(false);
    }
  }

  // Only show the master resume; fall back to first resume if no profile set
  const masterResume = resumes.find((r) => r.id === careerProfile?.master_resume_id)
    ?? resumes[0]
    ?? null;

  // Read-only match analysis for this specific JD/resume pair — does not
  // touch the resume, same semantics as the JD Analyzer index page's
  // "Analyze Description" step.
  const { data: analysis, isLoading: isAnalyzing, isError: isAnalysisError, refetch: refetchAnalysis } = useQuery<AnalyzeOut>({
    queryKey: ["jdAnalysis", jdId, masterResume?.id],
    queryFn: () => apiClient.analyzeJd(masterResume!.id, jdId),
    enabled: !!masterResume,
    // This calls a multi-LLM-call, rate-limited backend endpoint — not a
    // cheap read. Cache aggressively so revisiting this page doesn't
    // re-bill the analysis on every visit past the app's default 60s
    // staleTime.
    staleTime: 10 * 60 * 1000,
  });

  const matchedSkills = analysis?.matched_skills ?? [];
  const missingSkills = analysis?.missing_skills ?? [];

  function handleTailor() {
    if (!masterResume) {
      setTailorError("No resume found. Please create or set up a resume first.");
      return;
    }
    if (!jd) {
      setTailorError("Job description not found.");
      return;
    }
    setTailorError(null);
    useTailoringStore.getState().discardPending();
    // Load JD context into the tailoring store so EditorPanel picks it up.
    setJd(jdId, jd.raw_text);
    // Also push the analysis results so the studio can display the ATS context.
    if (analysis) {
      setAnalysisResults({
        atsScore: analysis.ats_score,
        matchedSkills: analysis.matched_skills,
        missingSkills: analysis.missing_skills,
        companyKeywords: analysis.company_keywords ?? [],
      });
    }
    // After setJd, which clears it for a different JD: the review page starts
    // the run on arrival, so this is when the company has to be in the store.
    useTailoringStore.getState().setCompanyName(company.trim());
    // Straight to the tailoring review, which runs the pipeline on arrival.
    // Not the Builder: its six sections are not part of this path.
    router.push(`/studio/${masterResume.id}/review`);
  }

  // Saving the tailored résumé to this JD starts its questions (from the
  // Studio); "Generate questions" covers a JD saved before that was so, or a
  // generation that failed. Either way the same in-flight state shows here.
  const isGeneratingQuestions = usePrepQuestionsStore((s) => jdId in s.pending);
  const prepError = usePrepQuestionsStore((s) => s.errors[jdId] ?? null);
  function handleGenerateQuestions() {
    void startPrepQuestions(queryClient, jdId, { title: jd?.title });
  }

  async function handleOpen() {
    if (!masterResume) return;
    setIsOpening(true);
    // Do NOT call setJd() here — "Open" means "show me the resume I already
    // tailored," not "enter the tailoring flow for this JD." Setting jdId
    // makes EditorPanel's hasJdContext true, which collapses the content
    // editor into its JD-context "Expand to edit" state by default — so the
    // tailored resume the user just asked to open renders hidden behind a
    // collapsed header, reading as a blank/default Studio page.
    //
    // jdDetails.resume_id is the resume the user explicitly saved for this
    // JD (JobDescription.tailored_resume_id) when one exists, falling back
    // to the resume tailoring was last run against — either way, the
    // Studio page fetches that resume's real saved content itself, so no
    // separate session/content hydration is needed here.
    router.push(`/studio/${jdDetails?.resume_id ?? masterResume.id}`);
    setIsOpening(false);
  }

  return (
    <div className="w-full min-w-0 max-w-[1440px] mx-auto p-gutter pb-xxl flex flex-col gap-section">
      {/* Page Header */}
      <section className="pt-xs sm:pt-lg sm:pb-md flex flex-row items-end justify-between gap-md">
        <div className="min-w-0">
          <h1 className="text-headline-xl text-on-surface mb-xs font-bold" style={{ letterSpacing: "-0.02em" }}>
            JD Analysis
          </h1>
          <p className="text-body-md sm:text-body-lg text-on-surface-variant truncate">
            {jd?.title ?? "Loading…"}
          </p>
        </div>
        <button
          onClick={() => router.back()}
          className="shrink-0 flex items-center gap-xs sm:gap-sm text-label-md text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <ArrowLeft size={16} />
          Back
        </button>
      </section>

      {/* Bento Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-gutter">
        {/* Parsed Skills — spans 2 cols */}
        <Card className="min-w-0 lg:col-span-2 flex flex-col gap-sm sm:gap-md">
          <h2 className="text-headline-md text-on-surface flex items-center gap-xs sm:gap-sm font-semibold">
            Skills from JD
            <InfoTooltip text="Every skill our parser found in this job description's text." />
          </h2>
          {jd?.parsed_skills && jd.parsed_skills.length > 0 ? (
            <div className="flex flex-wrap gap-xs">
              {jd.parsed_skills.map((skill) => (
                <span
                  key={skill}
                  className="flex items-center gap-xs px-sm py-xs bg-secondary-container text-on-secondary-container text-label-sm rounded-md border border-outline-variant/30"
                >
                  <CheckCircle size={14} weight="fill" className="text-primary" />
                  {skill}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-body-sm text-on-surface-variant">
              {jd ? "No parsed skills available." : "Loading…"}
            </p>
          )}
        </Card>

        {/* Matched / Not Matched — same color convention as the JD Analyzer
            index page (success = matched, error = not matched). */}
        <Card className="min-w-0 lg:col-span-2 flex flex-col gap-sm sm:gap-md">
          <h2 className="text-headline-md text-on-surface flex items-center gap-xs sm:gap-sm font-semibold">
            <Target size={20} className="hidden sm:block text-primary" />
            <span className="sm:hidden">Keywords</span>
            <span className="hidden sm:inline">Keywords — Matched &amp; Not Matched</span>
            <InfoTooltip text="Which of this JD's skills your resume already covers, and which are missing. Tailor ranks the missing ones by how much each would raise your ATS score." />
          </h2>

          {!masterResume ? (
            <p className="text-body-sm text-on-surface-variant">No resume found. Create one first.</p>
          ) : isAnalyzing ? (
            <p className="text-body-sm text-on-surface-variant">Analyzing…</p>
          ) : isAnalysisError ? (
            <div className="flex flex-col items-start gap-xs">
              <p className="text-body-sm text-error">Failed to analyze this job description.</p>
              <button
                type="button"
                onClick={() => refetchAnalysis()}
                className="text-label-sm text-primary hover:underline"
              >
                Retry
              </button>
            </div>
          ) : matchedSkills.length === 0 && missingSkills.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">No keyword data available.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-sm">
              <div className="rounded-xl border border-success/25 bg-success-container/25 p-sm flex flex-col gap-xs min-w-0">
                <h3 className="text-label-sm font-bold text-on-success-container flex items-center gap-xs">
                  <CheckCircle size={15} weight="fill" className="text-success shrink-0" />
                  <span>Matched</span>
                  <span className="ml-auto shrink-0 text-caption font-bold px-xs rounded-full bg-success text-on-success">
                    {matchedSkills.length}
                  </span>
                </h3>
                {matchedSkills.length > 0 ? (
                  <div className="flex flex-wrap gap-xs max-h-40 overflow-y-auto">
                    {matchedSkills.map((skill) => (
                      <span
                        key={skill}
                        className="flex items-center gap-xs px-xs py-0.5 bg-success/10 text-on-success-container text-caption font-medium rounded-md border border-success/30"
                      >
                        <CheckCircle size={11} weight="fill" className="text-success shrink-0" />
                        {skill}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-caption text-on-surface-variant italic">None yet.</p>
                )}
              </div>

              <div className="rounded-xl border border-error/25 bg-error-container/20 p-sm flex flex-col gap-xs min-w-0">
                <h3 className="text-label-sm font-bold text-on-error-container flex items-center gap-xs">
                  <WarningCircle size={15} weight="fill" className="text-error shrink-0" />
                  <span>Not Matched</span>
                  <span className="ml-auto shrink-0 text-caption font-bold px-xs rounded-full bg-error text-on-error">
                    {missingSkills.length}
                  </span>
                </h3>
                {missingSkills.length > 0 ? (
                  <div className="flex flex-wrap gap-xs max-h-40 overflow-y-auto">
                    {missingSkills.map((skill) => (
                      <span
                        key={skill}
                        className="flex items-center gap-xs px-xs py-0.5 text-caption font-medium rounded-md border bg-error-container/40 text-on-error-container border-error/30"
                      >
                        <WarningCircle size={11} weight="fill" className="text-error shrink-0" />
                        {skill}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-caption text-on-surface-variant italic">None — full coverage.</p>
                )}
              </div>
            </div>
          )}
        </Card>

        {/* Re-run Resume Builder panel */}
        <Card className="min-w-0 lg:col-span-2 flex flex-col gap-sm sm:gap-md">
          <div>
            <h2 className="text-headline-md text-on-surface font-semibold">Resume Builder</h2>
            <p className="hidden sm:block text-caption text-on-surface-variant mt-xs">
              Tailor your resume to this job description, or open it as-is in the studio.
            </p>
          </div>

          {!masterResume ? (
            <p className="text-body-sm text-on-surface-variant">No resume found. Create one first.</p>
          ) : (
            <div className="flex flex-col gap-sm flex-1">
              {/* Resume row */}
              <div className="px-sm sm:px-md py-sm rounded-xl border border-outline-variant/20 bg-surface-container/40">
                <p className="text-label-md text-on-surface font-semibold truncate">{masterResume.title}</p>
                <p className="text-caption text-on-surface-variant mt-xs">
                  Updated {new Date(masterResume.updated_at).toLocaleDateString()}
                </p>
              </div>

              {/* Tailor is this card's single action. The "Open" that used to
                  sit beside it called the same handleOpen as the one in
                  "Generated for This JD" below — and that one sits next to the
                  resume it opens, which this one did not. */}
              <TargetCompanyField id="jd-detail-company" value={company} onChange={setCompany} />

              <div className="flex mt-xs">
                <button
                  onClick={handleTailor}
                  className="flex-1 flex items-center justify-center gap-xs py-sm rounded-xl text-label-sm text-on-primary bg-primary shadow-md hover:shadow-lg hover:scale-[0.98] active:scale-95 transition-all"
                >
                  <Sparkle size={14} />
                  Tailor
                </button>
              </div>
            </div>
          )}

          {tailorError && <p className="text-caption text-error">{tailorError}</p>}
        </Card>

        {/* Generated for this JD — the tailored resume and interview prep
            progress from the latest completed tailoring run, if any. Reads
            from jd_id-linked TailoringSession/PrepQuestion rows so this
            stays accurate even after navigating away and back. */}
        <Card className="min-w-0 lg:col-span-2 flex flex-col gap-sm sm:gap-md">
          <h2 className="text-headline-md text-on-surface flex items-center gap-xs sm:gap-sm font-semibold">
            <span className="sm:hidden">For this JD</span>
            <span className="hidden sm:inline">Generated for This JD</span>
            <InfoTooltip text="Your latest tailored resume, interview prep progress, and cover letter for this specific job — from your most recent Tailor run." />
          </h2>

          {!jdDetails?.session_id ? (
            <p className="text-body-sm text-on-surface-variant">
              No tailored resume yet — click Tailor above to generate one.
            </p>
          ) : (
            <div className="flex flex-col gap-sm">
              {/* Tailored resume */}
              <div className="flex flex-col items-stretch gap-xs sm:flex-row sm:items-center sm:gap-md px-sm sm:px-md py-sm rounded-xl border border-outline-variant/20 bg-surface-container/40">
                <div className="hidden sm:flex w-9 h-9 rounded-lg bg-primary/10 text-primary items-center justify-center shrink-0">
                  <FileText size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-label-md text-on-surface font-semibold truncate">
                    {jdDetails.resume_title ?? "Tailored resume"}
                  </p>
                  <p className="text-caption text-on-surface-variant">
                    {jdDetails.ats_score !== null ? `${jdDetails.ats_score}% ATS match` : "Tailored"}
                    {jdDetails.session_created_at &&
                      ` · ${new Date(jdDetails.session_created_at).toLocaleDateString()}`}
                  </p>
                </div>
                <button
                  onClick={handleOpen}
                  disabled={isOpening}
                  className="shrink-0 flex items-center justify-center gap-xs px-sm py-xs rounded-lg text-label-sm text-primary border border-primary/30 hover:bg-primary/5 transition-all disabled:opacity-50"
                >
                  <FolderOpen size={14} />
                  Open
                </button>
              </div>

              {/* Interview prep progress */}
              <div className="flex flex-col items-stretch gap-xs sm:flex-row sm:items-center sm:gap-md px-sm sm:px-md py-sm rounded-xl border border-outline-variant/20 bg-surface-container/40">
                <div className="hidden sm:flex w-9 h-9 rounded-lg bg-primary/10 text-primary items-center justify-center shrink-0">
                  <Microphone size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-label-md text-on-surface font-semibold">Interview Practice</p>
                  <p className="text-caption text-on-surface-variant">
                    {jdDetails.questions_total > 0
                      ? `${jdDetails.questions_practiced} of ${jdDetails.questions_total} questions practiced`
                      : isGeneratingQuestions
                      ? "Preparing your interview questions — usually under a minute"
                      : jdDetails.resume_saved
                      ? "Questions are made from the résumé you saved for this job"
                      : "Save your tailored résumé to this job to get interview questions"}
                  </p>
                  {prepError && <p className="text-caption text-error mt-xs">{prepError}</p>}
                </div>
                {jdDetails.questions_total > 0 ? (
                  <button
                    onClick={() =>
                      router.push(`/interview/${jdDetails.questions_session_id ?? jdDetails.session_id}`)
                    }
                    className="shrink-0 flex items-center justify-center gap-xs px-sm py-xs rounded-lg text-label-sm text-primary border border-primary/30 hover:bg-primary/5 transition-all"
                  >
                    Practice
                  </button>
                ) : jdDetails.resume_saved || isGeneratingQuestions ? (
                  <button
                    onClick={handleGenerateQuestions}
                    disabled={isGeneratingQuestions}
                    className="shrink-0 flex items-center justify-center gap-xs px-sm py-xs rounded-lg text-label-sm text-primary border border-primary/30 hover:bg-primary/5 transition-all disabled:opacity-50"
                  >
                    {isGeneratingQuestions ? "Generating…" : "Generate questions"}
                  </button>
                ) : null}
              </div>
            </div>
          )}

          {/* Cover letter — unconditional, unlike the two rows above: a
              letter can be generated standalone before any tailoring
              session exists for this JD. */}
          <div className="flex flex-col items-stretch gap-xs sm:flex-row sm:items-center sm:gap-md px-sm sm:px-md py-sm rounded-xl border border-outline-variant/20 bg-surface-container/40">
            <div className="hidden sm:flex w-9 h-9 rounded-lg bg-primary/10 text-primary items-center justify-center shrink-0">
              <EnvelopeSimple size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-label-md text-on-surface font-semibold">Cover Letter</p>
              <p className="text-caption text-on-surface-variant">
                {coverLetter?.status === "completed"
                  ? `Generated ${coverLetter.created_at ? new Date(coverLetter.created_at).toLocaleDateString() : ""}`
                  : coverLetter?.status === "pending"
                  ? "Generating…"
                  : coverLetter?.status === "failed"
                  ? "Generation failed — try again"
                  : "Not generated yet"}
              </p>
            </div>
            {coverLetter?.status === "completed" && coverLetter.cover_letter_id ? (
              <button
                onClick={() => router.push(`/cover-letters/${coverLetter.cover_letter_id}`)}
                className="shrink-0 flex items-center justify-center gap-xs px-sm py-xs rounded-lg text-label-sm text-primary border border-primary/30 hover:bg-primary/5 transition-all"
              >
                <FolderOpen size={14} />
                <span className="sm:hidden">Open</span>
                <span className="hidden sm:inline">Open Letter</span>
              </button>
            ) : (
              <button
                onClick={handleGenerateCoverLetter}
                disabled={isGeneratingLetter || !masterResume || coverLetter?.status === "pending"}
                className="shrink-0 flex items-center justify-center gap-xs px-sm py-xs rounded-lg text-label-sm text-primary border border-primary/30 hover:bg-primary/5 transition-all disabled:opacity-50"
              >
                <Sparkle size={14} className={isGeneratingLetter || coverLetter?.status === "pending" ? "animate-pulse" : ""} />
                {isGeneratingLetter || coverLetter?.status === "pending" ? "Generating…" : "Generate"}
              </button>
            )}
          </div>
          {letterError && <p className="text-caption text-error">{letterError}</p>}
        </Card>

        {/* Raw JD text preview — full width */}
        <Card className="col-span-2 lg:col-span-4">
          <h2 className="text-headline-md text-on-surface mb-sm sm:mb-md font-semibold">
            Job Description
          </h2>
          <pre className="text-body-sm text-on-surface-variant whitespace-pre-wrap font-sans leading-relaxed max-h-64 overflow-y-auto">
            {jd?.raw_text ?? "Loading…"}
          </pre>
        </Card>
      </div>

    </div>
  );
}

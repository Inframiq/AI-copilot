"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { EnvelopeSimple, FilePdf, Sparkle, WarningCircle } from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import { getCareerProfile } from "@/lib/career-profile-client";
import { Card } from "@/components/ui/Card";
import { ConnectionErrorBanner } from "@/components/ui/ConnectionErrorBanner";
import type { CoverLetter, Resume, JobDescription } from "@career-copilot/types";

export default function CoverLettersPage() {
  const router = useRouter();
  const [jdId, setJdId] = useState("");
  // The resume to generate against is never a separate user choice — it's
  // fully derived from the selected JD (see the effect below), so there's
  // no way to pick a JD and a resume that don't actually belong together.
  const [resolvedResumeId, setResolvedResumeId] = useState<string | null>(null);
  const [resolvedReason, setResolvedReason] = useState<"tailored" | "master" | "none" | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lettersQuery = useQuery<CoverLetter[]>({
    queryKey: ["coverLetters"],
    queryFn: () => apiClient.getCoverLetters(),
  });
  const letters = lettersQuery.data ?? [];
  const resumesQuery = useQuery<Resume[]>({
    queryKey: ["resumes"],
    queryFn: () => apiClient.getResumes(),
  });
  const resumes = resumesQuery.data ?? [];
  const jdsQuery = useQuery<JobDescription[]>({
    queryKey: ["jds"],
    queryFn: () => apiClient.getJds(),
  });
  const jds = jdsQuery.data ?? [];

  const connectionError =
    lettersQuery.isError || resumesQuery.isError || jdsQuery.isError;
  const isRetrying =
    lettersQuery.isFetching || resumesQuery.isFetching || jdsQuery.isFetching;
  const retryAll = () => {
    lettersQuery.refetch();
    resumesQuery.refetch();
    jdsQuery.refetch();
  };
  const { data: careerProfile } = useQuery({
    queryKey: ["careerProfile"],
    queryFn: getCareerProfile,
  });

  // Resolve which resume this JD actually uses — same priority order the
  // JD detail page's own cover-letter button uses: the resume already
  // tailored/saved for this exact JD (JobDescription.tailored_resume_id,
  // via GET /jd/{id}/details), falling back to the user's linked master
  // resume, and surfaced as read-only info rather than a second dropdown —
  // a separate, unlinked Resume selector was pure human-error risk (nothing
  // stopped picking a JD and a resume that don't belong together).
  useEffect(() => {
    let cancelled = false;
    if (!jdId) {
      setResolvedResumeId(null);
      setResolvedReason(null);
      return;
    }
    (async () => {
      try {
        const details = await apiClient.getJdDetails(jdId);
        if (cancelled) return;
        if (details.resume_id) {
          setResolvedResumeId(details.resume_id);
          setResolvedReason("tailored");
          return;
        }
      } catch {
        // Fall through to the master-resume default below.
      }
      if (cancelled) return;
      if (careerProfile?.master_resume_id) {
        setResolvedResumeId(careerProfile.master_resume_id);
        setResolvedReason("master");
      } else {
        setResolvedResumeId(null);
        setResolvedReason("none");
      }
    })();
    return () => { cancelled = true; };
  }, [jdId, careerProfile?.master_resume_id]);

  const resolvedResumeTitle = resumes.find((r) => r.id === resolvedResumeId)?.title ?? null;

  async function handleGenerate() {
    if (!resolvedResumeId || !jdId) return;
    setIsGenerating(true);
    setError(null);
    try {
      const { cover_letter_id } = await apiClient.generateCoverLetter(resolvedResumeId, jdId, 50, undefined, undefined);
      router.push(`/cover-letters/${cover_letter_id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to generate cover letter");
      setIsGenerating(false);
    }
  }

  return (
    <div className="max-w-[1440px] mx-auto p-gutter pb-xxl flex flex-col gap-section">
      <ConnectionErrorBanner show={connectionError} onRetry={retryAll} isRetrying={isRetrying} />

      <section className="pb-md">
        <h1 className="text-headline-xl text-on-surface mb-xs font-bold" style={{ letterSpacing: "-0.02em" }}>
          Cover Letters
        </h1>
        <p className="text-body-lg text-on-surface-variant">
          Pick a job description — the resume it belongs to is used automatically.
        </p>
      </section>

      <Card className="flex flex-col gap-md">
        <h2 className="text-headline-md text-on-surface font-semibold">New Cover Letter</h2>
        <div className="flex flex-col gap-xs max-w-[28rem]">
          <label htmlFor="jd-select" className="text-label-sm text-on-surface-variant font-semibold">Job Description</label>
          <select
            id="jd-select"
            value={jdId}
            onChange={(e) => setJdId(e.target.value)}
            className="w-full px-sm py-xs rounded-lg text-body-sm bg-surface-container border border-outline-variant/30 text-on-surface cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">Select a job description…</option>
            {jds.map((jd) => (
              <option key={jd.id} value={jd.id}>{jd.title}</option>
            ))}
          </select>
        </div>

        {jdId && resolvedReason === "none" && (
          <p className="flex items-center gap-xs text-caption text-error">
            <WarningCircle size={14} />
            No resume is linked to this job description or your profile yet — save a tailored resume for
            this JD, or set a master resume in Profile, before generating a cover letter.
          </p>
        )}
        {jdId && resolvedResumeId && (
          <p className="flex items-center gap-xs text-caption text-on-surface-variant">
            <FilePdf size={14} className="text-primary/70" />
            Using <span className="font-semibold text-on-surface">{resolvedResumeTitle ?? "resume"}</span>
            {resolvedReason === "tailored" ? " — tailored for this job description." : " — your master resume."}
          </p>
        )}

        {error && <p className="text-caption text-error">{error}</p>}
        <button
          onClick={handleGenerate}
          disabled={!resolvedResumeId || !jdId || isGenerating}
          className="self-start flex items-center gap-xs px-lg py-sm rounded-xl text-label-md text-on-primary bg-primary shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Sparkle size={16} className={isGenerating ? "animate-pulse" : ""} />
          {isGenerating ? "Generating…" : "Generate Cover Letter"}
        </button>
      </Card>

      {letters.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-md py-xxl text-center">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            <EnvelopeSimple size={28} className="text-primary" />
          </div>
          <p className="text-body-md text-on-surface font-medium">No cover letters yet</p>
          <p className="text-body-sm text-on-surface-variant">Pick a job description above to generate your first one.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-md">
          {letters.map((letter) => (
            <button
              key={letter.id}
              onClick={() => router.push(`/cover-letters/${letter.id}`)}
              className="text-left p-md rounded-xl border border-outline-variant/20 hover:border-primary/40 hover:bg-surface-container transition-all"
            >
              <p className="text-label-md text-on-surface font-semibold">
                {letter.status === "pending" ? "Generating…" : letter.status === "failed" ? "Generation failed" : "Cover Letter"}
              </p>
              <p className="text-caption text-on-surface-variant mt-xs">
                {new Date(letter.created_at).toLocaleDateString()}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

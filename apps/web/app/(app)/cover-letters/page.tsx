"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { EnvelopeSimple, Sparkle } from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import { getCareerProfile } from "@/lib/career-profile-client";
import { Card } from "@/components/ui/Card";
import type { CoverLetter, Resume, JobDescription } from "@career-copilot/types";

export default function CoverLettersPage() {
  const router = useRouter();
  const [resumeId, setResumeId] = useState("");
  const [resumeAutoFilledReason, setResumeAutoFilledReason] = useState<string | null>(null);
  const [jdId, setJdId] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: letters = [] } = useQuery<CoverLetter[]>({
    queryKey: ["coverLetters"],
    queryFn: () => apiClient.getCoverLetters(),
  });
  const { data: resumes = [] } = useQuery<Resume[]>({
    queryKey: ["resumes"],
    queryFn: () => apiClient.getResumes(),
  });
  const { data: jds = [] } = useQuery<JobDescription[]>({
    queryKey: ["jds"],
    queryFn: () => apiClient.getJds(),
  });
  const { data: careerProfile } = useQuery({
    queryKey: ["careerProfile"],
    queryFn: getCareerProfile,
  });

  // Selecting a JD is enough on its own to know which resume to use — the
  // separate Resume dropdown existing purely as a second required, unlinked
  // choice was real risk: nothing stopped picking a JD and a resume that
  // don't actually belong together. Auto-fill from the same resume this JD
  // was already tailored/saved for (JDDetails.resume_id), falling back to
  // the user's linked master resume when no tailoring has happened for this
  // JD yet — same priority order the JD detail page's own cover-letter
  // button already uses. Still just a default: the dropdown stays enabled
  // for the real case of wanting a different resume for this letter.
  async function handleJdChange(newJdId: string) {
    setJdId(newJdId);
    setResumeAutoFilledReason(null);
    if (!newJdId) return;
    try {
      const details = await apiClient.getJdDetails(newJdId);
      if (details.resume_id) {
        setResumeId(details.resume_id);
        setResumeAutoFilledReason("Auto-selected: the resume tailored for this job description.");
        return;
      }
    } catch {
      // Fall through to the master-resume default below.
    }
    if (careerProfile?.master_resume_id) {
      setResumeId(careerProfile.master_resume_id);
      setResumeAutoFilledReason("Auto-selected: your master resume (no tailored resume saved for this JD yet).");
    }
  }

  async function handleGenerate() {
    if (!resumeId || !jdId) return;
    setIsGenerating(true);
    setError(null);
    try {
      const { cover_letter_id } = await apiClient.generateCoverLetter(resumeId, jdId, 50, undefined, undefined);
      router.push(`/cover-letters/${cover_letter_id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to generate cover letter");
      setIsGenerating(false);
    }
  }

  return (
    <div className="max-w-[1440px] mx-auto p-gutter pb-xxl flex flex-col gap-xl">
      <section className="pb-md">
        <h1 className="text-headline-xl text-on-surface mb-xs font-bold" style={{ letterSpacing: "-0.02em" }}>
          Cover Letters
        </h1>
        <p className="text-body-lg text-on-surface-variant">
          Generate a cover letter from any resume and job description, edit it, and export it as a PDF.
        </p>
      </section>

      <Card className="flex flex-col gap-md">
        <h2 className="text-headline-md text-on-surface font-semibold">New Cover Letter</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-md">
          <div className="flex flex-col gap-xs">
            <label htmlFor="jd-select" className="text-label-sm text-on-surface-variant font-semibold">Job Description</label>
            <select
              id="jd-select"
              value={jdId}
              onChange={(e) => handleJdChange(e.target.value)}
              className="w-full px-sm py-xs rounded-lg text-body-sm bg-surface-container border border-outline-variant/30 text-on-surface cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">Select a job description…</option>
              {jds.map((jd) => (
                <option key={jd.id} value={jd.id}>{jd.title}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-xs">
            <label htmlFor="resume-select" className="text-label-sm text-on-surface-variant font-semibold">Resume</label>
            <select
              id="resume-select"
              value={resumeId}
              onChange={(e) => { setResumeId(e.target.value); setResumeAutoFilledReason(null); }}
              className="w-full px-sm py-xs rounded-lg text-body-sm bg-surface-container border border-outline-variant/30 text-on-surface cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">Select a resume…</option>
              {resumes.map((r) => (
                <option key={r.id} value={r.id}>{r.title}</option>
              ))}
            </select>
            {resumeAutoFilledReason && (
              <p className="text-caption text-primary/80">{resumeAutoFilledReason}</p>
            )}
          </div>
        </div>
        {error && <p className="text-caption text-error">{error}</p>}
        <button
          onClick={handleGenerate}
          disabled={!resumeId || !jdId || isGenerating}
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
          <p className="text-body-sm text-on-surface-variant">Pick a resume and job description above to generate your first one.</p>
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

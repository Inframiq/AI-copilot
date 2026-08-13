"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { EnvelopeSimple, Sparkle } from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import { Card } from "@/components/ui/Card";
import type { CoverLetter, Resume, JobDescription } from "@career-copilot/types";

export default function CoverLettersPage() {
  const router = useRouter();
  const [resumeId, setResumeId] = useState("");
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
            <label htmlFor="resume-select" className="text-label-sm text-on-surface-variant font-semibold">Resume</label>
            <select
              id="resume-select"
              value={resumeId}
              onChange={(e) => setResumeId(e.target.value)}
              className="w-full px-sm py-xs rounded-lg text-body-sm bg-surface-container border border-outline-variant/30 text-on-surface cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">Select a resume…</option>
              {resumes.map((r) => (
                <option key={r.id} value={r.id}>{r.title}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-xs">
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
        </div>
        {error && <p className="text-caption text-error">{error}</p>}
        <button
          onClick={handleGenerate}
          disabled={!resumeId || !jdId || isGenerating}
          className="self-start flex items-center gap-xs px-lg py-sm rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useTailoringStore } from "@/stores/tailoring-store";
import { useResumeStore } from "@/stores/resume-store";
import { Card } from "@/components/ui/Card";
import type { JobDescription } from "@career-copilot/types";

export default function JDIndexPage() {
  const router = useRouter();
  const [jdText, setJdText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setJd = useTailoringStore((s) => s.setJd);
  const runTailoring = useTailoringStore((s) => s.runTailoring);
  const atsScore = useTailoringStore((s) => s.atsScore);
  const matchedSkills = useTailoringStore((s) => s.matchedSkills);
  const missingSkills = useTailoringStore((s) => s.missingSkills);
  const resumeId = useResumeStore((s) => s.resumeId);

  const { data: jds = [] } = useQuery<JobDescription[]>({
    queryKey: ["jds"],
    queryFn: () => apiClient.getJds(),
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!jdText.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const firstLine = jdText.trim().split("\n")[0].slice(0, 120) || "Untitled JD";
      const jd = await apiClient.createJd({ title: firstLine, raw_text: jdText });
      setJd(jd.id, jd.raw_text);
      if (resumeId) {
        await runTailoring(resumeId);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-[1440px] mx-auto p-gutter pb-xxl flex flex-col gap-xl">
      {/* Page Header */}
      <section className="pt-xl pb-md">
        <h1 className="text-headline-xl text-on-surface mb-xs">JD Analyzer</h1>
        <p className="text-body-lg text-on-surface-variant">
          Paste a job description to analyze skills and tailor your resume.
        </p>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-gutter">
        {/* Input Panel */}
        <Card className="lg:col-span-2 flex flex-col gap-md">
          <h2 className="text-headline-md text-on-surface">Paste Job Description</h2>
          <form onSubmit={handleSubmit} className="flex flex-col gap-md flex-1">
            <textarea
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              placeholder="Paste the full job description here…"
              className="flex-1 min-h-[280px] w-full resize-none rounded-xl border border-outline-variant bg-surface-container-low px-md py-md text-body-md text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary transition-colors"
            />
            {error && (
              <p className="text-body-sm text-error">{error}</p>
            )}
            <button
              type="submit"
              disabled={isSubmitting || !jdText.trim()}
              className="w-full py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
            >
              {isSubmitting ? "Analyzing…" : "Save & Analyze"}
            </button>
          </form>
        </Card>

        {/* ATS Results Panel */}
        {atsScore !== null && (
          <Card className="flex flex-col gap-md">
            <h2 className="text-headline-md text-on-surface">ATS Results</h2>
            <div className="flex items-center justify-center py-md">
              <span className="text-headline-xl text-primary font-bold">{atsScore}%</span>
            </div>
            {matchedSkills.length > 0 && (
              <div>
                <p className="text-label-md text-on-surface-variant uppercase tracking-wider mb-sm">
                  Matched Skills
                </p>
                <div className="flex flex-wrap gap-xs">
                  {matchedSkills.map((skill) => (
                    <span
                      key={skill}
                      className="px-sm py-xs bg-secondary-container text-on-secondary-container text-label-sm rounded-md"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {missingSkills.length > 0 && (
              <div>
                <p className="text-label-md text-on-surface-variant uppercase tracking-wider mb-sm">
                  Missing Skills
                </p>
                <div className="flex flex-wrap gap-xs">
                  {missingSkills.map((skill) => (
                    <span
                      key={skill}
                      className="px-sm py-xs bg-error-container text-on-error-container text-label-sm rounded-md"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* Previous JDs */}
      {jds.length > 0 && (
        <section className="flex flex-col gap-md">
          <h2 className="text-headline-md text-on-surface">Previous Job Descriptions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">
            {jds.map((jd) => (
              <button
                key={jd.id}
                onClick={() => router.push(`/jd/${jd.id}`)}
                className="text-left px-md py-md rounded-xl border border-outline-variant hover:border-primary/40 hover:bg-surface-container-low transition-colors"
              >
                <p className="text-label-md text-on-surface truncate">{jd.title}</p>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

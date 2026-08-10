"use client";
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { Card } from "@/components/ui/Card";
import { useTailoringStore } from "@/stores/tailoring-store";
import type { JobDescription, Resume } from "@career-copilot/types";
import { CheckCircle, ArrowLeft, Sparkle, ArrowCounterClockwise } from "@phosphor-icons/react";

export default function JDPage({
  params,
}: {
  params: Promise<{ jdId: string }>;
}) {
  const { jdId } = use(params);
  const router = useRouter();
  const [tailoringResumeId, setTailoringResumeId] = useState<string | null>(null);
  const [tailorError, setTailorError] = useState<string | null>(null);

  const setJd = useTailoringStore((s) => s.setJd);
  const runTailoring = useTailoringStore((s) => s.runTailoring);

  const { data: jd } = useQuery<JobDescription>({
    queryKey: ["jd", jdId],
    queryFn: () => apiClient.getJd(jdId),
  });

  const { data: resumes = [] } = useQuery<Resume[]>({
    queryKey: ["resumes"],
    queryFn: () => apiClient.getResumes(),
  });

  async function handleTailor(resume: Resume) {
    if (!jd) return;
    setTailoringResumeId(resume.id);
    setTailorError(null);
    setJd(jdId, jd.raw_text);
    await runTailoring(resume.id);
    const err = useTailoringStore.getState().error;
    if (err) {
      setTailorError(err);
      setTailoringResumeId(null);
      return;
    }
    router.push(`/studio/${resume.id}`);
  }

  return (
    <div className="max-w-[1440px] mx-auto p-gutter pb-xxl flex flex-col gap-xl">
      {/* Page Header */}
      <section className="pt-xl pb-md flex flex-col md:flex-row md:items-end justify-between gap-md">
        <div>
          <h1 className="text-headline-xl text-on-surface mb-xs font-bold" style={{ letterSpacing: "-0.02em" }}>
            JD Analysis
          </h1>
          <p className="text-body-lg text-on-surface-variant">
            {jd?.title ?? "Loading…"}
          </p>
        </div>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-sm text-label-md text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <ArrowLeft size={16} />
          Back
        </button>
      </section>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-gutter">
        {/* Parsed Skills — spans 2 cols */}
        <Card className="lg:col-span-2 flex flex-col gap-md">
          <h2 className="text-headline-md text-on-surface flex items-center gap-sm font-semibold">
            Skills from JD
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

        {/* Re-run Resume Builder panel */}
        <Card className="lg:col-span-2 flex flex-col gap-md">
          <div>
            <h2 className="text-headline-md text-on-surface font-semibold">Re-run Resume Builder</h2>
            <p className="text-caption text-on-surface-variant mt-xs">
              Pick a resume — AI will tailor it to this job description and open it in the studio.
            </p>
          </div>

          {resumes.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">No resumes yet. Create one first.</p>
          ) : (
            <div className="flex flex-col gap-sm flex-1">
              {resumes.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-sm px-md py-sm rounded-xl border border-outline-variant/20 hover:border-primary/30 hover:bg-surface-container transition-all"
                >
                  <p className="text-label-sm text-on-surface flex-1 truncate">{r.title}</p>
                  <button
                    onClick={() => handleTailor(r)}
                    disabled={tailoringResumeId !== null}
                    className="flex items-center gap-xs px-md py-xs rounded-lg text-label-sm text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-sm hover:shadow-md hover:scale-[0.97] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100 shrink-0"
                  >
                    {tailoringResumeId === r.id ? (
                      <>
                        <ArrowCounterClockwise size={13} className="animate-spin" />
                        Tailoring…
                      </>
                    ) : (
                      <>
                        <Sparkle size={13} />
                        Tailor &amp; Open
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}

          {tailorError && <p className="text-caption text-error">{tailorError}</p>}

          <button
            onClick={() => router.push("/interview")}
            className="w-full py-sm rounded-xl text-label-md text-on-surface-variant border border-outline-variant/30 hover:bg-surface-container transition-colors mt-auto"
          >
            Go to Interview Center
          </button>
        </Card>

        {/* Raw JD text preview — full width */}
        <Card className="lg:col-span-4">
          <h2 className="text-headline-md text-on-surface mb-md font-semibold">
            Job Description
          </h2>
          <pre className="text-body-sm text-on-surface-variant whitespace-pre-wrap font-sans leading-relaxed max-h-64 overflow-y-auto">
            {jd?.raw_text ?? "Loading…"}
          </pre>
        </Card>
      </div>

      {/* Full-screen tailoring overlay */}
      {tailoringResumeId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-md">
          <div className="flex flex-col items-center gap-md text-center px-lg">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-4 border-primary/20" />
              <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Sparkle size={22} weight="fill" className="text-primary" />
              </div>
            </div>
            <div>
              <p className="text-headline-md text-on-surface font-bold">Tailoring your resume…</p>
              <p className="text-body-sm text-on-surface-variant mt-xs">
                Matching your bullets to this job description — just a moment.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

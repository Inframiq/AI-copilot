"use client";
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { Card } from "@/components/ui/Card";
import { useTailoringStore } from "@/stores/tailoring-store";
import { getCareerProfile, type CareerProfile } from "@/lib/career-profile-client";
import type { JobDescription, Resume } from "@career-copilot/types";
import { CheckCircle, ArrowLeft, Sparkle, ArrowCounterClockwise, FolderOpen } from "@phosphor-icons/react";

export default function JDPage({
  params,
}: {
  params: Promise<{ jdId: string }>;
}) {
  const { jdId } = use(params);
  const router = useRouter();
  const [isTailoring, setIsTailoring] = useState(false);
  const [tailorError, setTailorError] = useState<string | null>(null);

  const setJd = useTailoringStore((s) => s.setJd);
  const runTailoring = useTailoringStore((s) => s.runTailoring);

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

  // Only show the master resume; fall back to first resume if no profile set
  const masterResume = resumes.find((r) => r.id === careerProfile?.master_resume_id)
    ?? resumes[0]
    ?? null;

  async function handleTailor() {
    if (!jd || !masterResume) return;
    setIsTailoring(true);
    setTailorError(null);
    setJd(jdId, jd.raw_text);
    await runTailoring(masterResume.id);
    const err = useTailoringStore.getState().error;
    if (err) {
      setTailorError(err);
      setIsTailoring(false);
      return;
    }
    router.push(`/studio/${masterResume.id}`);
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
            <h2 className="text-headline-md text-on-surface font-semibold">Resume Builder</h2>
            <p className="text-caption text-on-surface-variant mt-xs">
              Tailor your resume to this job description, or open it as-is in the studio.
            </p>
          </div>

          {!masterResume ? (
            <p className="text-body-sm text-on-surface-variant">No resume found. Create one first.</p>
          ) : (
            <div className="flex flex-col gap-sm flex-1">
              {/* Resume row */}
              <div className="px-md py-sm rounded-xl border border-outline-variant/20 bg-surface-container/40">
                <p className="text-label-md text-on-surface font-semibold truncate">{masterResume.title}</p>
                <p className="text-caption text-on-surface-variant mt-xs">
                  Updated {new Date(masterResume.updated_at).toLocaleDateString()}
                </p>
              </div>

              {/* Two action buttons */}
              <div className="flex gap-sm mt-xs">
                <button
                  onClick={handleTailor}
                  disabled={isTailoring}
                  className="flex-1 flex items-center justify-center gap-xs py-sm rounded-xl text-label-sm text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-md hover:shadow-lg hover:scale-[0.98] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
                >
                  {isTailoring ? (
                    <>
                      <ArrowCounterClockwise size={14} className="animate-spin" />
                      Tailoring…
                    </>
                  ) : (
                    <>
                      <Sparkle size={14} />
                      Tailor
                    </>
                  )}
                </button>
                <button
                  onClick={() => router.push(`/studio/${masterResume.id}`)}
                  disabled={isTailoring}
                  className="flex-1 flex items-center justify-center gap-xs py-sm rounded-xl text-label-sm text-on-surface border border-outline-variant/40 hover:bg-surface-container hover:border-primary/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <FolderOpen size={14} />
                  Open
                </button>
              </div>
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
      {isTailoring && (
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

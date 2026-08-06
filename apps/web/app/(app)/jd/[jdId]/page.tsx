"use client";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { Card } from "@/components/ui/Card";
import type { JobDescription } from "@career-copilot/types";
import { CheckCircle, XCircle, ArrowLeft } from "@phosphor-icons/react";

export default function JDPage({
  params,
}: {
  params: Promise<{ jdId: string }>;
}) {
  const { jdId } = use(params);
  const router = useRouter();

  const { data: jd } = useQuery<JobDescription>({
    queryKey: ["jd", jdId],
    queryFn: async () => {
      const jds = await apiClient.getJds();
      const found = jds.find((j) => j.id === jdId);
      if (!found) throw new Error("JD not found");
      return found;
    },
  });

  const { data: resumes = [] } = useQuery({
    queryKey: ["resumes"],
    queryFn: () => apiClient.getResumes(),
  });

  return (
    <div className="max-w-[1440px] mx-auto p-gutter pb-xxl flex flex-col gap-xl">
      {/* Page Header */}
      <section className="pt-xl pb-md flex flex-col md:flex-row md:items-end justify-between gap-md">
        <div>
          <h1 className="text-headline-xl text-on-surface mb-xs">
            JD Analysis
          </h1>
          <p className="text-body-lg text-on-surface-variant">
            {jd?.title ?? "Loading…"}
          </p>
        </div>
        <button
          onClick={() => router.push("/dashboard")}
          className="flex items-center gap-sm text-label-md text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <ArrowLeft size={16} />
          Back to Dashboard
        </button>
      </section>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-gutter">
        {/* Parsed Skills — spans 2 cols */}
        <Card className="lg:col-span-2 flex flex-col gap-md">
          <h2 className="text-headline-md text-on-surface flex items-center gap-sm">
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

        {/* Tailor a Resume panel */}
        <Card className="lg:col-span-2 flex flex-col gap-md">
          <h2 className="text-headline-md text-on-surface">Tailor a Resume</h2>
          {resumes.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">
              No resumes yet. Create one first.
            </p>
          ) : (
            <div className="flex flex-col gap-sm flex-1">
              {resumes.map((r) => (
                <button
                  key={r.id}
                  onClick={() => router.push(`/studio/${r.id}?jdId=${jdId}`)}
                  className="w-full text-left px-md py-md rounded-xl border border-outline-variant hover:border-primary/40 hover:bg-surface-container-low transition-colors"
                >
                  <p className="text-label-md text-on-surface">{r.title}</p>
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => router.push("/interview")}
            className="w-full py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200 mt-auto"
          >
            Go to Interview Center
          </button>
        </Card>

        {/* Raw JD text preview — full width */}
        <Card className="lg:col-span-4">
          <h2 className="text-headline-md text-on-surface mb-md">
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

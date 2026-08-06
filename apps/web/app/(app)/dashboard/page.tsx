"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  FileDashed,
  Brain,
  Heartbeat,
  Briefcase,
} from "@phosphor-icons/react";
import { Card } from "@/components/ui/Card";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { apiClient } from "@/lib/api-client";
import type { Resume } from "@career-copilot/types";

export default function DashboardPage() {
  const router = useRouter();
  const [jdText, setJdText] = useState("");

  const { data: resumes = [] } = useQuery<Resume[]>({
    queryKey: ["resumes"],
    queryFn: () => apiClient.getResumes(),
  });

  const topAtsScore = 78; // placeholder until ATS scoring is wired to resumes

  async function handleStartTailoring() {
    if (!jdText.trim()) return;
    const jd = await apiClient.createJd({ title: "Untitled JD", raw_text: jdText });
    router.push(`/jd/${jd.id}`);
  }

  async function createNewResume() {
    const resume = await apiClient.createResume({
      title: "Untitled Resume",
      content: {
        contact: { name: "", email: "" },
        experience: [],
        education: [],
        skills: [],
      },
    });
    router.push(`/studio/${resume.id}`);
  }

  const metrics = [
    {
      label: "Profile Health",
      value: "92",
      badge: "Excellent",
      icon: Heartbeat,
      barWidth: "92%",
    },
    {
      label: "Active Applications",
      value: "14",
      badge: "+2 this week",
      icon: Briefcase,
      barWidth: null,
    },
    {
      label: "Interview Readiness",
      value: "78%",
      badge: "Needs prep",
      icon: Brain,
      barWidth: null,
    },
    {
      label: "Tailored Resumes",
      value: String(resumes.length),
      badge: "Versions saved",
      icon: FileDashed,
      barWidth: null,
    },
  ];

  return (
    <div className="max-w-[1440px] w-full mx-auto p-gutter pb-xxl flex flex-col gap-xl">
      {/* Hero Greeting */}
      <section className="pt-xl pb-md">
        <h1 className="text-headline-xl text-on-surface mb-sm">
          Welcome back!
        </h1>
        <p className="text-body-lg text-on-surface-variant">
          Your career trajectory is looking strong. Here&apos;s a snapshot of your progress.
        </p>
      </section>

      {/* JD Input CTA */}
      <Card className="flex flex-col gap-md">
        <p className="text-label-md text-on-surface-variant uppercase tracking-wider">
          Start Tailoring
        </p>
        <textarea
          value={jdText}
          onChange={(e) => setJdText(e.target.value)}
          placeholder="Paste the job description here…"
          rows={5}
          className="w-full px-md py-md rounded-lg border border-outline-variant bg-surface text-on-surface text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
        />
        <div className="flex gap-md flex-wrap">
          <button
            onClick={handleStartTailoring}
            disabled={!jdText.trim()}
            className="px-xl py-md rounded-lg text-label-md text-on-primary bg-gradient-to-b from-primary-container to-primary shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Analyze JD
          </button>
          <button
            onClick={createNewResume}
            className="px-xl py-md rounded-lg text-label-md text-on-surface-variant border border-outline-variant hover:bg-surface-container-low transition-colors"
          >
            New Resume
          </button>
        </div>
      </Card>

      {/* Key Metrics Bento Grid */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-gutter">
        {metrics.map(({ label, value, badge, icon: Icon, barWidth }) => (
          <Card
            key={label}
            className="flex flex-col justify-between h-32 relative overflow-hidden"
          >
            <div className="flex justify-between items-start">
              <span className="text-label-md text-on-surface-variant">
                {label}
              </span>
              <div className="w-8 h-8 rounded-full bg-secondary-container/50 flex items-center justify-center">
                <Icon size={20} weight="fill" className="text-primary" />
              </div>
            </div>
            <div className="flex items-baseline gap-sm">
              <span className="text-headline-xl text-on-surface">{value}</span>
              <span className="text-label-sm text-success-accent">{badge}</span>
            </div>
            {barWidth && (
              <div className="absolute bottom-0 left-0 w-full h-1 bg-surface-variant">
                <div
                  className="h-full bg-primary rounded-r-full"
                  style={{ width: barWidth }}
                />
              </div>
            )}
          </Card>
        ))}
      </section>

      {/* Score Ring + Recent Resumes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-gutter">
        {/* ATS Score Ring */}
        <Card className="flex flex-col items-center justify-center gap-md py-xl">
          <ScoreRing score={topAtsScore} size={160} />
          <p className="text-headline-md text-on-surface text-center">
            Best ATS Score
          </p>
          <p className="text-body-sm text-on-surface-variant text-center">
            Across your tailored resumes
          </p>
        </Card>

        {/* Recent Resumes */}
        <Card className="flex flex-col gap-md">
          <p className="text-label-md text-on-surface-variant uppercase tracking-wider">
            Recent Resumes
          </p>
          {resumes.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-xl text-center">
              <p className="text-body-md text-on-surface-variant mb-md">
                No resumes yet.
              </p>
              <button
                onClick={createNewResume}
                className="px-lg py-md rounded-lg text-label-md text-on-primary bg-primary hover:opacity-90 transition-opacity"
              >
                Create your first resume
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-sm overflow-y-auto max-h-64">
              {resumes.slice(0, 5).map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between p-md rounded-xl border border-outline-variant/20 hover:bg-surface-container-low cursor-pointer transition-colors"
                  onClick={() => router.push(`/studio/${r.id}`)}
                >
                  <div className="flex flex-col">
                    <span className="text-label-md text-on-surface">
                      {r.title}
                    </span>
                    <span className="text-caption text-on-surface-variant">
                      {r.template_id} &bull;{" "}
                      {new Date(r.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                  <span className="text-body-sm text-on-surface-variant">
                    &rsaquo;
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

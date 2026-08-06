"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  FileDashed,
  Brain,
  Heartbeat,
  Briefcase,
} from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import { useTailoringStore } from "@/stores/tailoring-store";
import type { Resume, JobDescription } from "@career-copilot/types";

function computeProfileHealth(resume: Resume | undefined): { score: number; label: string } {
  if (!resume) return { score: 0, label: "Needs work" };
  const c = resume.content as {
    contact?: { name?: string; email?: string; phone?: string; location?: string; linkedin?: string; github?: string };
    summary?: string;
    experience?: unknown[];
    education?: unknown[];
    skills?: unknown[];
  } | null;
  if (!c) return { score: 0, label: "Needs work" };
  const contact = c.contact ?? {};
  let filled = 0;
  if (contact.name) filled++;
  if (contact.email) filled++;
  if (contact.phone) filled++;
  if (contact.location) filled++;
  if (contact.linkedin) filled++;
  if (contact.github) filled++;
  if (c.summary) filled++;
  if (Array.isArray(c.experience) && c.experience.length > 0) filled++;
  if (Array.isArray(c.education) && c.education.length > 0) filled++;
  if (Array.isArray(c.skills) && c.skills.length >= 5) filled++;
  const score = Math.round((filled / 10) * 100);
  const label = score >= 80 ? "Excellent" : score >= 50 ? "Good" : "Needs work";
  return { score, label };
}

export default function DashboardPage() {
  const router = useRouter();
  const sessionId = useTailoringStore((s) => s.sessionId);
  const [createError, setCreateError] = useState<string | null>(null);

  const { data: resumes = [] } = useQuery<Resume[]>({
    queryKey: ["resumes"],
    queryFn: () => apiClient.getResumes(),
    staleTime: 2 * 60 * 1000,
  });

  const { data: jds = [] } = useQuery<JobDescription[]>({
    queryKey: ["jds"],
    queryFn: () => apiClient.getJds(),
    staleTime: 2 * 60 * 1000,
  });

  async function createNewResume() {
    setCreateError(null);
    try {
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
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create resume. Check your connection.");
    }
  }

  // Best resume = one with highest ats_score, fallback to first
  const bestResume = resumes.length > 0
    ? resumes.reduce((best, r) => ((r.ats_score ?? 0) > (best.ats_score ?? 0) ? r : best), resumes[0])
    : undefined;

  const { score: profileScore, label: profileLabel } = computeProfileHealth(bestResume);

  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const jdsThisWeek = jds.filter((jd) => new Date(jd.created_at).getTime() >= oneWeekAgo).length;

  const interviewReadiness = sessionId !== null ? 65 : 0;
  const interviewLabel = sessionId !== null ? "Ready" : "Needs prep";

  const metrics: Array<{
    label: string;
    value: string;
    badge: string;
    icon: typeof Heartbeat;
    barWidth: string | null;
    action?: () => void;
  }> = [
    {
      label: "Profile Health",
      value: resumes.length > 0 ? `${profileScore}` : "—",
      badge: resumes.length > 0 ? profileLabel : "Add resume",
      icon: Heartbeat,
      barWidth: resumes.length > 0 ? `${profileScore}%` : null,
      action: resumes.length === 0 ? createNewResume : undefined,
    },
    {
      label: "Active Applications",
      value: String(jds.length),
      badge: jdsThisWeek > 0 ? `+${jdsThisWeek} this week` : "Track your JDs",
      icon: Briefcase,
      barWidth: null,
      action: () => router.push("/jd"),
    },
    {
      label: "Interview Readiness",
      value: `${interviewReadiness}%`,
      badge: interviewLabel,
      icon: Brain,
      barWidth: `${interviewReadiness}%`,
      action: () => router.push("/interview"),
    },
    {
      label: "Tailored Resumes",
      value: String(resumes.length),
      badge: "Versions saved",
      icon: FileDashed,
      barWidth: null,
      action: resumes.length > 0 ? () => router.push("/studio") : createNewResume,
    },
  ];

  return (
    <div className="max-w-[1440px] w-full mx-auto p-gutter pb-xxl flex flex-col gap-xl">
      {/* Hero Greeting */}
      <section className="pt-xl pb-md">
        <h1 className="text-headline-xl text-on-surface mb-sm font-bold" style={{ letterSpacing: "-0.02em" }}>
          Welcome back!
        </h1>
        <p className="text-body-lg text-on-surface-variant">
          Your career trajectory is looking strong. Here&apos;s a snapshot of your progress.
        </p>
      </section>

      {/* Key Metrics Bento Grid */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-gutter">
        {metrics.map(({ label, value, badge, icon: Icon, barWidth, action }) => {
          const Card = action ? "button" : "div";
          return (
            <Card
              key={label}
              onClick={action}
              className={`bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 hover:shadow-xl hover:shadow-on-surface/10 transition-shadow relative overflow-hidden flex flex-col justify-between h-32 w-full text-left${action ? " cursor-pointer active:scale-[0.98]" : ""}`}
            >
              <div className="flex justify-between items-start">
                <span className="text-label-md text-on-surface-variant">{label}</span>
                <div className="w-8 h-8 rounded-full bg-secondary-container/50 flex items-center justify-center">
                  <Icon size={20} weight="fill" className="text-primary" />
                </div>
              </div>
              <div className="flex items-baseline gap-sm">
                <span className="text-headline-xl text-on-surface">{value}</span>
                {badge && (
                  <span className="text-label-sm text-success-accent">{badge}</span>
                )}
              </div>
              {barWidth && (
                <div className="absolute bottom-0 left-0 w-full h-1 bg-surface-variant">
                  <div className="h-full bg-primary rounded-r-full transition-all duration-700" style={{ width: barWidth }} />
                </div>
              )}
            </Card>
          );
        })}
      </section>

      {/* Quick Actions + Recent Resumes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-gutter">
        {/* Quick Actions */}
        <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 flex flex-col gap-md">
          <h2 className="text-headline-md text-on-surface font-semibold">Quick Actions</h2>
          {createError && (
            <p className="text-body-sm text-error">{createError}</p>
          )}
          <div className="flex flex-col gap-sm">
            <button
              onClick={() => router.push("/jd")}
              className="flex items-center gap-md p-md rounded-xl border border-outline-variant/20 hover:bg-surface-container hover:shadow-md transition-all text-left"
            >
              <div className="w-10 h-10 bg-surface-container rounded-lg text-primary flex items-center justify-center shrink-0">
                <FileDashed size={20} />
              </div>
              <div>
                <p className="text-label-md text-on-surface">Analyze a Job Description</p>
                <p className="text-caption text-on-surface-variant">Get your match score instantly</p>
              </div>
            </button>
            <button
              onClick={createNewResume}
              className="flex items-center gap-md p-md rounded-xl border border-outline-variant/20 hover:bg-surface-container hover:shadow-md transition-all text-left"
            >
              <div className="w-10 h-10 bg-surface-container rounded-lg text-primary flex items-center justify-center shrink-0">
                <Brain size={20} />
              </div>
              <div>
                <p className="text-label-md text-on-surface">Create New Resume</p>
                <p className="text-caption text-on-surface-variant">Build with AI assistance</p>
              </div>
            </button>
            <button
              onClick={() => router.push("/interview")}
              className="flex items-center gap-md p-md rounded-xl border border-outline-variant/20 hover:bg-surface-container hover:shadow-md transition-all text-left"
            >
              <div className="w-10 h-10 bg-surface-container rounded-lg text-primary flex items-center justify-center shrink-0">
                <Briefcase size={20} />
              </div>
              <div>
                <p className="text-label-md text-on-surface">Practice Interviews</p>
                <p className="text-caption text-on-surface-variant">AI-powered mock sessions</p>
              </div>
            </button>
          </div>
        </div>

        {/* Recent Resumes */}
        <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 flex flex-col gap-md">
          <div className="flex items-center justify-between">
            <h2 className="text-headline-md text-on-surface font-semibold">Recent Resumes</h2>
            <button
              onClick={createNewResume}
              className="text-label-sm text-primary hover:text-primary-container transition-colors"
            >
              + New
            </button>
          </div>
          {resumes.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-xl text-center gap-md">
              <div className="w-12 h-12 rounded-full bg-surface-container-high flex items-center justify-center">
                <FileDashed size={24} className="text-on-surface-variant" />
              </div>
              <div>
                <p className="text-body-md text-on-surface font-medium mb-xs">No resumes yet</p>
                <p className="text-body-sm text-on-surface-variant">Create your first tailored resume</p>
              </div>
              <button
                onClick={createNewResume}
                className="px-lg py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200"
              >
                Create Resume
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-sm overflow-y-auto">
              {resumes.slice(0, 5).map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between p-md rounded-xl border border-outline-variant/20 hover:bg-surface-container hover:shadow-sm cursor-pointer transition-all"
                  onClick={() => router.push(`/studio/${r.id}`)}
                >
                  <div className="flex items-center gap-md">
                    <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center">
                      <FileDashed size={16} className="text-primary" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-label-md text-on-surface">{r.title}</span>
                      <span className="text-caption text-on-surface-variant">
                        {new Date(r.updated_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  {r.ats_score != null && (
                    <span className="text-label-sm text-primary font-semibold shrink-0">{r.ats_score}%</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  FileDashed,
  Brain,
  Heartbeat,
  Briefcase,
  BookOpen,
  Trash,
  CheckCircle,
  Circle,
  X,
} from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import { useTailoringStore } from "@/stores/tailoring-store";
import type { Resume, JobDescription, LearningItem, PrepQuestionOut } from "@career-copilot/types";

const STATUS_CYCLE: Record<LearningItem["status"], LearningItem["status"]> = {
  not_started: "learning",
  learning: "done",
  done: "not_started",
};

const STATUS_LABEL: Record<LearningItem["status"], string> = {
  not_started: "Not started",
  learning: "Learning",
  done: "Done",
};

const STATUS_COLOR: Record<LearningItem["status"], string> = {
  not_started: "bg-surface-container text-on-surface-variant",
  learning: "bg-secondary-container text-on-secondary-container",
  done: "bg-success-accent/15 text-success-accent",
};

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

const ONBOARDING_DISMISSED_KEY = "career-copilot-onboarding-dismissed";

export default function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const sessionId = useTailoringStore((s) => s.sessionId);
  const [createError, setCreateError] = useState<string | null>(null);
  const [onboardingDismissed, setOnboardingDismissed] = useState(true); // default hidden until we know client-side state

  useEffect(() => {
    setOnboardingDismissed(localStorage.getItem(ONBOARDING_DISMISSED_KEY) === "1");
  }, []);

  function dismissOnboarding() {
    localStorage.setItem(ONBOARDING_DISMISSED_KEY, "1");
    setOnboardingDismissed(true);
  }

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

  const { data: learningItems = [] } = useQuery<LearningItem[]>({
    queryKey: ["learning"],
    queryFn: () => apiClient.getLearningItems(),
    staleTime: 2 * 60 * 1000,
  });

  const { data: questions = [] } = useQuery<PrepQuestionOut[]>({
    queryKey: ["questions", sessionId],
    queryFn: () => apiClient.getQuestions(sessionId!),
    enabled: sessionId !== null,
    staleTime: 2 * 60 * 1000,
  });

  async function handleCycleStatus(item: LearningItem) {
    const nextStatus = STATUS_CYCLE[item.status];
    queryClient.setQueryData<LearningItem[]>(["learning"], (list) =>
      list?.map((li) => (li.id === item.id ? { ...li, status: nextStatus } : li))
    );
    try {
      await apiClient.updateLearningItemStatus(item.id, nextStatus);
    } catch (err) {
      console.error("Failed to update learning item:", err);
      queryClient.setQueryData<LearningItem[]>(["learning"], (list) =>
        list?.map((li) => (li.id === item.id ? { ...li, status: item.status } : li))
      );
    }
  }

  async function handleRemoveLearningItem(id: string) {
    const previous = learningItems;
    queryClient.setQueryData<LearningItem[]>(["learning"], (list) =>
      list?.filter((li) => li.id !== id)
    );
    try {
      await apiClient.deleteLearningItem(id);
    } catch (err) {
      console.error("Failed to remove learning item:", err);
      queryClient.setQueryData<LearningItem[]>(["learning"], previous);
    }
  }

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

  // Same formula as Interview Center's Overall Readiness gauge — each
  // milestone is worth 20 pts, practiced-question ratio fills the last 40.
  const answeredCount = questions.filter((q) => q.practiced_at).length;
  const practiceScore = questions.length > 0 ? (answeredCount / questions.length) * 40 : 0;
  const interviewReadiness = Math.round(
    (resumes.length > 0 ? 20 : 0) +
    (jds.length > 0 ? 20 : 0) +
    (sessionId ? 20 : 0) +
    practiceScore
  );
  const interviewLabel =
    interviewReadiness >= 80 ? "Ready" : interviewReadiness > 0 ? "In progress" : "Needs prep";

  const onboardingSteps = [
    { label: "Build your first resume", done: resumes.length > 0, action: () => (resumes.length > 0 ? router.push("/studio") : createNewResume()) },
    { label: "Analyze a job description", done: jds.length > 0, action: () => router.push("/jd") },
    { label: "Practice for an interview", done: sessionId !== null, action: () => router.push("/interview") },
  ];
  const showOnboarding = !onboardingDismissed && onboardingSteps.some((s) => !s.done);

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

      {/* Onboarding Nudge */}
      {showOnboarding && (
        <section className="bg-primary-container/20 border border-primary/20 rounded-2xl p-lg flex flex-col gap-md relative">
          <button
            onClick={dismissOnboarding}
            aria-label="Dismiss"
            className="absolute top-md right-md w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high/50 transition-colors"
          >
            <X size={16} />
          </button>
          <div>
            <h2 className="text-headline-md text-on-surface font-semibold">Get started</h2>
            <p className="text-body-sm text-on-surface-variant mt-xs">
              A few quick steps to get the most out of Career Copilot.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-sm">
            {onboardingSteps.map(({ label, done, action }) => (
              <button
                key={label}
                onClick={action}
                className={`flex-1 flex items-center gap-sm px-md py-md rounded-xl border text-left transition-all ${
                  done
                    ? "bg-surface-container-lowest border-outline-variant/20 text-on-surface-variant"
                    : "bg-surface-container-lowest border-primary/30 hover:border-primary/60 hover:shadow-md text-on-surface"
                }`}
              >
                {done ? (
                  <CheckCircle size={20} weight="fill" className="text-success-accent shrink-0" />
                ) : (
                  <Circle size={20} className="text-primary shrink-0" />
                )}
                <span className={`text-label-md ${done ? "line-through" : ""}`}>{label}</span>
              </button>
            ))}
          </div>
        </section>
      )}

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

      {/* Learning Path */}
      {learningItems.length > 0 && (
        <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 flex flex-col gap-md">
          <div className="flex items-center gap-sm">
            <BookOpen size={20} className="text-primary" />
            <h2 className="text-headline-md text-on-surface font-semibold">Learning Path</h2>
            <span className="text-caption text-on-surface-variant">
              {learningItems.filter((li) => li.status === "done").length}/{learningItems.length} done
            </span>
          </div>
          <p className="text-body-sm text-on-surface-variant -mt-sm">
            Skills flagged from JD Analyzer. Click a status to cycle it.
          </p>
          <div className="flex flex-col gap-sm">
            {learningItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-md p-md rounded-xl border border-outline-variant/20"
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-label-md text-on-surface truncate">{item.skill}</span>
                  {item.source_jd_title && (
                    <span className="text-caption text-on-surface-variant truncate">
                      From: {item.source_jd_title}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-sm shrink-0">
                  <button
                    onClick={() => handleCycleStatus(item)}
                    className={`px-sm py-xs rounded-full text-caption font-semibold hover:opacity-80 transition-opacity ${STATUS_COLOR[item.status]}`}
                  >
                    {STATUS_LABEL[item.status]}
                  </button>
                  <button
                    onClick={() => handleRemoveLearningItem(item.id)}
                    aria-label="Remove from learning path"
                    className="w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-error-container/50 hover:text-error transition-colors"
                  >
                    <Trash size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

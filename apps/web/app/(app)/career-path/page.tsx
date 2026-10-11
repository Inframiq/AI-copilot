"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Path,
  CheckCircle,
  Circle,
  ArrowRight,
  TrendUp,
  BookOpen,
  Plus,
  Check,
} from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import { getCareerProfile, type CareerProfile } from "@/lib/career-profile-client";
import { UserMilestones } from "@/components/career/UserMilestones";
import { TargetRole } from "@/components/career/TargetRole";
import type { Resume, JobDescription, LearningItem, PrepQuestionWithJdOut } from "@career-copilot/types";

const TAILOR_GOAL = 3;
const APPLY_GOAL = 10;

const LEARN_LABEL: Record<LearningItem["status"], string> = {
  not_started: "Not started",
  learning: "Learning",
  done: "Done",
};
const LEARN_NEXT: Record<LearningItem["status"], LearningItem["status"]> = {
  not_started: "learning",
  learning: "done",
  done: "not_started",
};
const LEARN_COLOR: Record<LearningItem["status"], string> = {
  not_started: "bg-surface-container text-on-surface-variant",
  learning: "bg-secondary-container text-on-secondary-container",
  done: "bg-success-accent/15 text-success-accent",
};

type Status = "done" | "active" | "upcoming";

export default function CareerPathPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Everything on this page is the user's real data — it used to read the
  // in-memory tailoring/résumé stores, which are empty after a reload, and
  // padded the rest with made-up numbers and a fixed reading list.
  const { data: resumes = [] } = useQuery<Resume[]>({ queryKey: ["resumes"], queryFn: () => apiClient.getResumes() });
  const { data: jds = [] } = useQuery<JobDescription[]>({ queryKey: ["jds"], queryFn: () => apiClient.getJds() });
  const { data: profile } = useQuery<CareerProfile | null>({
    queryKey: ["careerProfile"],
    queryFn: getCareerProfile,
    staleTime: 2 * 60 * 1000,
  });
  const { data: myQuestions = [] } = useQuery<PrepQuestionWithJdOut[]>({
    queryKey: ["myQuestions"],
    queryFn: () => apiClient.getMyQuestions(),
  });
  const { data: latestSession } = useQuery({
    queryKey: ["latestSession"],
    queryFn: () => apiClient.getLatestSession(),
  });
  const { data: learning = [] } = useQuery<LearningItem[]>({
    queryKey: ["learning"],
    queryFn: () => apiClient.getLearningItems(),
    staleTime: 2 * 60 * 1000,
  });

  // Current role: the job marked current in My Profile, else the first.
  const exp = profile?.experience ?? [];
  const currentJob = exp.find((e) => e.current && e.title.trim()) ?? exp.find((e) => e.title.trim());
  const currentRole = currentJob?.title.trim() ?? null;
  const currentCompany = currentJob?.company.trim() || null;

  const tailored = jds.filter((j) => j.ats_score != null).length;
  const applied = jds.filter((j) => j.status !== "not_applied").length;
  const practiced = myQuestions.filter((q) => q.practiced_at).length;

  // Built-in milestones, worked out from activity. The first one not done
  // is the one in progress.
  const builtIn: { title: string; description: string; done: boolean; href: string }[] = [
    {
      title: "Build your résumé",
      description: resumes.length > 0 ? `${resumes.length} résumé${resumes.length === 1 ? "" : "s"} so far.` : "Create a polished résumé in Resume Builder.",
      done: resumes.length > 0,
      href: "/studio",
    },
    {
      title: `Tailor it to ${TAILOR_GOAL} target roles`,
      description: `Tailor your résumé to a job in JD Analyzer — ${Math.min(tailored, TAILOR_GOAL)} of ${TAILOR_GOAL} so far.`,
      done: tailored >= TAILOR_GOAL,
      href: "/jd",
    },
    {
      title: "Prepare for interviews",
      description:
        practiced > 0
          ? `${practiced} interview question${practiced === 1 ? "" : "s"} practiced.`
          : myQuestions.length > 0
            ? "Practice the interview questions made for your jobs in Interview Center."
            : "Save a tailored résumé to a job to get its interview questions, then practice them.",
      done: practiced > 0,
      href: "/interview",
    },
    {
      title: `Apply to ${APPLY_GOAL} roles`,
      description: `Mark a job as applied in JD Analyzer as you go — ${Math.min(applied, APPLY_GOAL)} of ${APPLY_GOAL} so far.`,
      done: applied >= APPLY_GOAL,
      href: "/jd",
    },
    {
      title: "Negotiate & accept an offer",
      description: jds.some((j) => j.status === "offer")
        ? "You have an offer — negotiate, then mark it accepted in JD Analyzer."
        : "Mark a job as offered, then accepted, in JD Analyzer.",
      done: jds.some((j) => j.status === "accepted"),
      href: "/jd",
    },
  ];
  const firstOpen = builtIn.findIndex((m) => !m.done);
  const milestones = builtIn.map((m, i) => ({
    ...m,
    status: (m.done ? "done" : i === firstOpen ? "active" : "upcoming") as Status,
  }));
  const doneCount = milestones.filter((m) => m.done).length;

  // Skills gap: the latest tailoring run's own matched/missing skills, and
  // the job it was for.
  const gapJd = latestSession?.jd_id ? jds.find((j) => j.id === latestSession.jd_id) : undefined;
  const missing = latestSession?.missing_skills ?? [];
  const matched = latestSession?.matched_skills ?? [];
  const onList = new Set(learning.map((l) => l.skill.trim().toLowerCase()));
  const [adding, setAdding] = useState<string | null>(null);
  const [gapError, setGapError] = useState<string | null>(null);

  async function addToLearning(skill: string) {
    setAdding(skill);
    setGapError(null);
    try {
      const item = await apiClient.addLearningItem({ skill, source_jd_title: gapJd?.title });
      queryClient.setQueryData<LearningItem[]>(["learning"], (list) => [item, ...(list ?? [])]);
    } catch {
      setGapError(`Couldn't add ${skill} to your learning list. Try again.`);
    } finally {
      setAdding(null);
    }
  }

  async function cycleLearning(item: LearningItem) {
    const next = LEARN_NEXT[item.status];
    const set = (status: LearningItem["status"]) =>
      queryClient.setQueryData<LearningItem[]>(["learning"], (list) =>
        list?.map((li) => (li.id === item.id ? { ...li, status } : li)),
      );
    set(next);
    try {
      await apiClient.updateLearningItemStatus(item.id, next);
    } catch {
      set(item.status);
    }
  }

  return (
    <div className="w-full min-w-0 max-w-[1440px] mx-auto p-gutter pb-xxl flex flex-col gap-section">
      {/* Header */}
      <section className="pt-lg pb-md">
        <h1 className="text-headline-xl text-on-surface font-bold mb-sm" style={{ letterSpacing: "-0.02em" }}>
          Career Path
        </h1>
        <p className="text-body-lg text-on-surface-variant">
          Map your journey from where you are to where you want to be.
        </p>
      </section>

      {/* Progress summary */}
      <div className="flex flex-wrap items-center gap-x-lg gap-y-xs text-label-sm text-on-surface-variant">
        {[
          [resumes.length, resumes.length === 1 ? "résumé" : "résumés"],
          [jds.length, jds.length === 1 ? "JD analyzed" : "JDs analyzed"],
          [applied, "applied"],
          [practiced, practiced === 1 ? "question practiced" : "questions practiced"],
        ].map(([n, label]) => (
          <span key={String(label)} className="flex items-center gap-xs">
            <span className="text-primary font-bold">{n}</span> {label}
          </span>
        ))}
      </div>

      {/* Role Transition Banner — current → target side by side at every
          width (smaller type on a phone), with the milestone count. */}
      <div className="bg-primary rounded-2xl p-md sm:p-lg flex items-center gap-sm sm:gap-lg relative overflow-hidden shadow-lg shadow-primary/20">
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary-container/30 rounded-full blur-3xl pointer-events-none" style={{ marginRight: "-4rem", marginTop: "-4rem" }} />
        <div className="flex-1 min-w-0 flex flex-col gap-xs relative z-10">
          <span className="text-caption text-on-primary/60 uppercase tracking-wider">Current Role</span>
          {currentRole ? (
            <p className="text-body-lg sm:text-headline-md text-on-primary font-bold border-b border-on-primary/30 pb-xs truncate">
              {currentRole}
              {currentCompany && (
                <span className="hidden sm:inline font-normal text-on-primary/70"> · {currentCompany}</span>
              )}
            </p>
          ) : (
            <Link
              href="/profile"
              className="text-body-lg sm:text-headline-md text-on-primary/80 font-bold border-b border-on-primary/30 pb-xs truncate hover:text-on-primary"
            >
              Add in My Profile →
            </Link>
          )}
        </div>
        <ArrowRight weight="bold" className="w-5 h-5 sm:w-8 sm:h-8 mt-md sm:mt-0 text-on-primary/60 shrink-0 relative z-10" />
        <label className="flex-1 min-w-0 flex flex-col gap-xs relative z-10">
          <span className="text-caption text-on-primary/60 uppercase tracking-wider">Target Role</span>
          <TargetRole inputClassName="w-full min-w-0 text-body-lg sm:text-headline-md text-on-primary font-bold bg-transparent border-b border-on-primary/30 focus:border-on-primary outline-none pb-xs placeholder:text-on-primary/40" />
        </label>
        <div
          className="relative z-10 flex flex-col items-center gap-xs shrink-0"
          aria-label={`${doneCount} of ${milestones.length} milestones done`}
        >
          <div className="w-11 h-11 sm:w-16 sm:h-16 rounded-full bg-on-primary/10 flex items-center justify-center">
            <span className="text-label-md sm:text-headline-md text-on-primary font-bold">
              {doneCount}/{milestones.length}
            </span>
          </div>
          <span className="text-caption sm:text-label-sm text-on-primary/80 whitespace-nowrap">
            <span className="sm:hidden">done</span>
            <span className="hidden sm:inline">milestones done</span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-gutter">
        {/* Milestones */}
        <div className="lg:col-span-2 bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 flex flex-col gap-md">
          <h2 className="text-headline-md text-on-surface font-semibold flex items-center gap-sm">
            <Path size={22} className="text-primary" />
            Roadmap Milestones
          </h2>
          <div className="flex flex-col gap-sm relative">
            {/* Vertical line */}
            <div className="absolute left-[19px] top-8 bottom-8 w-px bg-outline-variant/40" />
            {milestones.map((m) => (
              <div key={m.title} className="flex items-start gap-md pl-xs">
                <div className={`mt-xs shrink-0 ${m.status === "done" ? "text-success-accent" : m.status === "active" ? "text-primary" : "text-outline-variant"}`}>
                  {m.status === "done" ? (
                    <CheckCircle size={24} weight="fill" />
                  ) : m.status === "active" ? (
                    <div className="w-6 h-6 rounded-full border-2 border-primary flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    </div>
                  ) : (
                    <Circle size={24} />
                  )}
                </div>
                <div className={`flex-1 min-w-0 p-md rounded-xl border transition-all ${
                  m.status === "active"
                    ? "bg-secondary-container/30 border-primary/20"
                    : m.status === "done"
                    ? "bg-surface-container border-outline-variant/10 opacity-70"
                    : "bg-surface-container-lowest border-outline-variant/20"
                }`}>
                  <div className="flex items-center justify-between gap-sm mb-xs">
                    <p className={`text-label-md font-semibold ${m.status === "done" ? "text-on-surface-variant line-through" : "text-on-surface"}`}>
                      {m.title}
                    </p>
                    {m.status === "active" && (
                      <span className="shrink-0 text-caption text-primary bg-primary/10 px-sm py-xs pill rounded-full">In Progress</span>
                    )}
                    {m.status === "done" && (
                      <span className="shrink-0 text-caption text-success-accent bg-success-accent/10 px-sm py-xs pill rounded-full">Done</span>
                    )}
                  </div>
                  <p className="text-body-sm text-on-surface-variant">{m.description}</p>
                  {m.status === "active" && (
                    <Link href={m.href} className="inline-flex items-center gap-xs mt-sm py-xs -my-xs text-label-sm text-primary hover:underline">
                      Go there <ArrowRight size={12} />
                    </Link>
                  )}
                </div>
              </div>
            ))}
            {/* The user's own milestones, then "Add milestone". */}
            <UserMilestones />
          </div>
        </div>

        {/* Right Column */}
        <div className="flex flex-col gap-md min-w-0">
          {/* Skills Gap */}
          <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
            <h2 className="text-headline-md text-on-surface font-semibold flex items-center gap-sm mb-xs">
              <TrendUp size={22} className="text-primary" />
              Skills Gap
            </h2>
            {latestSession?.session_id && (missing.length > 0 || matched.length > 0) ? (
              <div className="flex flex-col gap-md">
                <p className="text-caption text-on-surface-variant">
                  From your latest tailoring
                  {gapJd ? (
                    <>
                      {" "}for{" "}
                      <Link href={`/jd/${gapJd.id}`} className="text-primary hover:underline">{gapJd.title}</Link>
                    </>
                  ) : null}
                  .
                </p>
                {missing.length > 0 && (
                  <div>
                    <p className="text-label-sm text-on-surface mb-xs">To learn</p>
                    <ul className="flex flex-col gap-xs">
                      {missing.slice(0, 6).map((skill) => {
                        const listed = onList.has(skill.trim().toLowerCase());
                        return (
                          <li key={skill} className="flex items-center justify-between gap-sm">
                            <span className="text-body-sm text-on-surface truncate">{skill}</span>
                            {listed ? (
                              <span className="shrink-0 inline-flex items-center gap-xs text-caption text-success-accent">
                                <Check size={12} weight="bold" /> On your list
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => addToLearning(skill)}
                                disabled={adding === skill}
                                aria-label={`Add ${skill} to your learning list`}
                                className="shrink-0 inline-flex items-center gap-xs min-h-7 px-xs -mr-xs text-label-sm text-primary hover:underline disabled:opacity-50"
                              >
                                <Plus size={12} weight="bold" /> Learn
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {matched.length > 0 && (
                  <div>
                    <p className="text-label-sm text-on-surface mb-xs">You already have</p>
                    <div className="flex flex-wrap gap-xs">
                      {matched.slice(0, 8).map((skill) => (
                        <span key={skill} className="px-sm py-xs rounded-md bg-surface-container-high text-caption text-on-surface-variant">
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {gapError && <p role="alert" className="text-caption text-error">{gapError}</p>}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-lg text-center gap-sm">
                <p className="text-body-sm text-on-surface-variant">
                  Tailor your résumé to a job to see which of its skills you have and which to learn.
                </p>
                <button
                  onClick={() => router.push("/jd")}
                  className="py-sm -my-sm text-label-sm text-primary hover:text-primary-container transition-colors"
                >
                  Go to JD Analyzer →
                </button>
              </div>
            )}
          </div>

          {/* Learning list — the same one as the dashboard's Learning Path. */}
          <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
            <div className="flex items-center justify-between gap-sm mb-md">
              <h2 className="text-headline-md text-on-surface font-semibold flex items-center gap-sm">
                <BookOpen size={22} className="text-primary" />
                Learning list
              </h2>
              {learning.length > 0 && (
                <span className="text-caption text-on-surface-variant">
                  {learning.filter((l) => l.status === "done").length}/{learning.length} done
                </span>
              )}
            </div>
            {learning.length === 0 ? (
              <p className="text-body-sm text-on-surface-variant">
                Skills you choose to learn show up here — add them from the skills gap above.
              </p>
            ) : (
              <ul className="flex flex-col gap-sm">
                {learning.slice(0, 8).map((item) => (
                  <li key={item.id} className="flex items-center gap-sm">
                    <div className="flex-1 min-w-0">
                      <p className={`text-label-md truncate ${item.status === "done" ? "text-on-surface-variant line-through" : "text-on-surface"}`}>
                        {item.skill}
                      </p>
                      {item.source_jd_title && (
                        <p className="text-caption text-on-surface-variant truncate">from {item.source_jd_title}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => cycleLearning(item)}
                      aria-label={`${item.skill}: ${LEARN_LABEL[item.status]} — change status`}
                      className={`shrink-0 px-sm py-xs rounded-full text-caption font-semibold hover:opacity-80 transition-opacity ${LEARN_COLOR[item.status]}`}
                    >
                      {LEARN_LABEL[item.status]}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* CTA */}
          <button
            onClick={() => router.push("/jd")}
            className="w-full py-md rounded-xl text-label-md text-on-primary bg-primary shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200"
          >
            Analyze a Job Description
          </button>
        </div>
      </div>
    </div>
  );
}

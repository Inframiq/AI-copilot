"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  ThumbsUp,
  TrendDown,
  Play,
  MicrophoneStage,
  Check,
} from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import { ConnectionErrorBanner } from "@/components/ui/ConnectionErrorBanner";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { useTailoringStore } from "@/stores/tailoring-store";
import type { PrepQuestionWithJdOut, Resume, JobDescription } from "@career-copilot/types";

const TABS = ["Technical", "Behavioral", "HR & Culture"] as const;
type Tab = (typeof TABS)[number];

function classifyTopic(topic: string): Tab {
  const l = topic.toLowerCase();
  if (
    /algorithm|system design|coding|technical|data structure|database|api|architecture|programming|react|typescript|javascript|python|frontend|backend|cloud|devops|fullstack|node|sql|css|html|git|docker|kubernetes|aws|java|c\+\+|golang|linux|rest|graphql|ci\/cd|framework|testing|security|infrastructure/.test(l)
  )
    return "Technical";
  if (/behavioral|teamwork|leadership|conflict|communication|collaboration|management|culture|situational|career/.test(l)) return "Behavioral";
  return "HR & Culture";
}

export default function InterviewIndexPage() {
  const router    = useRouter();
  const queryClient = useQueryClient();
  const storeSessionId = useTailoringStore((s) => s.sessionId);
  const storeMatchedSkills = useTailoringStore((s) => s.matchedSkills);
  const storeMissingSkills = useTailoringStore((s) => s.missingSkills);

  const [activeTab, setActiveTab]     = useState<Tab>("Technical");
  // null = "All Job Descriptions" — narrows the list (and its tab counts/
  // progress/strengths) to one JD's questions when set.
  const [selectedJdId, setSelectedJdId] = useState<string | null>(null);

  // The in-memory tailoring store only knows about a session if tailoring
  // just ran in this browser tab — a reload, direct nav, or switching JDs
  // wipes it. Fall back to the user's actual most recent completed session
  // (real, JD-specific) for the "Next Mock Interview" card and the
  // Strengths/Needs Focus skill fallback below.
  const { data: latestSession } = useQuery({
    queryKey: ["latestSession"],
    queryFn: () => apiClient.getLatestSession(),
    enabled: storeSessionId === null,
  });
  const sessionId = storeSessionId ?? latestSession?.session_id ?? null;
  const matchedSkills = storeSessionId ? storeMatchedSkills : latestSession?.matched_skills ?? storeMatchedSkills;
  const missingSkills = storeSessionId ? storeMissingSkills : latestSession?.missing_skills ?? storeMissingSkills;

  // Every question generated across every JD — one JD's worth at a time,
  // from its latest completed session — so the list below can be grouped
  // and filtered by JD instead of only ever showing the single most
  // recently active session.
  const myQuestionsQuery = useQuery<PrepQuestionWithJdOut[]>({
    queryKey: ["myQuestions"],
    queryFn: () => apiClient.getMyQuestions(),
  });
  const myQuestions = myQuestionsQuery.data ?? [];
  const isLoading = myQuestionsQuery.isLoading;
  const hasAnyQuestions = myQuestions.length > 0;

  const resumesQuery = useQuery<Resume[]>({
    queryKey: ["resumes"],
    queryFn:  () => apiClient.getResumes(),
  });
  const resumes = resumesQuery.data ?? [];
  const jdsQuery = useQuery<JobDescription[]>({
    queryKey: ["jds"],
    queryFn:  () => apiClient.getJds(),
  });
  const jds = jdsQuery.data ?? [];

  const connectionError =
    myQuestionsQuery.isError || resumesQuery.isError || jdsQuery.isError;
  const isRetrying =
    myQuestionsQuery.isFetching || resumesQuery.isFetching || jdsQuery.isFetching;
  const retryAll = () => {
    myQuestionsQuery.refetch();
    resumesQuery.refetch();
    jdsQuery.refetch();
  };

  // Distinct JDs present in myQuestions, for the filter dropdown —
  // deliberately not apiClient.getJds() directly, since that would offer
  // JDs with no generated questions at all as a filter option.
  const jdOptions = [...new Map(myQuestions.map((q) => [q.jd_id, q.jd_title])).entries()]
    .map(([jd_id, jd_title]) => ({ jd_id, jd_title }))
    .sort((a, b) => a.jd_title.localeCompare(b.jd_title));

  // The JD filter's scope — everything below the filter derives from this,
  // not myQuestions directly.
  const scopedQuestions = selectedJdId ? myQuestions.filter((q) => q.jd_id === selectedJdId) : myQuestions;

  // Practice progress — real, persisted server-side (PrepQuestion.practiced_at).
  // Built from the full (unfiltered) list so the readiness gauge and
  // "N practiced" count reflect all JDs regardless of the filter above.
  const answeredSet   = new Set(myQuestions.filter((q) => q.practiced_at).map((q) => q.id));
  const answeredCount = answeredSet.size;

  // Overall readiness (progressive — each milestone = +20 pts, practice fills last 40).
  // Interview readiness only starts once actual prep work exists — a JD
  // analyzed, questions generated (via JD tailoring or this tab), a practice
  // session started. Merely uploading a resume in My Profile does not count.
  const practiceScore  = myQuestions.length > 0 ? (answeredCount / myQuestions.length) * 40 : 0;
  const readinessScore = Math.round(
    (jds.length        > 0 ? 20 : 0) +
    (hasAnyQuestions       ? 20 : 0) +
    (sessionId             ? 20 : 0) +
    practiceScore,
  );

  // Per-tab question counts, scoped to the JD filter
  const tabCounts: Record<Tab, number> = {
    Technical:     scopedQuestions.filter((q) => classifyTopic(q.topic) === "Technical").length,
    Behavioral:    scopedQuestions.filter((q) => classifyTopic(q.topic) === "Behavioral").length,
    "HR & Culture": scopedQuestions.filter((q) => classifyTopic(q.topic) === "HR & Culture").length,
  };

  // Per-tab practice progress (for session mode progress bar)
  const tabProgress: Record<Tab, number> = {
    Technical:     tabCounts.Technical     > 0 ? Math.round((scopedQuestions.filter((q) => classifyTopic(q.topic) === "Technical"     && answeredSet.has(q.id)).length / tabCounts.Technical)     * 100) : 0,
    Behavioral:    tabCounts.Behavioral    > 0 ? Math.round((scopedQuestions.filter((q) => classifyTopic(q.topic) === "Behavioral"    && answeredSet.has(q.id)).length / tabCounts.Behavioral)    * 100) : 0,
    "HR & Culture": tabCounts["HR & Culture"] > 0 ? Math.round((scopedQuestions.filter((q) => classifyTopic(q.topic) === "HR & Culture" && answeredSet.has(q.id)).length / tabCounts["HR & Culture"]) * 100) : 0,
  };

  // Strengths / needs focus from real session topics, scoped to the JD filter
  const answeredTopics   = [...new Set(scopedQuestions.filter((q) => answeredSet.has(q.id)).map((q) => q.topic))];
  const unansweredTopics = [...new Set(scopedQuestions.filter((q) => !answeredSet.has(q.id)).map((q) => q.topic))];

  // Current tab's questions, grouped by JD name when no JD filter is
  // applied — this is the "categorize by JD" view. A filter picks one
  // group; groups collapse to a single unlabeled one when there's nothing
  // to distinguish.
  const tabQuestions = scopedQuestions.filter((q) => classifyTopic(q.topic) === activeTab);
  const tabGroups: { jdTitle: string | null; questions: PrepQuestionWithJdOut[] }[] = selectedJdId
    ? [{ jdTitle: null, questions: tabQuestions }]
    : Array.from(
        tabQuestions.reduce((acc, q) => {
          if (!acc.has(q.jd_title)) acc.set(q.jd_title, []);
          acc.get(q.jd_title)!.push(q);
          return acc;
        }, new Map<string, PrepQuestionWithJdOut[]>()),
      ).map(([jdTitle, qs]) => ({ jdTitle, questions: qs }));

  async function handleMarkAnswered(qId: string) {
    // Optimistic — flip it locally immediately, reconcile with the server's
    // actual practiced_at once the request resolves. Merge (not replace):
    // markQuestionPracticed's response has no jd_id/jd_title, so replacing
    // the whole item would drop it from its group.
    queryClient.setQueryData<PrepQuestionWithJdOut[]>(["myQuestions"], (list) =>
      list?.map((q) => (q.id === qId ? { ...q, practiced_at: new Date().toISOString() } : q))
    );
    try {
      const updated = await apiClient.markQuestionPracticed(qId);
      queryClient.setQueryData<PrepQuestionWithJdOut[]>(["myQuestions"], (list) =>
        list?.map((q) => (q.id === qId ? { ...q, ...updated } : q))
      );
    } catch (err) {
      console.error("Failed to mark question practiced:", err);
      queryClient.setQueryData<PrepQuestionWithJdOut[]>(["myQuestions"], (list) =>
        list?.map((q) => (q.id === qId ? { ...q, practiced_at: null } : q))
      );
    }
  }

  // Shared by the laptop's right rail and the phone's strip.
  const milestones = [
    { label: "Resume created", done: resumes.length > 0 },
    { label: "JD analyzed", done: jds.length > 0 },
    { label: "Session started", done: !!sessionId },
    { label: "Questions practiced", done: answeredCount > 0 },
  ];
  const strengths = (hasAnyQuestions && answeredTopics.length > 0 ? answeredTopics : matchedSkills).slice(0, 3);
  const focus = (hasAnyQuestions && unansweredTopics.length > 0 ? unansweredTopics : missingSkills).slice(0, 3);

  return (
    <div className="p-gutter md:p-xl max-w-[1440px] mx-auto w-full min-w-0 flex flex-col lg:flex-row gap-lg">

      {/* ── Left Column ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col gap-lg min-w-0">

        <ConnectionErrorBanner
          show={connectionError}
          onRetry={retryAll}
          isRetrying={isRetrying}
          message="Can't reach the server — your generated interview questions aren't loading. Your data is safe."
        />

        {/* Header */}
        <div className="pt-xs sm:pt-0">
          <h2 className="text-headline-xl text-on-surface font-bold" style={{ letterSpacing: "-0.02em" }}>
            Interview Center
          </h2>
          <p className="hidden sm:block text-body-md text-on-surface-variant mt-sm" style={{ maxWidth: "42rem" }}>
            Prepare, practice, and perfect your interview skills across technical, behavioral, and HR disciplines.
          </p>
        </div>

        {/* Phones: the laptop's right-hand rail, as a strip under the title —
            below the questions it was out of sight. */}
        <div className="lg:hidden grid grid-cols-2 gap-sm">
          <div className="bg-surface-container-lowest rounded-2xl p-md border border-outline-variant/20 shadow-lg shadow-on-surface/5 flex items-center gap-sm">
            <ReadinessGauge score={readinessScore} className="w-14 h-14 shrink-0" labelClassName="text-label-md" />
            <div className="min-w-0">
              <p className="text-label-md text-on-surface font-semibold flex items-center gap-xs">
                Readiness
                <InfoTooltip text="20% each for analyzing a JD, generating questions, and starting a practice session, plus up to 40% based on how many of your questions you've marked practiced." />
              </p>
              <p className="text-caption text-on-surface-variant">
                {milestones.filter((m) => m.done).length} of {milestones.length} steps
              </p>
            </div>
          </div>
          <NextMockCard
            sessionId={sessionId}
            ready={myQuestions.filter((q) => q.session_id === sessionId).length}
            practiced={answeredCount}
            onGo={() => (sessionId ? router.push(`/interview/${sessionId}`) : router.push("/jd"))}
            compact
          />
          {(strengths.length > 0 || focus.length > 0) && (
            <div className="col-span-2 flex flex-wrap items-center gap-xs text-caption">
              {strengths.map((t) => (
                <span key={`s-${t}`} className="px-sm py-0.5 bg-surface-container-high text-on-surface-variant rounded-md border border-outline-variant/30">
                  <ThumbsUp size={11} weight="fill" className="inline -mt-0.5 mr-1 text-success-accent" />{t}
                </span>
              ))}
              {focus.map((t) => (
                <span key={`f-${t}`} className="px-sm py-0.5 bg-error-container/50 text-error rounded-md border border-error/20">
                  <TrendDown size={11} weight="fill" className="inline -mt-0.5 mr-1" />{t}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Tab Navigation + JD filter */}
        <div className="flex items-center justify-between gap-md border-b border-outline-variant/30 flex-wrap">
          <div className="flex gap-md sm:gap-lg">
            {TABS.map((tab) => {
              const count = hasAnyQuestions && tabCounts[tab] > 0 ? ` (${tabCounts[tab]})` : "";
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`pb-sm text-label-md transition-all duration-200 whitespace-nowrap ${
                    activeTab === tab
                      ? "text-primary font-bold border-b-2 border-primary"
                      : "text-on-surface-variant hover:text-on-surface"
                  }`}
                >
                  {tab}{count}
                </button>
              );
            })}
          </div>

          {/* Filter by the JD these questions were generated for — only
              worth showing once there's more than one to choose between. */}
          {jdOptions.length > 1 && (
            <select
              value={selectedJdId ?? ""}
              onChange={(e) => setSelectedJdId(e.target.value || null)}
              className="mb-sm px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface text-label-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">All Job Descriptions</option>
              {jdOptions.map((o) => (
                <option key={o.jd_id} value={o.jd_id}>{o.jd_title}</option>
              ))}
            </select>
          )}
        </div>

        {/* Per-tab practice progress bar (only when there are real questions) */}
        {hasAnyQuestions && (
          <div className="flex items-center gap-md">
            <div className="flex-1 h-2 bg-surface-variant rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-700"
                style={{ width: `${tabProgress[activeTab]}%` }}
              />
            </div>
            <span className="text-label-sm text-on-surface-variant shrink-0">
              {tabProgress[activeTab]}% of {activeTab} practiced
            </span>
          </div>
        )}

        {/* Content: real questions (grouped by JD) OR topic cards */}
        {hasAnyQuestions ? (
          <div className="flex flex-col gap-md">
            {isLoading ? (
              <div className="flex items-center justify-center py-xl">
                <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
              </div>
            ) : tabQuestions.length > 0 ? (
              <>
                <p className="text-label-md text-on-surface-variant uppercase tracking-wider">
                  {tabQuestions.length} question{tabQuestions.length !== 1 ? "s" : ""} · {activeTab}
                </p>
                {tabGroups.map((group) => (
                  <div key={group.jdTitle ?? "__single"} className="flex flex-col gap-md">
                    {/* Group header — the "categorize by JD" view. Omitted
                        when a JD filter narrows to a single group already. */}
                    {group.jdTitle && (
                      <p className="text-label-sm text-primary font-bold pt-sm first:pt-0">
                        {group.jdTitle}
                      </p>
                    )}
                    {group.questions.map((q) => {
                      const isPracticed = answeredSet.has(q.id);
                      return (
                        <div
                          key={q.id}
                          className="bg-surface-container-lowest rounded-2xl p-md sm:p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 hover:shadow-xl transition-shadow flex flex-col"
                        >
                          <div className="flex justify-between items-start mb-sm sm:mb-md">
                            <div className={`w-9 h-9 sm:w-12 sm:h-12 rounded-lg flex items-center justify-center ${isPracticed ? "bg-success-accent/10 text-success-accent" : "bg-primary/10 text-primary"}`}>
                              <MicrophoneStage size={20} />
                            </div>
                            <span className="bg-surface-container text-caption text-primary px-sm py-xs pill rounded-full">
                              {q.topic}
                            </span>
                          </div>
                          <h3 className="text-headline-md text-on-surface mb-sm font-semibold">{q.question}</h3>
                          {q.answer_framework && (
                            <p className="text-body-sm text-on-surface-variant mb-sm">{q.answer_framework}</p>
                          )}
                          {q.basis && (
                            <p className="text-caption text-primary/80 mb-md flex items-start gap-xs">
                              <span className="shrink-0 font-semibold">
                                {q.source === "overlap" ? "From your resume:" : q.source === "gap" ? "Bridging a gap:" : "From the JD:"}
                              </span>
                              <span className="text-on-surface-variant">{q.basis}</span>
                            </p>
                          )}
                          <div className="flex items-center gap-sm mb-md sm:mb-lg">
                            <div className="flex-1 h-2 bg-surface-variant rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary rounded-full transition-all duration-500"
                                style={{ width: isPracticed ? "100%" : "0%" }}
                              />
                            </div>
                            <span className="text-label-sm text-on-surface-variant">
                              {isPracticed ? "Practiced ✓" : "Not started"}
                            </span>
                          </div>
                          <div className="flex gap-sm">
                            <button
                              onClick={() => router.push(`/interview/${q.session_id}?q=${q.id}`)}
                              className="flex-1 py-sm sm:py-md px-md bg-primary text-on-primary rounded-xl text-label-md shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200 flex justify-center items-center gap-sm"
                            >
                              <Play size={16} weight="fill" />
                              <span className="sm:hidden">Practice</span>
                              <span className="hidden sm:inline">Practice This Question</span>
                            </button>
                            {!isPracticed && (
                              <button
                                onClick={() => handleMarkAnswered(q.id)}
                                className="py-sm sm:py-md px-md rounded-xl border border-outline-variant/30 text-label-md text-on-surface hover:bg-surface-container transition-all flex items-center gap-sm"
                              >
                                <Check size={16} />
                                <span className="sm:hidden">Done</span>
                                <span className="hidden sm:inline">Mark as Practiced</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-xl gap-md text-center bg-surface-container-lowest rounded-2xl border border-outline-variant/20">
                <p className="text-body-md text-on-surface font-medium">No {activeTab} questions{selectedJdId ? " for this JD" : ""}</p>
                <p className="text-body-sm text-on-surface-variant">Your personalized questions focus on other areas.</p>
              </div>
            )}
          </div>
        ) : (
          /* No tailoring-generated questions yet. Interview questions are
             only ever produced by tailoring a resume against a JD — there
             is no resume-only or cross-user question list here, so a plain
             resume uploaded in My Profile shows nothing but this CTA. */
          <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-sm flex flex-col items-center justify-center gap-md py-xl text-center">
            <p className="text-body-md text-on-surface font-medium">No interview questions yet</p>
            <p className="text-body-sm text-on-surface-variant" style={{ maxWidth: "28rem" }}>
              Interview questions are generated when you tailor a resume to a
              specific job description. Analyze a JD and run tailoring to get
              questions built from your resume and that role.
            </p>
            <button
              onClick={() => router.push("/jd")}
              className="px-xl py-md rounded-xl text-label-md text-on-primary bg-primary shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200"
            >
              Go to JD Analyzer
            </button>
          </div>
        )}
      </div>

      {/* ── Right Column ──────────────────────────────────────────────────── */}
      <aside className="hidden lg:flex w-80 flex-col gap-md shrink-0">

        {/* Overall Readiness */}
        <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
          <h3 className="text-headline-md text-on-surface mb-lg font-semibold flex items-center gap-sm">
            Overall Readiness
            <InfoTooltip text="20% each for analyzing a JD, generating questions, and starting a practice session, plus up to 40% based on how many of your questions you've marked practiced." />
          </h3>

          {/* Circular gauge */}
          <ReadinessGauge score={readinessScore} className="w-32 h-32 mx-auto mb-lg" labelClassName="text-headline-lg" />

          {/* Milestone breakdown */}
          <div className="flex flex-col gap-xs mb-lg text-caption text-on-surface-variant">
            {milestones.map(({ label, done }) => (
              <div key={label} className="flex items-center gap-sm">
                <div className={`w-3 h-3 rounded-full flex items-center justify-center shrink-0 ${done ? "bg-primary" : "bg-surface-variant"}`}>
                  {done && <Check size={8} weight="bold" className="text-on-primary" />}
                </div>
                <span className={done ? "text-on-surface" : "text-on-surface-variant"}>{label}</span>
              </div>
            ))}
          </div>

          {hasAnyQuestions && (
            <p className="text-caption text-on-surface-variant text-center mb-md">
              {answeredCount} of {myQuestions.length} questions practiced
            </p>
          )}

          {/* Strengths */}
          <div className="space-y-md">
            <div>
              <h4 className="text-label-md text-on-surface mb-sm flex items-center gap-sm">
                <ThumbsUp size={18} weight="fill" className="text-success-accent" /> Strengths
                <InfoTooltip text="Topics from questions you've practiced, or skills your resume already matched in the JD — whichever you have." />
              </h4>
              <div className="flex flex-wrap gap-sm">
                {strengths.length > 0 ? (
                  strengths.map((t) => (
                    <span key={t} className="px-sm py-xs bg-surface-container-high text-on-surface-variant text-caption rounded-md border border-outline-variant/30">{t}</span>
                  ))
                ) : (
                  <span className="text-caption text-on-surface-variant italic">
                    {jds.length > 0 ? "Practice questions to reveal strengths" : "Analyze a JD to discover strengths"}
                  </span>
                )}
              </div>
            </div>

            {/* Needs Focus */}
            <div>
              <h4 className="text-label-md text-on-surface mb-sm flex items-center gap-sm">
                <TrendDown size={18} weight="fill" className="text-error" /> Needs Focus
                <InfoTooltip text="Topics from questions you haven't practiced yet, or skills the JD wanted that your resume was missing." />
              </h4>
              <div className="flex flex-wrap gap-sm">
                {focus.length > 0 ? (
                  focus.map((t) => (
                    <span key={t} className="px-sm py-xs bg-error-container/50 text-error text-caption rounded-md border border-error/20">{t}</span>
                  ))
                ) : (
                  <span className="text-caption text-on-surface-variant italic">
                    {jds.length > 0 ? "Start a session to identify gaps" : "Analyze a JD to find focus areas"}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <NextMockCard
          sessionId={sessionId}
          ready={myQuestions.filter((q) => q.session_id === sessionId).length}
          practiced={answeredCount}
          onGo={() => (sessionId ? router.push(`/interview/${sessionId}`) : router.push("/jd"))}
        />
      </aside>
    </div>
  );
}

function ReadinessGauge({
  score,
  className,
  labelClassName,
}: {
  score: number;
  className: string;
  labelClassName: string;
}) {
  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <svg className="w-full h-full" style={{ transform: "rotate(-90deg)" }} viewBox="0 0 36 36">
        <path
          className="text-surface-variant"
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none" stroke="currentColor" strokeWidth="3"
        />
        <path
          className="text-primary"
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none" stroke="currentColor"
          strokeDasharray={`${score}, 100`}
          strokeLinecap="round" strokeWidth="3"
          style={{ transition: "stroke-dasharray 1s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`${labelClassName} text-primary font-bold`}>{score}%</span>
      </div>
    </div>
  );
}

function NextMockCard({
  sessionId,
  ready,
  practiced,
  onGo,
  compact = false,
}: {
  sessionId: string | null;
  ready: number;
  practiced: number;
  onGo: () => void;
  compact?: boolean;
}) {
  return (
    <div className={`bg-primary text-on-primary rounded-2xl shadow-lg shadow-primary/10 relative overflow-hidden ${compact ? "p-md flex flex-col justify-between gap-xs" : "p-md"}`}>
      <div
        className="absolute top-0 right-0 w-32 h-32 bg-primary-container/50 rounded-full blur-2xl pointer-events-none"
        style={{ marginRight: "-2.5rem", marginTop: "-2.5rem" }}
      />
      <h4 className="text-label-md font-bold mb-xs relative z-10">{compact ? "Next mock" : "Next Mock Interview"}</h4>
      <p className={`relative z-10 opacity-90 ${compact ? "text-caption" : "text-body-sm mb-md"}`}>
        {sessionId
          ? compact
            ? `${ready} ready · ${practiced} done`
            : `${ready} questions ready · ${practiced} practiced`
          : compact
            ? "Analyze a JD first"
            : "Analyze a JD to generate personalized questions"}
      </p>
      <button
        onClick={onGo}
        className={`w-full bg-surface-container-lowest text-primary text-label-md rounded-xl shadow-lg shadow-on-surface/10 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200 relative z-10 ${compact ? "py-xs" : "py-md"}`}
      >
        {sessionId ? (compact ? "Join" : "Join Session") : compact ? "Go" : "Analyze a JD First"}
      </button>
    </div>
  );
}

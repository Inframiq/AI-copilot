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
import { useTailoringStore } from "@/stores/tailoring-store";
import type { PrepQuestionOut, Resume, JobDescription, SkillQuestionOut } from "@career-copilot/types";

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
  const sessionId = useTailoringStore((s) => s.sessionId);
  const matchedSkills = useTailoringStore((s) => s.matchedSkills);
  const missingSkills = useTailoringStore((s) => s.missingSkills);

  const [activeTab, setActiveTab]     = useState<Tab>("Technical");

  const { data: questions = [], isLoading } = useQuery<PrepQuestionOut[]>({
    queryKey: ["questions", sessionId],
    queryFn:  () => apiClient.getQuestions(sessionId!),
    enabled:  sessionId !== null,
  });
  const { data: resumes = [] } = useQuery<Resume[]>({
    queryKey: ["resumes"],
    queryFn:  () => apiClient.getResumes(),
  });
  const { data: jds = [] } = useQuery<JobDescription[]>({
    queryKey: ["jds"],
    queryFn:  () => apiClient.getJds(),
  });
  const { data: bankQuestions = [], isLoading: bankLoading } = useQuery<SkillQuestionOut[]>({
    queryKey: ["questionBank", activeTab],
    queryFn: () => apiClient.getQuestionBank(activeTab),
    // Mirrors the render gate below (`sessionId && questions.length > 0`):
    // fetch the shared bank whenever we'd actually render the browse UI,
    // including when a session exists but returned zero prep questions.
    // `!isLoading` avoids a throwaway fetch while session questions are
    // still in flight and `questions.length` is transiently 0.
    enabled: !sessionId || (!isLoading && questions.length === 0),
  });

  // Session-level progress — real, persisted server-side (PrepQuestion.practiced_at)
  const answeredSet   = new Set(questions.filter((q) => q.practiced_at).map((q) => q.id));
  const answeredCount = answeredSet.size;

  // Overall readiness (progressive — each milestone = +20 pts, practice fills last 40)
  const practiceScore  = questions.length > 0 ? (answeredCount / questions.length) * 40 : 0;
  const readinessScore = Math.round(
    (resumes.length > 0 ? 20 : 0) +
    (jds.length     > 0 ? 20 : 0) +
    (sessionId          ? 20 : 0) +
    practiceScore,
  );

  // Per-tab question counts (from real session)
  const tabCounts: Record<Tab, number> = {
    Technical:     sessionId ? questions.filter((q) => classifyTopic(q.topic) === "Technical").length     : 0,
    Behavioral:    sessionId ? questions.filter((q) => classifyTopic(q.topic) === "Behavioral").length    : 0,
    "HR & Culture": sessionId ? questions.filter((q) => classifyTopic(q.topic) === "HR & Culture").length : 0,
  };

  // Per-tab practice progress (for session mode progress bar)
  const tabProgress: Record<Tab, number> = {
    Technical:     tabCounts.Technical     > 0 ? Math.round((questions.filter((q) => classifyTopic(q.topic) === "Technical"     && answeredSet.has(q.id)).length / tabCounts.Technical)     * 100) : 0,
    Behavioral:    tabCounts.Behavioral    > 0 ? Math.round((questions.filter((q) => classifyTopic(q.topic) === "Behavioral"    && answeredSet.has(q.id)).length / tabCounts.Behavioral)    * 100) : 0,
    "HR & Culture": tabCounts["HR & Culture"] > 0 ? Math.round((questions.filter((q) => classifyTopic(q.topic) === "HR & Culture" && answeredSet.has(q.id)).length / tabCounts["HR & Culture"]) * 100) : 0,
  };

  // Strengths / needs focus from real session topics
  const answeredTopics   = sessionId ? [...new Set(questions.filter((q) => answeredSet.has(q.id)).map((q) => q.topic))]  : [];
  const unansweredTopics = sessionId ? [...new Set(questions.filter((q) => !answeredSet.has(q.id)).map((q) => q.topic))] : [];

  // Current tab's questions
  const tabQuestions = sessionId ? questions.filter((q) => classifyTopic(q.topic) === activeTab) : [];

  async function handleMarkAnswered(qId: string) {
    if (!sessionId) return;
    // Optimistic — flip it locally immediately, reconcile with the server's
    // actual practiced_at once the request resolves.
    queryClient.setQueryData<PrepQuestionOut[]>(["questions", sessionId], (list) =>
      list?.map((q) => (q.id === qId ? { ...q, practiced_at: new Date().toISOString() } : q))
    );
    try {
      const updated = await apiClient.markQuestionPracticed(qId);
      queryClient.setQueryData<PrepQuestionOut[]>(["questions", sessionId], (list) =>
        list?.map((q) => (q.id === qId ? updated : q))
      );
    } catch (err) {
      console.error("Failed to mark question practiced:", err);
      queryClient.setQueryData<PrepQuestionOut[]>(["questions", sessionId], (list) =>
        list?.map((q) => (q.id === qId ? { ...q, practiced_at: null } : q))
      );
    }
  }

  return (
    <div className="p-lg md:p-xl max-w-[1440px] mx-auto w-full flex flex-col lg:flex-row gap-lg">

      {/* ── Left Column ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col gap-lg min-w-0">

        {/* Header */}
        <div>
          <h2 className="text-headline-xl text-on-surface font-bold" style={{ letterSpacing: "-0.02em" }}>
            Interview Center
          </h2>
          <p className="text-body-md text-on-surface-variant mt-sm" style={{ maxWidth: "42rem" }}>
            Prepare, practice, and perfect your interview skills across technical, behavioral, and HR disciplines.
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-lg border-b border-outline-variant/30">
          {TABS.map((tab) => {
            const count = sessionId && tabCounts[tab] > 0 ? ` (${tabCounts[tab]})` : "";
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

        {/* Per-tab practice progress bar (only when session exists) */}
        {sessionId && questions.length > 0 && (
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

        {/* Content: session questions OR topic cards */}
        {sessionId && questions.length > 0 ? (
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
                {tabQuestions.map((q) => {
                  const isPracticed = answeredSet.has(q.id);
                  return (
                    <div
                      key={q.id}
                      className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 hover:shadow-xl transition-shadow flex flex-col"
                    >
                      <div className="flex justify-between items-start mb-md">
                        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${isPracticed ? "bg-success-accent/10 text-success-accent" : "bg-primary/10 text-primary"}`}>
                          <MicrophoneStage size={24} />
                        </div>
                        <span className="bg-surface-container text-caption text-primary px-sm py-xs rounded-full">
                          {q.topic}
                        </span>
                      </div>
                      <h3 className="text-headline-md text-on-surface mb-sm font-semibold">{q.question}</h3>
                      {q.answer_framework && (
                        <p className="text-body-sm text-on-surface-variant mb-md">{q.answer_framework}</p>
                      )}
                      <div className="flex items-center gap-sm mb-lg">
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
                          onClick={() => router.push(`/interview/${sessionId}?q=${q.id}`)}
                          className="flex-1 py-md px-md bg-gradient-to-b from-primary to-primary-container text-on-primary rounded-xl text-label-md shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200 flex justify-center items-center gap-sm"
                        >
                          <Play size={16} weight="fill" /> Practice This Question
                        </button>
                        {!isPracticed && (
                          <button
                            onClick={() => handleMarkAnswered(q.id)}
                            className="py-md px-md rounded-xl border border-outline-variant/30 text-label-md text-on-surface hover:bg-surface-container transition-all flex items-center gap-sm"
                          >
                            <Check size={16} /> Mark as Practiced
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-xl gap-md text-center bg-surface-container-lowest rounded-2xl border border-outline-variant/20">
                <p className="text-body-md text-on-surface font-medium">No {activeTab} questions in this session</p>
                <p className="text-body-sm text-on-surface-variant">Your personalized session focuses on other areas.</p>
              </div>
            )}
          </div>
        ) : (
          /* No session — real, previously-generated questions from the
             shared skill bank. Read-only (no practiced tracking): that
             only applies to your personalized session questions. */
          <div className="flex flex-col gap-md">
            {bankLoading ? (
              <div className="flex items-center justify-center py-xl">
                <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
              </div>
            ) : bankQuestions.length > 0 ? (
              bankQuestions.map((q) => (
                <div
                  key={q.id}
                  className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 hover:shadow-xl transition-shadow flex flex-col"
                >
                  <div className="flex justify-between items-start mb-md">
                    <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-primary/10 text-primary">
                      <MicrophoneStage size={24} />
                    </div>
                    <span className="bg-surface-container text-caption text-primary px-sm py-xs rounded-full">
                      {q.topic}
                    </span>
                  </div>
                  <h3 className="text-headline-md text-on-surface mb-sm font-semibold">{q.question}</h3>
                  <p className="text-body-sm text-on-surface-variant">{q.answer_framework}</p>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-xl gap-md text-center bg-surface-container-lowest rounded-2xl border border-outline-variant/20">
                <p className="text-body-md text-on-surface font-medium">No {activeTab} questions yet</p>
                <p className="text-body-sm text-on-surface-variant">
                  This grows automatically as more candidates tailor resumes against JDs needing these skills.
                </p>
              </div>
            )}

            <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-sm flex flex-col items-center justify-center gap-md py-xl text-center">
              <p className="text-body-md text-on-surface font-medium">Get Personalized Questions</p>
              <p className="text-body-sm text-on-surface-variant" style={{ maxWidth: "28rem" }}>
                Analyze a job description and tailor your resume to generate interview questions specific to your target role.
              </p>
              <button
                onClick={() => router.push("/jd")}
                className="px-xl py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200"
              >
                Go to JD Analyzer
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Right Column ──────────────────────────────────────────────────── */}
      <aside className="w-full lg:w-80 flex flex-col gap-md shrink-0">

        {/* Overall Readiness */}
        <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
          <h3 className="text-headline-md text-on-surface mb-lg font-semibold">Overall Readiness</h3>

          {/* Circular gauge */}
          <div className="relative w-32 h-32 mx-auto mb-lg flex items-center justify-center">
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
                strokeDasharray={`${readinessScore}, 100`}
                strokeLinecap="round" strokeWidth="3"
                style={{ transition: "stroke-dasharray 1s ease-out" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-headline-lg text-primary font-bold">{readinessScore}%</span>
            </div>
          </div>

          {/* Milestone breakdown */}
          <div className="flex flex-col gap-xs mb-lg text-caption text-on-surface-variant">
            {[
              { label: "Resume created",     done: resumes.length > 0 },
              { label: "JD analyzed",        done: jds.length > 0 },
              { label: "Session started",    done: !!sessionId },
              { label: "Questions practiced",done: answeredCount > 0 },
            ].map(({ label, done }) => (
              <div key={label} className="flex items-center gap-sm">
                <div className={`w-3 h-3 rounded-full flex items-center justify-center shrink-0 ${done ? "bg-primary" : "bg-surface-variant"}`}>
                  {done && <Check size={8} weight="bold" className="text-on-primary" />}
                </div>
                <span className={done ? "text-on-surface" : "text-on-surface-variant"}>{label}</span>
              </div>
            ))}
          </div>

          {sessionId && questions.length > 0 && (
            <p className="text-caption text-on-surface-variant text-center mb-md">
              {answeredCount} of {questions.length} questions practiced
            </p>
          )}

          {/* Strengths */}
          <div className="space-y-md">
            <div>
              <h4 className="text-label-md text-on-surface mb-sm flex items-center gap-sm">
                <ThumbsUp size={18} weight="fill" className="text-success-accent" /> Strengths
              </h4>
              <div className="flex flex-wrap gap-sm">
                {sessionId && answeredTopics.length > 0 ? (
                  answeredTopics.slice(0, 3).map((t) => (
                    <span key={t} className="px-sm py-xs bg-surface-container-high text-on-surface-variant text-caption rounded-md border border-outline-variant/30">{t}</span>
                  ))
                ) : matchedSkills.length > 0 ? (
                  matchedSkills.slice(0, 3).map((s) => (
                    <span key={s} className="px-sm py-xs bg-surface-container-high text-on-surface-variant text-caption rounded-md border border-outline-variant/30">{s}</span>
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
              </h4>
              <div className="flex flex-wrap gap-sm">
                {sessionId && unansweredTopics.length > 0 ? (
                  unansweredTopics.slice(0, 3).map((t) => (
                    <span key={t} className="px-sm py-xs bg-error-container/50 text-error text-caption rounded-md border border-error/20">{t}</span>
                  ))
                ) : missingSkills.length > 0 ? (
                  missingSkills.slice(0, 3).map((s) => (
                    <span key={s} className="px-sm py-xs bg-error-container/50 text-error text-caption rounded-md border border-error/20">{s}</span>
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

        {/* Next Mock Interview */}
        <div className="bg-primary text-on-primary rounded-2xl p-md shadow-lg shadow-primary/10 relative overflow-hidden">
          <div
            className="absolute top-0 right-0 w-32 h-32 bg-primary-container/50 rounded-full blur-2xl pointer-events-none"
            style={{ marginRight: "-2.5rem", marginTop: "-2.5rem" }}
          />
          <h4 className="text-label-md font-bold mb-xs relative z-10">Next Mock Interview</h4>
          <p className="text-body-sm mb-md relative z-10 opacity-90">
            {sessionId
              ? `${questions.length} questions ready · ${answeredCount} practiced`
              : "Analyze a JD to generate personalized questions"}
          </p>
          <button
            onClick={() => sessionId ? router.push(`/interview/${sessionId}`) : router.push("/jd")}
            className="w-full bg-gradient-to-b from-surface-container-lowest to-surface-container text-primary text-label-md py-md rounded-xl shadow-lg shadow-on-surface/10 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200 relative z-10"
          >
            {sessionId ? "Join Session" : "Analyze a JD First"}
          </button>
        </div>
      </aside>
    </div>
  );
}

"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ThumbsUp,
  TrendDown,
  Play,
  MicrophoneStage,
  Check,
  CircleNotch,
  CaretDown,
  CaretLeft,
  CaretRight,
  ArrowRight,
  ArrowsClockwise,
} from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import { ConnectionErrorBanner } from "@/components/ui/ConnectionErrorBanner";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { useTailoringStore } from "@/stores/tailoring-store";
import { usePrepQuestionsStore, startPrepQuestions, offerPrepQuestions } from "@/stores/prep-questions-store";
import { PrepQuestionsOffer } from "@/components/interview/PrepQuestionsOffer";
import { sourceLabel, practiceSaveError } from "@/components/interview/QuestionCard";
import type { PrepQuestionWithJdOut, JobDescription, Subscription } from "@career-copilot/types";

const TABS = ["Technical", "Behavioral", "HR & Culture"] as const;

const READINESS_HELP =
  "20% each for analyzing a JD, tailoring a résumé to it, and having interview questions ready, plus up to 40% for the share of your questions marked practiced.";
type Tab = (typeof TABS)[number];

function classifyTopic(topic: string): Tab {
  // New sets name one of the tabs exactly. Matching words came first, and
  // "culture" is a Behavioral word, so every HR & Culture question was filed
  // under Behavioral and that tab was always empty.
  const exact = TABS.find((t) => t === topic);
  if (exact) return exact;
  // Older sets: a free-form topic name.
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
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const storeSessionId = useTailoringStore((s) => s.sessionId);
  const storeMatchedSkills = useTailoringStore((s) => s.matchedSkills);
  const storeMissingSkills = useTailoringStore((s) => s.missingSkills);
  // JDs whose questions are being made right now (Save to JD or
  // Regenerate) → their titles, and why a last attempt failed.
  const pending = usePrepQuestionsStore((s) => s.pending);
  const prepErrors = usePrepQuestionsStore((s) => s.errors);

  const [activeTab, setActiveTab]     = useState<Tab>("Technical");
  // A "Mark as Practiced" that didn't save — shown under that question.
  const [markError, setMarkError]     = useState<{ id: string; message: string } | null>(null);
  // Each JD's questions are their own page — one JD in view at a time, picked
  // from the switcher. Seeded from ?jd= so a link (or the practice page's
  // back link) lands on the right one; null = the default JD below.
  const [pickedJdId, setPickedJdId] = useState<string | null>(() => searchParams.get("jd"));

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
  // The JD the latest run was for, when known without the questions list.
  const latestRunJdIdFromSession = storeSessionId ? null : latestSession?.jd_id ?? null;
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

  const jdsQuery = useQuery<JobDescription[]>({
    queryKey: ["jds"],
    queryFn:  () => apiClient.getJds(),
  });
  const jds = jdsQuery.data ?? [];
  // Only for the price shown on Regenerate — the server charges what it charges.
  const { data: subscription } = useQuery<Subscription>({
    queryKey: ["subscription"],
    queryFn: () => apiClient.getSubscription(),
  });

  const connectionError = myQuestionsQuery.isError || jdsQuery.isError;
  const isRetrying = myQuestionsQuery.isFetching || jdsQuery.isFetching;
  const retryAll = () => {
    myQuestionsQuery.refetch();
    jdsQuery.refetch();
  };

  // The JDs that have questions, for the switcher — deliberately not
  // apiClient.getJds() directly, since that would offer JDs with no
  // generated questions at all. Newest JD first (by the JD list's
  // created_at; a JD it doesn't know about keeps first-seen order).
  const jdCreatedAt = new Map(jds.map((j) => [j.id, j.created_at]));
  const jdOptions = [
    ...myQuestions
      .reduce((acc, q) => {
        const o = acc.get(q.jd_id) ?? { jd_id: q.jd_id, jd_title: q.jd_title, total: 0, practiced: 0 };
        o.total += 1;
        if (q.practiced_at) o.practiced += 1;
        return acc.set(q.jd_id, o);
      }, new Map<string, { jd_id: string; jd_title: string; total: number; practiced: number }>())
      .values(),
  ].sort((a, b) => (jdCreatedAt.get(b.jd_id) ?? "").localeCompare(jdCreatedAt.get(a.jd_id) ?? ""));

  // The JD in view: the one picked (or linked via ?jd=) if it has questions,
  // else the one the latest run was for, else the newest.
  const latestRunJdId = myQuestions.find((q) => q.session_id === sessionId)?.jd_id;
  const selectedJd =
    jdOptions.find((o) => o.jd_id === pickedJdId) ??
    jdOptions.find((o) => o.jd_id === latestRunJdId) ??
    jdOptions[0] ??
    null;
  const selectedJdId = selectedJd?.jd_id ?? null;

  function selectJd(jdId: string) {
    setPickedJdId(jdId);
    router.replace(`/interview?jd=${encodeURIComponent(jdId)}`, { scroll: false });
  }

  // In flight: a first set for a JD that has none yet goes in the banner
  // ("they'll appear here"); a new set for a JD that has one shows on its
  // card when it's selected, or in the banner when it isn't.
  const hasSet = new Set(jdOptions.map((o) => o.jd_id));
  const preparing = Object.entries(pending).filter(([id]) => !hasSet.has(id)).map(([, title]) => title);
  // Jobs with a tailored résumé saved but no set yet: their questions are
  // made here on request too (a "Not now" after the save isn't final).
  // Newest first, like the switcher. A job has at most one set, so a job
  // with one never shows here — and the server holds to that as well.
  const readyJds = jds
    .filter((j) => !!j.tailored_resume_id && !hasSet.has(j.id) && !(j.id in pending))
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const askToGenerate = (j: JobDescription) =>
    offerPrepQuestions({ jdId: j.id, sessionId: null, title: j.title });

  // A first set that failed (out of credits, say) has no card to show its
  // error on, so it used to vanish with the "preparing" banner.
  const jdTitle = new Map(jds.map((j) => [j.id, j.title]));
  const firstSetErrors = Object.entries(prepErrors)
    .filter(([id]) => !hasSet.has(id) && !(id in pending))
    .map(([id, message]) => ({ id, title: jdTitle.get(id) ?? null, message }));
  const regeneratingElsewhere = Object.entries(pending)
    .filter(([id]) => hasSet.has(id) && id !== selectedJdId)
    .map(([, title]) => title);

  function regenerate() {
    if (!selectedJd) return;
    void startPrepQuestions(queryClient, selectedJd.jd_id, { title: selectedJd.jd_title, regenerate: true });
  }

  // The selected JD's questions — everything below the switcher derives
  // from this, not myQuestions directly.
  const scopedQuestions = myQuestions.filter((q) => q.jd_id === selectedJdId);
  // The saved résumé was edited after this set was written from it.
  const resumeChanged = scopedQuestions.some((q) => q.resume_changed);
  // Written follow-up answers are paid for, and a new set replaces them.
  const answeredFollowups = scopedQuestions.reduce(
    (n, q) => n + (q.followups ?? []).filter((f) => f.answer).length,
    0,
  );

  // The run "Next mock" opens: the selected JD's (one run per JD in this
  // list). Only runs with questions appear here, so it never opens an
  // empty page.
  const practiceSessionId = scopedQuestions[0]?.session_id ?? null;
  const firstUnpracticed = scopedQuestions.find((q) => !q.practiced_at);
  const practiceHref = (sid: string, qId?: string) =>
    `/interview/${sid}?${qId ? `q=${qId}&` : ""}jd=${encodeURIComponent(selectedJdId ?? "")}`;

  // Practice progress — real, persisted server-side (PrepQuestion.practiced_at).
  // Built from the full (unfiltered) list so the readiness gauge and
  // "N practiced" count reflect all JDs regardless of the filter above.
  const answeredSet   = new Set(myQuestions.filter((q) => q.practiced_at).map((q) => q.id));
  const answeredCount = answeredSet.size;

  // Overall readiness (progressive — each milestone = +20 pts, practice fills last 40).
  // Interview readiness only starts once actual prep work exists — a JD
  // analyzed, a résumé tailored to one, questions made. Merely uploading a
  // resume in My Profile does not count. sessionId is a completed tailoring
  // run; it used to be shown as "Session started", which read as practice.
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
  // Strengths / needs focus, for the JD on screen: the résumé skills its
  // deep-dive ("overlap") questions build on, and the skill gaps its "gap"
  // questions cover — still unpracticed ones first. A topic name used to
  // stand in here, but topics are now just the three tabs.
  // Chips are skill names; a basis is sometimes a whole phrase ("root cause
  // analysis of production errors"), which doesn't read as one — skip those.
  const unique = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter((x) => x && x.length <= 32))];
  const overlapSkills = unique(
    scopedQuestions.filter((q) => q.source === "overlap").map((q) => q.basis.split(" — ")[0]),
  );
  const gapQs = scopedQuestions.filter((q) => q.source === "gap");
  const gapSkills = unique([
    ...gapQs.filter((q) => !answeredSet.has(q.id)).map((q) => q.basis),
    ...gapQs.map((q) => q.basis),
  ]);
  // The latest run's matched/missing skills only describe its own JD.
  const runIsForThisJd = !selectedJdId || latestRunJdIdFromSession === selectedJdId;

  const tabQuestions = scopedQuestions.filter((q) => classifyTopic(q.topic) === activeTab);

  async function handleMarkAnswered(qId: string) {
    // Optimistic — flip it locally immediately, reconcile with the server's
    // actual practiced_at once the request resolves. Merge (not replace):
    // markQuestionPracticed's response has no jd_id/jd_title, so replacing
    // the whole item would drop it from its JD.
    setMarkError(null);
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
      setMarkError({ id: qId, message: practiceSaveError() });
    }
  }

  // Shared by the laptop's right rail and the phone's strip.
  // The same steps the score counts, so the list and the number agree.
  const milestones = [
    { label: "JD analyzed", done: jds.length > 0 },
    { label: "Résumé tailored", done: !!sessionId },
    { label: "Questions ready", done: hasAnyQuestions },
    { label: "Questions practiced", done: answeredCount > 0 },
  ];
  const strengths = (overlapSkills.length > 0 ? overlapSkills : runIsForThisJd ? matchedSkills : []).slice(0, 3);
  const focus = (gapSkills.length > 0 ? gapSkills : runIsForThisJd ? missingSkills : []).slice(0, 3);

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

        {/* A Save to JD just started making questions; the list refreshes the
            moment they exist, so say so rather than show an empty page. */}
        {preparing.length > 0 && (
          <div
            role="status"
            className="flex items-center gap-sm rounded-2xl border border-primary/20 bg-primary/5 px-md py-sm text-body-sm text-on-surface"
          >
            <CircleNotch size={16} className="shrink-0 animate-spin text-primary motion-reduce:animate-none" />
            <span className="min-w-0">
              Preparing interview questions
              {preparing.length === 1 && preparing[0] ? ` for ${preparing[0]}` : ""} — they&apos;ll appear here
              in a moment.
            </span>
          </div>
        )}
        {firstSetErrors.map((e) => (
          <div
            key={e.id}
            role="alert"
            className="flex flex-col sm:flex-row sm:items-center gap-xs sm:gap-sm rounded-2xl border border-error/25 bg-error-container/30 px-md py-sm text-body-sm text-on-surface"
          >
            <span className="min-w-0 flex-1">
              Couldn&apos;t make interview questions{e.title ? ` for ${e.title}` : ""}: {e.message}
            </span>
            <Link href={`/jd/${e.id}`} className="shrink-0 inline-flex items-center gap-xs text-label-sm text-primary hover:underline">
              Open the JD <ArrowRight size={12} />
            </Link>
          </div>
        ))}
        {regeneratingElsewhere.length > 0 && (
          <div
            role="status"
            className="flex items-center gap-sm rounded-2xl border border-primary/20 bg-primary/5 px-md py-sm text-body-sm text-on-surface"
          >
            <CircleNotch size={16} className="shrink-0 animate-spin text-primary motion-reduce:animate-none" />
            <span className="min-w-0">
              Making a new set of questions for {regeneratingElsewhere.join(", ")}.
            </span>
          </div>
        )}

        {readyJds.length > 0 && (
          <ReadyForQuestions
            jds={readyJds}
            cost={subscription?.costs?.prep_questions ?? 5}
            onGenerate={askToGenerate}
          />
        )}
        <PrepQuestionsOffer />

        {/* Which JD's questions are on screen — each JD is its own page. */}
        {selectedJd && (
          <JdSwitcher
            key={selectedJd.jd_id}
            options={jdOptions}
            selected={selectedJd}
            onSelect={selectJd}
            onRegenerate={regenerate}
            regenerating={selectedJd.jd_id in pending}
            error={prepErrors[selectedJd.jd_id] ?? null}
            cost={subscription?.costs?.prep_questions ?? 5}
            resumeChanged={resumeChanged}
            answeredFollowups={answeredFollowups}
          />
        )}

        {/* Phones: the laptop's right-hand rail, as a strip under the JD card —
            below the questions it was out of sight. */}
        <div className="lg:hidden grid grid-cols-2 gap-sm">
          <div className="bg-surface-container-lowest rounded-2xl p-md border border-outline-variant/20 shadow-lg shadow-on-surface/5 flex items-center gap-sm">
            <ReadinessGauge score={readinessScore} className="w-14 h-14 shrink-0" labelClassName="text-label-md" />
            <div className="min-w-0">
              <p className="text-label-md text-on-surface font-semibold flex items-center gap-xs">
                Readiness
                <InfoTooltip text={READINESS_HELP} />
              </p>
              <p className="text-caption text-on-surface-variant">
                {milestones.filter((m) => m.done).length} of {milestones.length} steps
              </p>
            </div>
          </div>
          <NextMockCard
            sessionId={practiceSessionId}
            ready={scopedQuestions.length}
            practiced={selectedJd?.practiced ?? 0}
            onGo={() => router.push(practiceSessionId ? practiceHref(practiceSessionId, firstUnpracticed?.id) : "/jd")}
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

        {/* Tab Navigation */}
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

        {/* Content: the selected JD's questions OR the empty-state CTA */}
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
                {tabQuestions.map((q) => {
                  const isPracticed = answeredSet.has(q.id);
                  return (
                    <div
                      key={q.id}
                      className="bg-surface-container-lowest rounded-2xl p-md sm:p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 hover:shadow-xl transition-shadow flex flex-col"
                    >
                      <div className="flex justify-between items-center mb-sm sm:mb-md">
                        <div className={`w-9 h-9 sm:w-12 sm:h-12 rounded-lg flex items-center justify-center ${isPracticed ? "bg-success-accent/10 text-success-accent" : "bg-primary/10 text-primary"}`}>
                          <MicrophoneStage size={20} />
                        </div>
                        {isPracticed && (
                          <span className="inline-flex items-center gap-xs px-sm py-xs rounded-full bg-success-accent/10 text-success-accent text-label-sm">
                            <Check size={12} weight="bold" /> Practiced
                          </span>
                        )}
                      </div>
                      <h3 className="text-headline-md text-on-surface mb-sm font-semibold">{q.question}</h3>
                      {q.basis && (
                        <p className="text-caption text-primary/80 mb-md flex items-start gap-xs">
                          <span className="shrink-0 font-semibold">{sourceLabel(q.source)}</span>
                          <span className="text-on-surface-variant">{q.basis}</span>
                        </p>
                      )}
                      <div className="flex gap-sm">
                        <button
                          onClick={() => router.push(practiceHref(q.session_id, q.id))}
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
                      {markError?.id === q.id && (
                        <p role="alert" className="text-caption text-error mt-sm">{markError.message}</p>
                      )}
                    </div>
                  );
                })}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-xl gap-md text-center bg-surface-container-lowest rounded-2xl border border-outline-variant/20">
                <p className="text-body-md text-on-surface font-medium">No {activeTab} questions for this JD</p>
                <p className="text-body-sm text-on-surface-variant">Your personalized questions focus on other areas.</p>
              </div>
            )}
          </div>
        ) : readyJds.length > 0 ? null : (
          /* No tailoring-generated questions yet. Interview questions are
             only ever produced by tailoring a resume against a JD — there
             is no resume-only or cross-user question list here, so a plain
             resume uploaded in My Profile shows nothing but this CTA. */
          <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-sm flex flex-col items-center justify-center gap-md py-xl text-center">
            <p className="text-body-md text-on-surface font-medium">No interview questions yet</p>
            <p className="text-body-sm text-on-surface-variant" style={{ maxWidth: "28rem" }}>
              Interview questions are made for a job on request: analyze a
              JD, tailor your résumé to it, Save to JD, then choose Make
              questions. They are built from that résumé and that role.
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
            <InfoTooltip text={READINESS_HELP} />
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
                <InfoTooltip text="Skills your résumé already shows for this job — the ones its deep-dive questions build on." />
              </h4>
              <div className="flex flex-wrap gap-sm">
                {strengths.length > 0 ? (
                  strengths.map((t) => (
                    <span key={t} className="px-sm py-xs bg-surface-container-high text-on-surface-variant text-caption rounded-md border border-outline-variant/30">{t}</span>
                  ))
                ) : (
                  <span className="text-caption text-on-surface-variant italic">
                    {hasAnyQuestions ? "None of this job's questions build on a résumé skill" : jds.length > 0 ? "Save a tailored résumé to a JD to see them" : "Analyze a JD to discover strengths"}
                  </span>
                )}
              </div>
            </div>

            {/* Needs Focus */}
            <div>
              <h4 className="text-label-md text-on-surface mb-sm flex items-center gap-sm">
                <TrendDown size={18} weight="fill" className="text-error" /> Needs Focus
                <InfoTooltip text="Skills this job wants that your résumé doesn't show yet — practice their questions first." />
              </h4>
              <div className="flex flex-wrap gap-sm">
                {focus.length > 0 ? (
                  focus.map((t) => (
                    <span key={t} className="px-sm py-xs bg-error-container/50 text-error text-caption rounded-md border border-error/20">{t}</span>
                  ))
                ) : (
                  <span className="text-caption text-on-surface-variant italic">
                    {hasAnyQuestions ? "No skill gaps in this job's questions" : jds.length > 0 ? "Save a tailored résumé to a JD to see them" : "Analyze a JD to find focus areas"}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <NextMockCard
          sessionId={practiceSessionId}
          ready={scopedQuestions.length}
          practiced={selectedJd?.practiced ?? 0}
          onGo={() => router.push(practiceSessionId ? practiceHref(practiceSessionId, firstUnpracticed?.id) : "/jd")}
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
      <h4 className="text-label-md font-bold mb-xs relative z-10">{compact ? "Practice" : "Practice Session"}</h4>
      <p className={`relative z-10 opacity-90 ${compact ? "text-caption" : "text-body-sm mb-md"}`}>
        {sessionId
          ? compact
            ? `${ready} ready · ${practiced} done`
            : `${ready} questions · ${practiced} practiced`
          : compact
            ? "Save a tailored résumé first"
            : "Save a tailored résumé to a JD to get personalized questions"}
      </p>
      <button
        onClick={onGo}
        className={`w-full bg-surface-container-lowest text-primary text-label-md rounded-xl shadow-lg shadow-on-surface/10 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200 relative z-10 ${compact ? "py-xs" : "py-md"}`}
      >
        {sessionId ? (compact ? "Start" : "Start Practice") : compact ? "Go" : "Analyze a JD First"}
      </button>
    </div>
  );
}

/** Jobs whose saved résumé has no question set yet, each one click from the
 * same "Make interview questions?" the Studio asks after a save. */
function ReadyForQuestions({
  jds,
  cost,
  onGenerate,
}: {
  jds: JobDescription[];
  cost: number;
  onGenerate: (jd: JobDescription) => void;
}) {
  return (
    <section
      aria-labelledby="ready-for-questions"
      className="bg-surface-container-lowest rounded-2xl p-md sm:p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 flex flex-col gap-sm"
    >
      <div>
        <h3 id="ready-for-questions" className="text-label-md text-on-surface font-semibold">
          Ready for interview questions
        </h3>
        <p className="text-caption text-on-surface-variant">
          A tailored résumé is saved to these jobs. Questions are built from it.
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-outline-variant/20">
        {jds.map((j) => (
          <li key={j.id} className="flex items-center gap-sm py-xs first:pt-0 last:pb-0">
            <Link
              href={`/jd/${j.id}`}
              className="min-w-0 flex-1 truncate text-body-sm text-on-surface hover:text-primary hover:underline"
            >
              {j.title}
            </Link>
            <button
              type="button"
              onClick={() => onGenerate(j)}
              aria-label={`Generate interview questions for ${j.title}`}
              className="shrink-0 inline-flex items-center gap-xs px-sm py-xs rounded-lg border border-primary/30 text-label-sm text-primary hover:bg-primary/5 transition-colors"
            >
              Generate · {cost} credits
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What a new set throws away, for Regenerate's confirmation. */
function regenerateLosses(practiced: number, answeredFollowups: number): string {
  const lost = [
    practiced > 0 ? `practice progress (${practiced} done)` : null,
    answeredFollowups > 0
      ? `${answeredFollowups} written follow-up answer${answeredFollowups !== 1 ? "s" : ""}`
      : null,
  ].filter(Boolean);
  return lost.length > 0 ? ` This JD's ${lost.join(" and ")} will be lost.` : "";
}

type JdOption = { jd_id: string; jd_title: string; total: number; practiced: number };

function JdSwitcher({
  options,
  selected,
  onSelect,
  onRegenerate,
  regenerating,
  error,
  cost,
  resumeChanged,
  answeredFollowups,
}: {
  options: JdOption[];
  selected: JdOption;
  onSelect: (jdId: string) => void;
  onRegenerate: () => void;
  regenerating: boolean;
  error: string | null;
  cost: number;
  resumeChanged: boolean;
  answeredFollowups: number;
}) {
  // Regenerate replaces the set (and its practice progress) and costs
  // credits, so it asks first — inline, right where the button was.
  const [confirming, setConfirming] = useState(false);
  const index = options.findIndex((o) => o.jd_id === selected.jd_id);
  const many = options.length > 1;
  const pct = selected.total > 0 ? Math.round((selected.practiced / selected.total) * 100) : 0;
  const stepBtn =
    "w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-xl border border-outline-variant/40 text-on-surface-variant flex items-center justify-center hover:bg-surface-container hover:text-on-surface disabled:opacity-40 disabled:pointer-events-none transition-colors";

  return (
    <section className="bg-surface-container-lowest rounded-2xl p-md sm:p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 flex flex-col gap-sm">
      <div className="flex items-center justify-between gap-sm">
        <label htmlFor="jd-switcher" className="text-label-sm text-on-surface-variant uppercase tracking-wider">
          Questions for
        </label>
        <div className="flex items-center gap-sm sm:gap-md">
          {many && (
            <span className="text-caption text-on-surface-variant">
              JD {index + 1} of {options.length}
            </span>
          )}
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={regenerating || confirming}
            className="inline-flex items-center gap-xs py-sm -my-sm text-label-sm text-primary hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-default"
          >
            {regenerating ? (
              <CircleNotch size={14} className="animate-spin motion-reduce:animate-none" />
            ) : (
              <ArrowsClockwise size={14} />
            )}
            {regenerating ? "Regenerating…" : "Regenerate"}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-xs sm:gap-sm">
        {many && (
          <button
            type="button"
            aria-label="Previous job description"
            disabled={index <= 0}
            onClick={() => onSelect(options[index - 1].jd_id)}
            className={stepBtn}
          >
            <CaretLeft size={16} />
          </button>
        )}
        <div className="relative flex-1 min-w-0">
          <select
            id="jd-switcher"
            value={selected.jd_id}
            onChange={(e) => onSelect(e.target.value)}
            disabled={!many}
            className="w-full appearance-none truncate pl-md pr-xl py-xs sm:py-sm rounded-xl border border-outline-variant/50 bg-surface text-body-md sm:text-headline-md text-on-surface font-semibold disabled:opacity-100 focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            {options.map((o) => (
              <option key={o.jd_id} value={o.jd_id}>
                {o.jd_title} — {o.total} question{o.total !== 1 ? "s" : ""}
              </option>
            ))}
          </select>
          {many && (
            <CaretDown
              size={16}
              className="pointer-events-none absolute right-sm top-1/2 -translate-y-1/2 text-on-surface-variant"
            />
          )}
        </div>
        {many && (
          <button
            type="button"
            aria-label="Next job description"
            disabled={index >= options.length - 1}
            onClick={() => onSelect(options[index + 1].jd_id)}
            className={stepBtn}
          >
            <CaretRight size={16} />
          </button>
        )}
      </div>

      {confirming ? (
        <div className="rounded-xl border border-primary/25 bg-primary/5 p-sm sm:p-md flex flex-col sm:flex-row sm:items-center gap-sm">
          <p className="flex-1 min-w-0 text-body-sm text-on-surface">
            Replace these {selected.total} questions with a new set?{" "}
            <span className="text-on-surface-variant">
              Costs {cost} credit{cost !== 1 ? "s" : ""}.
              {regenerateLosses(selected.practiced, answeredFollowups)}
            </span>
          </p>
          <div className="flex gap-sm shrink-0">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="flex-1 sm:flex-none px-md py-xs rounded-lg border border-outline-variant/40 text-label-sm text-on-surface hover:bg-surface-container"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onRegenerate();
              }}
              className="flex-1 sm:flex-none px-md py-xs rounded-lg bg-primary text-on-primary text-label-sm shadow-sm hover:shadow-md"
            >
              Regenerate
            </button>
          </div>
        </div>
      ) : regenerating ? (
        <p role="status" className="text-caption text-on-surface-variant">
          Writing a new set — these questions stay until it&apos;s ready.
        </p>
      ) : (
        <div className="flex items-center gap-sm sm:gap-md text-caption text-on-surface-variant">
          <span className="shrink-0">
            {selected.practiced} of {selected.total} practiced
          </span>
          <div className="flex-1 h-1.5 bg-surface-variant rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <Link
            href={`/jd/${selected.jd_id}`}
            className="shrink-0 inline-flex items-center gap-xs text-label-sm text-primary hover:underline"
          >
            View JD <ArrowRight size={12} />
          </Link>
        </div>
      )}
      {resumeChanged && !confirming && !regenerating && (
        <p className="text-caption text-on-surface-variant">
          The résumé for this job was edited after these questions were made. Regenerate to match it.
        </p>
      )}
      {error && !regenerating && <p className="text-caption text-error">{error}</p>}
    </section>
  );
}

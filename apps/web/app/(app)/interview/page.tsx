"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  ArrowsClockwise,
  CaretDown,
  CaretLeft,
  CaretRight,
  Check,
  CircleNotch,
  Play,
} from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import { FOCUS_RING } from "@/lib/focus";
import { ConnectionErrorBanner } from "@/components/ui/ConnectionErrorBanner";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { useTailoringStore } from "@/stores/tailoring-store";
import { usePrepQuestionsStore, startPrepQuestions, offerPrepQuestions } from "@/stores/prep-questions-store";
import { PrepQuestionsOffer } from "@/components/interview/PrepQuestionsOffer";
import { practiceSaveError, questionSource } from "@/components/interview/QuestionCard";
import type { PrepQuestionWithJdOut, JobDescription, Subscription } from "@career-copilot/types";

const TABS = ["Technical", "Behavioral", "HR & Culture"] as const;
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
  // A "Mark as practiced" that didn't save — shown under that question.
  const [markError, setMarkError]     = useState<{ id: string; message: string } | null>(null);
  // Each JD's questions are their own page — one JD in view at a time, picked
  // from the switcher. Seeded from ?jd= so a link (or the practice page's
  // back link) lands on the right one; null = the default JD below.
  const [pickedJdId, setPickedJdId] = useState<string | null>(() => searchParams.get("jd"));

  // The in-memory tailoring store only knows about a session if tailoring
  // just ran in this browser tab — a reload, direct nav, or switching JDs
  // wipes it. Fall back to the user's actual most recent completed session
  // (real, JD-specific) for picking the job shown first and the focus-skill
  // fallback below.
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

  const jdsQuery = useQuery<JobDescription[]>({
    queryKey: ["jds"],
    queryFn:  () => apiClient.getJds(),
  });
  const jds = jdsQuery.data ?? [];
  // Only for the prices shown — the server charges what it charges.
  const { data: subscription } = useQuery<Subscription>({
    queryKey: ["subscription"],
    queryFn: () => apiClient.getSubscription(),
  });
  const cost = subscription?.costs?.prep_questions ?? 5;

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
      }, new Map<string, JdOption>())
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
  // panel when it's selected, or in the banner when it isn't.
  const hasSet = new Set(jdOptions.map((o) => o.jd_id));
  const preparing = Object.entries(pending).filter(([id]) => !hasSet.has(id)).map(([, title]) => title);
  // Jobs with a tailored résumé saved but no set yet: their questions are
  // made here on request too (a "Not now" after the save isn't final).
  // Newest first, like the switcher. A job has at most one set, so a job
  // with one never shows here — and the server holds to that as well.
  const readyJds = jds
    .filter((j) => !!j.tailored_resume_id && !hasSet.has(j.id) && !(j.id in pending))
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const askToGenerate = (j: JobDescription) => {
    // Selected now, so its questions are on screen the moment they exist.
    selectJd(j.id);
    offerPrepQuestions({ jdId: j.id, sessionId: null, title: j.title });
  };
  // Linked here for a job with no set yet (e.g. "Open interview prep" from
  // the JD page): say so first, rather than show another job's questions.
  // Not while its own "Make interview questions?" is open.
  const offerOpenFor = usePrepQuestionsStore((s) => s.offer?.jdId ?? null);
  const linkedReady = readyJds.find((j) => j.id === pickedJdId && j.id !== offerOpenFor) ?? null;

  // A first set that failed (out of credits, say) has no panel to show its
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
  // from this, not myQuestions directly. In the order they are practised:
  // by tab, then as written.
  const scopedQuestions = myQuestions
    .filter((q) => q.jd_id === selectedJdId)
    .sort(
      (a, b) =>
        TABS.indexOf(classifyTopic(a.topic)) - TABS.indexOf(classifyTopic(b.topic)) || a.order_index - b.order_index,
    );
  // The saved résumé was edited after this set was written from it.
  const resumeChanged = scopedQuestions.some((q) => q.resume_changed);
  // Written follow-up answers are paid for, and a new set replaces them.
  const answeredFollowups = scopedQuestions.reduce(
    (n, q) => n + (q.followups ?? []).filter((f) => f.answer).length,
    0,
  );

  const practiceSessionId = scopedQuestions[0]?.session_id ?? null;
  const firstUnpracticed = scopedQuestions.find((q) => !q.practiced_at);
  const practiceHref = (sid: string, qId?: string) =>
    `/interview/${sid}?${qId ? `q=${qId}&` : ""}jd=${encodeURIComponent(selectedJdId ?? "")}`;

  // Practice progress — real, persisted server-side (PrepQuestion.practiced_at).
  const answeredSet   = new Set(myQuestions.filter((q) => q.practiced_at).map((q) => q.id));
  const answeredCount = answeredSet.size;

  const tabCounts: Record<Tab, number> = {
    Technical:     scopedQuestions.filter((q) => classifyTopic(q.topic) === "Technical").length,
    Behavioral:    scopedQuestions.filter((q) => classifyTopic(q.topic) === "Behavioral").length,
    "HR & Culture": scopedQuestions.filter((q) => classifyTopic(q.topic) === "HR & Culture").length,
  };

  // Focus, for the JD on screen: the résumé skills its deep-dive ("overlap")
  // questions build on, and the skill gaps its "gap" questions cover — still
  // unpracticed ones first. Chips are skill names; a basis is sometimes a
  // whole phrase ("root cause analysis of production errors"), which doesn't
  // read as one — skip those.
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
  const strengths = (overlapSkills.length > 0 ? overlapSkills : runIsForThisJd ? matchedSkills : []).slice(0, 4);
  const focus = (gapSkills.length > 0 ? gapSkills : runIsForThisJd ? missingSkills : []).slice(0, 4);

  // The tab picked, unless this job has nothing under it: then its first
  // topic that has questions (a job with no Technical questions used to
  // open on "No Technical questions").
  const shownTab: Tab = tabCounts[activeTab] > 0 ? activeTab : TABS.find((t) => tabCounts[t] > 0) ?? activeTab;
  const tabQuestions = scopedQuestions.filter((q) => classifyTopic(q.topic) === shownTab);

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

  const summary = selectedJd
    ? `${jdOptions.length} job${jdOptions.length !== 1 ? "s" : ""} with questions · ${answeredCount} of ${myQuestions.length} practiced`
    : "Questions for each job you apply to, built from the résumé you saved for it.";
  const nothingYet = !isLoading && !selectedJd && readyJds.length === 0 && preparing.length === 0;

  return (
    <div className="p-gutter md:p-xl max-w-[1440px] mx-auto w-full min-w-0 flex flex-col gap-md sm:gap-lg">
      <ConnectionErrorBanner
        show={connectionError}
        onRetry={retryAll}
        isRetrying={isRetrying}
        message="Can't reach the server — your generated interview questions aren't loading. Your data is safe."
      />

      <header className="pt-xs sm:pt-0">
        <h2 className="text-headline-md sm:text-headline-lg text-on-surface font-semibold">Interview Center</h2>
        <p className="mt-xs text-body-sm text-on-surface-variant">{summary}</p>
      </header>

      {/* A Save to JD just started making questions; the list refreshes the
          moment they exist, so say so rather than show an empty page. */}
      {preparing.length > 0 && (
        <Notice tone="working">
          Preparing interview questions
          {preparing.length === 1 && preparing[0] ? ` for ${preparing[0]}` : ""} — they&apos;ll appear here in a
          moment.
        </Notice>
      )}
      {firstSetErrors.map((e) => (
        <div
          key={e.id}
          role="alert"
          className="flex flex-col sm:flex-row sm:items-center gap-xs sm:gap-sm rounded-xl border border-error/25 bg-error-container/40 px-md py-sm text-body-sm text-on-surface"
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
        <Notice tone="working">Making a new set of questions for {regeneratingElsewhere.join(", ")}.</Notice>
      )}
      <PrepQuestionsOffer />

      {linkedReady && (
        <section
          aria-label="No questions for this job yet"
          className="flex flex-col sm:flex-row sm:items-center gap-sm rounded-xl border border-primary/25 bg-primary-fixed/40 px-md py-sm"
        >
          <p className="min-w-0 flex-1 text-body-sm text-on-surface">
            No interview questions for <span className="font-medium">{linkedReady.title}</span> yet. They&apos;re built
            from the résumé saved for it.
          </p>
          <button
            type="button"
            onClick={() => askToGenerate(linkedReady)}
            className={`shrink-0 inline-flex items-center justify-center gap-xs rounded-lg bg-primary px-md py-xs text-label-md text-on-primary hover:bg-primary-container ${FOCUS_RING}`}
          >
            Make questions · {cost} credits
          </button>
        </section>
      )}

      {nothingYet && <EmptyState onStart={() => router.push("/jd")} />}

      {!selectedJd && readyJds.length > 0 && (
        <ReadyForQuestions jds={readyJds} cost={cost} onGenerate={askToGenerate} />
      )}

      {isLoading && (
        <div className="flex flex-col gap-md" aria-hidden>
          <div className="h-36 rounded-2xl bg-surface-container animate-pulse" />
          <div className="h-64 rounded-2xl bg-surface-container animate-pulse" />
        </div>
      )}

      {selectedJd && (
        <div className="flex flex-col lg:flex-row lg:items-start gap-md sm:gap-lg">
          <div className="flex-1 min-w-0 flex flex-col gap-md">
            <JobPanel
              key={selectedJd.jd_id}
              options={jdOptions}
              selected={selectedJd}
              questions={scopedQuestions}
              onSelect={selectJd}
              onRegenerate={regenerate}
              regenerating={selectedJd.jd_id in pending}
              error={prepErrors[selectedJd.jd_id] ?? null}
              cost={cost}
              resumeChanged={resumeChanged}
              answeredFollowups={answeredFollowups}
              practiceHref={
                practiceSessionId ? practiceHref(practiceSessionId, firstUnpracticed?.id) : null
              }
            />

            {/* Phones: the side column's content, compact, above the questions
                rather than after all of them. */}
            <div className="lg:hidden flex flex-col gap-sm">
              {readyJds.length > 0 && (
                <ReadyForQuestions jds={readyJds} cost={cost} onGenerate={askToGenerate} compact />
              )}
              <FocusChips strengths={strengths} focus={focus} compact />
            </div>

            <div role="tablist" aria-label="Question topics" className="flex gap-xs p-xs rounded-xl bg-surface-container w-full sm:w-fit">
              {TABS.map((tab) => {
                const active = shownTab === tab;
                const empty = tabCounts[tab] === 0;
                return (
                  <button
                    key={tab}
                    role="tab"
                    aria-selected={active}
                    aria-label={`${tab} (${tabCounts[tab]})`}
                    disabled={empty}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-xs px-sm sm:px-md py-xs rounded-lg text-label-md whitespace-nowrap transition-colors ${FOCUS_RING} ${
                      active
                        ? "bg-surface-container-lowest text-on-surface shadow-sm"
                        : "text-on-surface-variant hover:text-on-surface disabled:opacity-40 disabled:hover:text-on-surface-variant"
                    }`}
                  >
                    {tab}
                    <span
                      className={`font-label-caps text-label-caps tabular-nums ${active ? "text-primary" : "text-on-surface-variant/80"}`}
                    >
                      {tabCounts[tab]}
                    </span>
                  </button>
                );
              })}
            </div>

            {tabQuestions.length > 0 ? (
              <ol className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 divide-y divide-outline-variant/25">
                {tabQuestions.map((q) => {
                  const isPracticed = answeredSet.has(q.id);
                  const src = questionSource(q.source);
                  return (
                    <li key={q.id} className="p-md sm:p-lg flex flex-col gap-sm">
                      <div className="flex items-start justify-between gap-sm">
                        <p className="min-w-0 flex items-baseline gap-xs">
                          <span className={`shrink-0 font-label-caps text-label-caps uppercase ${src.tone}`}>{src.label}</span>
                          {q.basis && (
                            <span className="min-w-0 truncate text-caption text-on-surface-variant" title={q.basis}>
                              · {q.basis}
                            </span>
                          )}
                        </p>
                        {isPracticed && (
                          <span className="shrink-0 inline-flex items-center gap-xs rounded-full bg-success-container px-sm py-0.5 text-label-sm text-on-success-container">
                            <Check size={12} weight="bold" /> Practiced
                          </span>
                        )}
                      </div>
                      <p className="text-body-md sm:text-body-lg text-on-surface font-medium">{q.question}</p>
                      <div className="flex items-center gap-sm pt-xs">
                        <button
                          onClick={() => router.push(practiceHref(q.session_id, q.id))}
                          className={`inline-flex items-center gap-xs rounded-lg border border-primary/30 px-md py-xs text-label-md text-primary hover:bg-primary/5 transition-colors ${FOCUS_RING}`}
                        >
                          <Play size={14} weight="fill" /> Practice
                        </button>
                        {!isPracticed && (
                          <button
                            onClick={() => handleMarkAnswered(q.id)}
                            className={`inline-flex items-center gap-xs rounded-lg px-sm py-xs text-label-md text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors ${FOCUS_RING}`}
                          >
                            <Check size={14} /> Mark as practiced
                          </button>
                        )}
                      </div>
                      {markError?.id === q.id && (
                        <p role="alert" className="text-caption text-error">{markError.message}</p>
                      )}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="rounded-2xl border border-dashed border-outline-variant/60 px-md py-xl text-center">
                <p className="text-body-md text-on-surface font-medium">No {shownTab} questions for this job</p>
                <p className="mt-xs text-body-sm text-on-surface-variant">This set focuses on the other topics.</p>
              </div>
            )}
          </div>

          <aside className="hidden lg:flex w-80 shrink-0 flex-col gap-md">
            {readyJds.length > 0 && <ReadyForQuestions jds={readyJds} cost={cost} onGenerate={askToGenerate} />}
            <FocusChips strengths={strengths} focus={focus} />
          </aside>
        </div>
      )}
    </div>
  );
}

function Notice({ tone, children }: { tone: "working"; children: React.ReactNode }) {
  return (
    <div
      role="status"
      data-tone={tone}
      className="flex items-center gap-sm rounded-xl border border-primary/20 bg-primary-fixed/40 px-md py-sm text-body-sm text-on-surface"
    >
      <CircleNotch size={16} className="shrink-0 animate-spin text-primary motion-reduce:animate-none" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/** Nothing to practise yet: the three steps that get there. A real sequence,
 * so numbered. */
function EmptyState({ onStart }: { onStart: () => void }) {
  const steps = [
    ["Analyze a job", "Paste the posting into the JD Analyzer."],
    ["Tailor and save", "Tailor your résumé to it, then Save to JD."],
    ["Make questions", "Choose Make questions. They're built from that résumé and role."],
  ];
  return (
    <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-md sm:p-xl">
      <p className="text-body-md text-on-surface font-semibold">No interview questions yet</p>
      <ol className="mt-md grid gap-sm sm:grid-cols-3">
        {steps.map(([title, detail], i) => (
          <li key={title} className="flex gap-sm rounded-xl bg-surface-container-low p-sm sm:p-md">
            <span className="font-label-caps text-label-caps text-primary pt-0.5">{i + 1}</span>
            <span className="min-w-0">
              <span className="block text-label-md text-on-surface">{title}</span>
              <span className="block text-caption text-on-surface-variant mt-0.5">{detail}</span>
            </span>
          </li>
        ))}
      </ol>
      <button
        onClick={onStart}
        className={`mt-md inline-flex items-center gap-xs rounded-lg bg-primary px-lg py-sm text-label-md text-on-primary hover:bg-primary-container transition-colors ${FOCUS_RING}`}
      >
        Go to JD Analyzer <ArrowRight size={14} />
      </button>
    </section>
  );
}

/** The résumé skills this job's questions build on, and the gaps they
 * cover — what to practise first. */
function FocusChips({ strengths, focus, compact = false }: { strengths: string[]; focus: string[]; compact?: boolean }) {
  if (strengths.length === 0 && focus.length === 0) return null;
  const chip = "inline-flex items-center rounded-md px-sm py-0.5 text-caption";
  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-xs">
        <span className="text-caption text-on-surface-variant">{focus.length > 0 ? "Prepare:" : "Strengths:"}</span>
        {focus.map((t) => (
          <span key={`f-${t}`} className={`${chip} bg-tertiary-fixed/60 text-on-tertiary-fixed-variant`}>{t}</span>
        ))}
        {strengths.map((t) => (
          <span key={`s-${t}`} className={`${chip} bg-surface-container-high text-on-surface-variant`}>{t}</span>
        ))}
      </div>
    );
  }
  return (
    <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-md flex flex-col gap-md">
      {focus.length > 0 && (
        <div>
          <h3 className="flex items-center gap-xs font-label-caps text-label-caps uppercase text-tertiary">
            Gaps to prepare
            <InfoTooltip text="Skills this job wants that your résumé doesn't show yet — practice their questions first." />
          </h3>
          <div className="mt-sm flex flex-wrap gap-xs">
            {focus.map((t) => (
              <span key={t} className={`${chip} bg-tertiary-fixed/60 text-on-tertiary-fixed-variant`}>{t}</span>
            ))}
          </div>
        </div>
      )}
      {strengths.length > 0 && (
        <div>
          <h3 className="flex items-center gap-xs font-label-caps text-label-caps uppercase text-on-surface-variant">
            Strengths
            <InfoTooltip text="Skills your résumé already shows for this job — the ones its deep-dive questions build on." />
          </h3>
          <div className="mt-sm flex flex-wrap gap-xs">
            {strengths.map((t) => (
              <span key={t} className={`${chip} bg-surface-container-high text-on-surface-variant`}>{t}</span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** Jobs whose saved résumé has no question set yet, each one click from the
 * same "Make interview questions?" the Studio asks after a save. */
function ReadyForQuestions({
  jds,
  cost,
  onGenerate,
  compact = false,
}: {
  jds: JobDescription[];
  cost: number;
  onGenerate: (jd: JobDescription) => void;
  compact?: boolean;
}) {
  return (
    <section
      aria-labelledby={compact ? undefined : "ready-for-questions"}
      aria-label={compact ? "Ready for interview questions" : undefined}
      className={`rounded-2xl border border-outline-variant/30 bg-surface-container-lowest flex flex-col ${compact ? "p-sm" : "p-md gap-sm"}`}
    >
      {!compact && (
        <div>
          <h3 id="ready-for-questions" className="font-label-caps text-label-caps uppercase text-on-surface-variant">
            Ready for interview questions
          </h3>
          <p className="mt-xs text-caption text-on-surface-variant">
            A tailored résumé is saved to these jobs. Questions are built from it.
          </p>
        </div>
      )}
      <ul className="flex flex-col divide-y divide-outline-variant/25">
        {jds.map((j) => (
          <li key={j.id} className="flex items-center gap-sm py-xs first:pt-0 last:pb-0">
            <Link
              href={`/jd/${j.id}`}
              className="min-w-0 flex-1 truncate text-body-sm text-on-surface hover:text-primary hover:underline"
            >
              {compact && <span className="text-on-surface-variant">Ready: </span>}
              {j.title}
            </Link>
            <button
              type="button"
              onClick={() => onGenerate(j)}
              aria-label={`Generate interview questions for ${j.title}`}
              className={`shrink-0 inline-flex items-center gap-xs px-sm py-xs rounded-lg border border-primary/30 text-label-sm text-primary hover:bg-primary/5 transition-colors ${FOCUS_RING}`}
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

/**
 * The job in view: which one (the switcher), how far its practice has got
 * (the track — one mark per question, filled once practised, grouped by
 * topic), and what to do next. Regenerate asks first, inline: it replaces
 * the set (and its practice) and costs credits.
 */
function JobPanel({
  options,
  selected,
  questions,
  onSelect,
  onRegenerate,
  regenerating,
  error,
  cost,
  resumeChanged,
  answeredFollowups,
  practiceHref,
}: {
  options: JdOption[];
  selected: JdOption;
  questions: PrepQuestionWithJdOut[];
  onSelect: (jdId: string) => void;
  onRegenerate: () => void;
  regenerating: boolean;
  error: string | null;
  cost: number;
  resumeChanged: boolean;
  answeredFollowups: number;
  practiceHref: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const index = options.findIndex((o) => o.jd_id === selected.jd_id);
  const many = options.length > 1;
  const allDone = selected.total > 0 && selected.practiced === selected.total;
  const stepBtn = `w-10 h-10 shrink-0 rounded-lg border border-outline-variant/50 text-on-surface-variant flex items-center justify-center hover:bg-surface-container hover:text-on-surface disabled:opacity-40 disabled:pointer-events-none transition-colors ${FOCUS_RING}`;
  const groups = TABS.map((t) => questions.filter((q) => classifyTopic(q.topic) === t)).filter((g) => g.length > 0);

  return (
    <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-md sm:p-lg flex flex-col gap-md shadow-sm">
      <div className="flex items-center justify-between gap-sm">
        <label htmlFor="jd-switcher" className="font-label-caps text-label-caps uppercase text-on-surface-variant">
          Questions for
        </label>
        <div className="flex items-center gap-sm sm:gap-md">
          {many && (
            <span className="text-caption text-on-surface-variant tabular-nums">
              JD {index + 1} of {options.length}
            </span>
          )}
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={regenerating || confirming}
            className={`inline-flex items-center gap-xs rounded-md py-xs text-label-sm text-primary hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-default ${FOCUS_RING}`}
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
            className="w-full h-10 appearance-none truncate pl-sm sm:pl-md pr-xl rounded-lg border border-outline-variant/50 bg-surface text-body-md sm:text-body-lg text-on-surface font-semibold disabled:opacity-100 disabled:border-transparent disabled:bg-transparent disabled:pl-0 focus:outline-none focus:ring-2 focus:ring-primary/30"
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
        <div className="rounded-xl border border-primary/25 bg-primary-fixed/40 p-sm sm:p-md flex flex-col sm:flex-row sm:items-center gap-sm">
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
              className={`flex-1 sm:flex-none px-md py-xs rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-label-sm text-on-surface hover:bg-surface-container ${FOCUS_RING}`}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onRegenerate();
              }}
              className={`flex-1 sm:flex-none px-md py-xs rounded-lg bg-primary text-on-primary text-label-sm hover:bg-primary-container ${FOCUS_RING}`}
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
        <>
          {/* The track: one mark per question, filled once practised, in
              topic groups — the whole set's progress at a glance. */}
          <div className="flex flex-col gap-xs">
            <div className="flex items-center gap-sm" aria-hidden>
              {groups.map((group, gi) => (
                <div key={gi} className="flex flex-1 gap-0.5" style={{ flexGrow: group.length }}>
                  {group.map((q) => (
                    <span
                      key={q.id}
                      className={`h-1.5 flex-1 rounded-full ${q.practiced_at ? "bg-primary" : "bg-primary/15"}`}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-sm text-caption text-on-surface-variant">
              <span className="tabular-nums">
                {selected.practiced} of {selected.total} practiced
              </span>
              <Link
                href={`/jd/${selected.jd_id}`}
                className="inline-flex items-center gap-xs text-label-sm text-primary hover:underline"
              >
                View JD <ArrowRight size={12} />
              </Link>
            </div>
          </div>
          {practiceHref && (
            <Link
              href={practiceHref}
              className={`self-stretch sm:self-start inline-flex items-center justify-center gap-sm rounded-lg bg-primary px-lg py-sm text-label-md text-on-primary hover:bg-primary-container transition-colors ${FOCUS_RING}`}
            >
              <Play size={14} weight="fill" />
              {allDone ? "Practice again" : selected.practiced > 0 ? "Continue practice" : "Start practice"}
            </Link>
          )}
        </>
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

"use client";
import { use, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { QuestionCard, practiceSaveError } from "@/components/interview/QuestionCard";
import { TopicList } from "@/components/interview/TopicList";
import type { PrepQuestionOut, PrepQuestionWithJdOut } from "@career-copilot/types";
import Link from "next/link";
import { ArrowLeft, CaretLeft, CaretRight, Check, Flag } from "@phosphor-icons/react";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { settled, usePageReady } from "@/lib/reveal";

// Questions are walked topic by topic, in the Interview Center's tab order —
// the sidebar groups them that way, and Next stepping across topics in
// generation order made its highlight jump back and forth.
const TOPIC_ORDER = ["Technical", "Behavioral", "HR & Culture"];
const topicRank = (t: string) => {
  const i = TOPIC_ORDER.indexOf(t);
  return i === -1 ? TOPIC_ORDER.length : i;
};

export default function InterviewPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [activeIndex, setActiveIndex] = useState(0);
  // A "Mark as practiced" that didn't save — shown under the buttons while
  // that question is on screen.
  const [markError, setMarkError] = useState<{ id: string; message: string } | null>(null);

  const questionsQuery = useQuery<PrepQuestionOut[]>({
    queryKey: ["questions", sessionId],
    queryFn: () => apiClient.getQuestions(sessionId),
  });
  const rawQuestions = questionsQuery.data ?? [];
  const questions = [...rawQuestions].sort(
    (a, b) => topicRank(a.topic) - topicRank(b.topic) || a.order_index - b.order_index,
  );

  // Which job these are for — the Interview Center's list knows (and is
  // usually cached already).
  const myQuestionsQuery = useQuery<PrepQuestionWithJdOut[]>({
    queryKey: ["myQuestions"],
    queryFn: () => apiClient.getMyQuestions(),
  });
  const mine = myQuestionsQuery.data?.find((q) => q.session_id === sessionId);
  const jdTitle = mine?.jd_title ?? null;
  const jdId = searchParams.get("jd") ?? mine?.jd_id ?? null;
  const centerHref = jdId ? `/interview?jd=${encodeURIComponent(jdId)}` : "/interview";

  // "Practice This Question" on the overview page links here with ?q=<id> —
  // jump straight to that question once the list loads, instead of always
  // landing on index 0 regardless of which one was clicked.
  const targetId = searchParams.get("q");
  const [jumped, setJumped] = useState(false);
  useEffect(() => {
    if (jumped || !targetId || questions.length === 0) return;
    const idx = questions.findIndex((q) => q.id === targetId);
    if (idx !== -1) setActiveIndex(idx);
    setJumped(true);
  }, [questions, targetId, jumped]);

  // The job's title, the questions — already on the one linked to — and the
  // shell appear together (lib/reveal).
  const ready = usePageReady(
    settled(questionsQuery, myQuestionsQuery) && (!targetId || jumped || rawQuestions.length === 0),
  );

  const active = questions[activeIndex];
  const isLast = activeIndex === questions.length - 1;
  const practicedCount = questions.filter((q) => q.practiced_at).length;

  // Arrow keys step through the questions on a keyboard.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "ArrowRight") setActiveIndex((i) => Math.min(questions.length - 1, i + 1));
      if (e.key === "ArrowLeft") setActiveIndex((i) => Math.max(0, i - 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [questions.length]);

  async function markPracticed(qId: string) {
    const flip = (practiced_at: string | null) =>
      queryClient.setQueryData<PrepQuestionOut[]>(["questions", sessionId], (list) =>
        list?.map((q) => (q.id === qId ? { ...q, practiced_at } : q)),
      );
    setMarkError(null);
    flip(new Date().toISOString());
    try {
      const updated = await apiClient.markQuestionPracticed(qId);
      flip(updated.practiced_at);
    } catch (err) {
      console.error("Failed to mark question practiced:", err);
      flip(null);
      setMarkError({ id: qId, message: practiceSaveError() });
    } finally {
      queryClient.invalidateQueries({ queryKey: ["myQuestions"] });
    }
  }

  return (
    <div className="w-full min-w-0 max-w-[1440px] mx-auto p-gutter pb-xxl flex flex-col gap-section">
      {/* Page Header */}
      <section className="pt-xs sm:pt-lg sm:pb-md">
        <Link
          href={centerHref}
          className="mb-xs inline-flex items-center gap-xs text-label-sm text-on-surface-variant hover:text-primary"
        >
          <ArrowLeft size={14} /> Interview Center
        </Link>
        {ready ? (
          <>
            <h1 className="text-headline-md sm:text-headline-lg text-on-surface mb-xs">{jdTitle ?? "Interview Prep"}</h1>
            <p className="text-body-lg text-on-surface-variant">
              {`${questions.length} question${questions.length === 1 ? "" : "s"} · ${practicedCount} practiced`}
            </p>
          </>
        ) : (
          <div aria-hidden>
            <p className="text-headline-md sm:text-headline-lg mb-xs flex items-center">
              &#8203;<span className="skeleton h-[0.8em] w-64 max-w-full rounded-full" />
            </p>
            <p className="text-body-lg flex items-center">
              &#8203;<span className="skeleton h-[0.8em] w-44 rounded-full" />
            </p>
          </div>
        )}
      </section>

      {!ready ? (
        <div className="flex gap-gutter" aria-hidden>
          <div className="hidden sm:block w-48 lg:w-64 flex-shrink-0 space-y-sm">
            <div className="skeleton h-12 rounded-xl" />
            <div className="skeleton h-12 rounded-xl" />
          </div>
          <div className="skeleton flex-1 min-w-0 h-56 rounded-2xl" />
        </div>
      ) : questions.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center gap-lg py-xxl">
          <div className="w-16 h-16 rounded-full bg-secondary-container flex items-center justify-center">
            <CaretRight size={32} className="text-primary" />
          </div>
          <div className="text-center max-w-[24rem]">
            <h2 className="text-headline-md text-on-surface mb-sm">
              No questions here
            </h2>
            <p className="text-body-md text-on-surface-variant mb-lg">
              This set was replaced by a newer one, or removed. The job&apos;s current questions are in the
              Interview Center.
            </p>
            <button
              onClick={() => router.push(centerHref)}
              className="px-xl py-md rounded-lg text-label-md text-on-primary bg-primary hover:bg-primary-container transition-colors"
            >
              Open the Interview Center
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-gutter">
          {/* Topic sidebar — on phones, a chip strip above the question
              instead (inside the question column below). */}
          <aside className="hidden sm:block w-48 lg:w-64 flex-shrink-0">
            <p className="text-label-md text-on-surface-variant uppercase tracking-wider mb-md flex items-center gap-sm">
              Topics
              <InfoTooltip text="This job's questions, grouped by topic — pick one to jump straight to it." />
            </p>
            <TopicList
              questions={questions}
              activeIndex={activeIndex}
              onSelect={setActiveIndex}
            />
          </aside>

          {/* Question area */}
          <div className="flex-1 min-w-0 flex flex-col gap-md sm:gap-lg">
            <div className="sm:hidden">
              <TopicList
                layout="strip"
                questions={questions}
                activeIndex={activeIndex}
                onSelect={setActiveIndex}
              />
            </div>
            {active && (
              <>
                <div className="flex items-center gap-md">
                  <span className="text-label-md text-on-surface-variant shrink-0">
                    Question {activeIndex + 1} of {questions.length}
                  </span>
                  <div className="flex-1 h-1.5 bg-surface-variant rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{ width: `${((activeIndex + 1) / questions.length) * 100}%` }}
                    />
                  </div>
                </div>

                <QuestionCard key={active.id} question={active} practiced={!!active.practiced_at} />

                <div className="flex items-center gap-sm">
                  <button
                    onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                    disabled={activeIndex === 0}
                    aria-label="Previous question"
                    className="flex items-center justify-center gap-sm w-11 h-11 sm:w-auto sm:h-auto sm:px-lg sm:py-md rounded-lg border border-outline-variant text-label-md text-on-surface-variant hover:bg-surface-container-low transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  >
                    <CaretLeft size={16} /> <span className="hidden sm:inline">Previous</span>
                  </button>

                  {/* Saying an answer out loud is the practice — this records it. */}
                  <button
                    onClick={() => markPracticed(active.id)}
                    disabled={!!active.practiced_at}
                    className="flex-1 flex items-center justify-center gap-sm h-11 sm:h-auto px-md sm:py-md rounded-lg border border-outline-variant/50 text-label-md text-on-surface hover:bg-surface-container-low transition-colors disabled:border-success-accent/30 disabled:bg-success-accent/10 disabled:text-success-accent disabled:cursor-default"
                  >
                    <Check size={16} weight={active.practiced_at ? "bold" : "regular"} />
                    {active.practiced_at ? "Practiced" : "Mark as practiced"}
                  </button>

                  {isLast ? (
                    <Link
                      href={centerHref}
                      className="flex items-center justify-center gap-sm h-11 sm:h-auto px-md sm:px-lg sm:py-md rounded-lg text-label-md text-on-primary bg-primary hover:bg-primary-container transition-colors shrink-0"
                    >
                      <Flag size={16} /> Finish
                    </Link>
                  ) : (
                    <button
                      onClick={() => setActiveIndex((i) => Math.min(questions.length - 1, i + 1))}
                      aria-label="Next question"
                      className="flex items-center justify-center gap-sm w-11 h-11 sm:w-auto sm:h-auto sm:px-lg sm:py-md rounded-lg text-label-md text-on-primary bg-primary hover:bg-primary-container transition-colors shrink-0"
                    >
                      <span className="hidden sm:inline">Next</span> <CaretRight size={16} />
                    </button>
                  )}
                </div>
                {markError?.id === active.id && (
                  <p role="alert" className="-mt-xs sm:-mt-sm text-caption text-error">{markError.message}</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

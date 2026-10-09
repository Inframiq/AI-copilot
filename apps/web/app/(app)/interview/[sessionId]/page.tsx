"use client";
import { use, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { QuestionCard } from "@/components/interview/QuestionCard";
import { TopicList } from "@/components/interview/TopicList";
import type { PrepQuestionOut } from "@career-copilot/types";
import Link from "next/link";
import { ArrowLeft, CaretLeft, CaretRight } from "@phosphor-icons/react";
import { InfoTooltip } from "@/components/ui/InfoTooltip";

export default function InterviewPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeIndex, setActiveIndex] = useState(0);

  const { data: questions = [], isLoading } = useQuery<PrepQuestionOut[]>({
    queryKey: ["questions", sessionId],
    queryFn: () => apiClient.getQuestions(sessionId),
  });

  // "Practice This Question" on the overview page links here with ?q=<id> —
  // jump straight to that question once the list loads, instead of always
  // landing on index 0 regardless of which one was clicked.
  useEffect(() => {
    const targetId = searchParams.get("q");
    if (!targetId || questions.length === 0) return;
    const idx = questions.findIndex((q) => q.id === targetId);
    if (idx !== -1) setActiveIndex(idx);
  }, [questions, searchParams]);

  const active = questions[activeIndex];

  return (
    <div className="w-full min-w-0 max-w-[1440px] mx-auto p-gutter pb-xxl flex flex-col gap-section">
      {/* Page Header */}
      <section className="pt-xs sm:pt-lg sm:pb-md">
        <Link
          href="/interview"
          className="mb-xs inline-flex items-center gap-xs text-label-sm text-on-surface-variant hover:text-primary"
        >
          <ArrowLeft size={14} /> Interview Center
        </Link>
        <h1 className="text-headline-xl text-on-surface mb-xs">
          Interview Prep
        </h1>
        <p className="text-body-lg text-on-surface-variant">
          {isLoading
            ? "Loading questions…"
            : `${questions.length} question${questions.length === 1 ? "" : "s"} tailored to your profile`}
        </p>
      </section>

      {questions.length === 0 && !isLoading ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center gap-lg py-xxl">
          <div className="w-16 h-16 rounded-full bg-secondary-container flex items-center justify-center">
            <CaretRight size={32} className="text-primary" />
          </div>
          <div className="text-center max-w-[24rem]">
            <h2 className="text-headline-md text-on-surface mb-sm">
              No questions yet
            </h2>
            <p className="text-body-md text-on-surface-variant mb-lg">
              Tailor your résumé to a job in the JD Analyzer and Save to JD —
              your personalized interview questions are made from that save.
            </p>
            <button
              onClick={() => router.push("/dashboard")}
              className="px-xl py-md rounded-xl text-label-md text-on-primary bg-primary shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200"
            >
              Go to Dashboard
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
              <InfoTooltip text="All questions from this session, grouped by topic — pick one to jump straight to it." />
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
                <div className="flex items-center justify-between">
                  <span className="text-label-md text-on-surface-variant">
                    Question {activeIndex + 1} of {questions.length}
                  </span>
                  {/* Phones already show the topic on the chip and the card. */}
                  <span className="hidden sm:inline px-sm py-xs pill rounded-full bg-secondary-container text-on-secondary-container text-label-sm">
                    {active.topic}
                  </span>
                </div>

                <QuestionCard key={active.id} question={active} />

                <div className="flex items-center justify-between gap-sm">
                  <button
                    onClick={() =>
                      setActiveIndex((i) => Math.max(0, i - 1))
                    }
                    disabled={activeIndex === 0}
                    className="flex items-center gap-sm px-md py-sm sm:px-lg sm:py-md rounded-lg border border-outline-variant text-label-md text-on-surface-variant hover:bg-surface-container-low transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <CaretLeft size={16} /> Previous
                  </button>
                  <button
                    onClick={() =>
                      setActiveIndex((i) =>
                        Math.min(questions.length - 1, i + 1)
                      )
                    }
                    disabled={activeIndex === questions.length - 1}
                    className="flex items-center gap-sm px-md py-sm sm:px-lg sm:py-md rounded-lg text-label-md text-on-primary bg-primary hover:bg-primary-container transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next <CaretRight size={16} />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

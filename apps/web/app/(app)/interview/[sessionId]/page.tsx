"use client";
import { use, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { QuestionCard } from "@/components/interview/QuestionCard";
import { TopicList } from "@/components/interview/TopicList";
import type { PrepQuestionOut } from "@career-copilot/types";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";

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
    <div className="max-w-[1440px] mx-auto p-gutter pb-xxl flex flex-col gap-xl">
      {/* Page Header */}
      <section className="pt-xl pb-md">
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
              Go to the JD Analyzer, tailor a resume, and your personalized
              interview questions will appear here.
            </p>
            <button
              onClick={() => router.push("/dashboard")}
              className="px-xl py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-gutter">
          {/* Topic sidebar */}
          <aside className="w-64 flex-shrink-0">
            <p className="text-label-md text-on-surface-variant uppercase tracking-wider mb-md">
              Topics
            </p>
            <TopicList
              questions={questions}
              activeIndex={activeIndex}
              onSelect={setActiveIndex}
            />
          </aside>

          {/* Question area */}
          <div className="flex-1 flex flex-col gap-lg">
            {active && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-label-md text-on-surface-variant">
                    Question {activeIndex + 1} of {questions.length}
                  </span>
                  <span className="px-sm py-xs rounded-full bg-secondary-container text-on-secondary-container text-label-sm">
                    {active.topic}
                  </span>
                </div>

                <QuestionCard key={active.id} question={active} />

                <div className="flex items-center justify-between">
                  <button
                    onClick={() =>
                      setActiveIndex((i) => Math.max(0, i - 1))
                    }
                    disabled={activeIndex === 0}
                    className="flex items-center gap-sm px-lg py-md rounded-lg border border-outline-variant text-label-md text-on-surface-variant hover:bg-surface-container-low transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
                    className="flex items-center gap-sm px-lg py-md rounded-lg text-label-md text-on-primary bg-primary hover:bg-primary-container transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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

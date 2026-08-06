"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { useTailoringStore } from "@/stores/tailoring-store";
import { TopicList } from "@/components/interview/TopicList";
import { QuestionCard } from "@/components/interview/QuestionCard";
import type { PrepQuestionOut } from "@career-copilot/types";

export default function InterviewIndexPage() {
  const router = useRouter();
  const sessionId = useTailoringStore((s) => s.sessionId);
  const [activeIndex, setActiveIndex] = useState(0);

  const { data: questions = [], isLoading } = useQuery<PrepQuestionOut[]>({
    queryKey: ["questions", sessionId],
    queryFn: () => apiClient.getQuestions(sessionId!),
    enabled: sessionId !== null,
  });

  if (sessionId === null) {
    return (
      <div className="max-w-[1440px] mx-auto p-gutter pb-xxl flex flex-col gap-xl">
        <section className="pt-xl pb-md">
          <h1 className="text-headline-xl text-on-surface mb-xs">Interview Center</h1>
        </section>
        <div className="flex flex-col items-center justify-center gap-lg py-xxl">
          <div className="text-center max-w-sm">
            <h2 className="text-headline-md text-on-surface mb-sm">
              No tailoring session yet
            </h2>
            <p className="text-body-md text-on-surface-variant mb-lg">
              Analyze a job description and tailor your resume first to generate personalized interview questions.
            </p>
            <button
              onClick={() => router.push("/jd")}
              className="px-xl py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200"
            >
              Go to JD Analyzer
            </button>
          </div>
        </div>
      </div>
    );
  }

  const active = questions[activeIndex];

  return (
    <div className="max-w-[1440px] mx-auto p-gutter pb-xxl flex flex-col gap-xl">
      <section className="pt-xl pb-md">
        <h1 className="text-headline-xl text-on-surface mb-xs">Interview Center</h1>
        <p className="text-body-lg text-on-surface-variant">
          {isLoading
            ? "Loading questions…"
            : `${questions.length} question${questions.length === 1 ? "" : "s"} tailored to your profile`}
        </p>
      </section>

      {questions.length === 0 && !isLoading ? (
        <div className="flex flex-col items-center justify-center gap-lg py-xxl">
          <div className="text-center max-w-sm">
            <h2 className="text-headline-md text-on-surface mb-sm">No questions yet</h2>
            <p className="text-body-md text-on-surface-variant">
              No questions were generated for this session.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex gap-gutter">
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
                <QuestionCard question={active} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";
import type { PrepQuestionOut } from "@career-copilot/types";

/**
 * The session's topics, each jumping to its first question.
 *
 * "list" is the laptop's sidebar. "strip" is the same thing for phones: a
 * row of chips above the question — a 256px sidebar beside the card left a
 * 360px screen too narrow for the question, which ran off its right edge.
 */
export function TopicList({
  questions,
  activeIndex,
  onSelect,
  layout = "list",
}: {
  questions: PrepQuestionOut[];
  activeIndex: number;
  onSelect: (i: number) => void;
  layout?: "list" | "strip";
}) {
  const topics = [...new Set(questions.map((q) => q.topic))];
  const strip = layout === "strip";

  return (
    <div
      role="tablist"
      aria-label="Topics"
      className={
        strip
          ? "-mx-gutter flex gap-xs overflow-x-auto px-gutter pb-xs [scrollbar-width:none]"
          : "flex flex-col gap-sm"
      }
    >
      {topics.map((topic) => {
        const topicQs = questions.filter((q) => q.topic === topic);
        const isActive = topicQs.some(
          (q) => questions.indexOf(q) === activeIndex
        );
        return (
          <button
            key={topic}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(questions.indexOf(topicQs[0]))}
            className={
              strip
                ? `flex shrink-0 items-center gap-xs rounded-full border px-md py-xs text-label-sm transition-colors ${
                    isActive
                      ? "border-primary/30 bg-secondary-container text-primary"
                      : "border-outline-variant/40 text-on-surface-variant active:bg-surface-container-low"
                  }`
                : `text-left px-md py-md rounded-xl text-label-md font-label-md transition-colors ${
                    isActive
                      ? "bg-secondary-container text-primary"
                      : "text-on-surface-variant hover:bg-surface-container-low"
                  }`
            }
          >
            {strip ? (
              <>
                {topic}
                <span className="tabular text-caption opacity-70">{topicQs.length}</span>
              </>
            ) : (
              <span className="flex items-center gap-sm">
                <span className="w-2 h-2 rounded-full bg-current" />
                {topic}
                <span className="ml-auto text-caption">{topicQs.length}Q</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

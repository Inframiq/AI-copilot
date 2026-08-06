"use client";
import type { PrepQuestionOut } from "@career-copilot/types";

export function TopicList({
  questions,
  activeIndex,
  onSelect,
}: {
  questions: PrepQuestionOut[];
  activeIndex: number;
  onSelect: (i: number) => void;
}) {
  const topics = [...new Set(questions.map((q) => q.topic))];

  return (
    <div className="flex flex-col gap-sm">
      {topics.map((topic) => {
        const topicQs = questions.filter((q) => q.topic === topic);
        const isActive = topicQs.some(
          (q) => questions.indexOf(q) === activeIndex
        );
        return (
          <button
            key={topic}
            onClick={() => onSelect(questions.indexOf(topicQs[0]))}
            className={`text-left px-md py-md rounded-xl text-label-md font-label-md transition-colors ${
              isActive
                ? "bg-secondary-container text-primary"
                : "text-on-surface-variant hover:bg-surface-container-low"
            }`}
          >
            <span className="flex items-center gap-sm">
              <span className="w-2 h-2 rounded-full bg-current" />
              {topic}
              <span className="ml-auto text-caption">{topicQs.length}Q</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

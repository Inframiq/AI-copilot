"use client";
import { useState } from "react";
import type { PrepQuestionOut } from "@career-copilot/types";
import { Card } from "@/components/ui/Card";

export function QuestionCard({ question }: { question: PrepQuestionOut }) {
  const [flipped, setFlipped] = useState(false);

  return (
    <Card
      className="cursor-pointer min-h-[200px] flex flex-col justify-between"
      onClick={() => setFlipped((f) => !f)}
    >
      <div className="flex items-start justify-between mb-md">
        <span className="px-sm py-xs rounded-full bg-secondary-container text-on-secondary-container text-label-sm">
          {question.topic}
        </span>
      </div>

      {flipped ? (
        <div>
          <p className="text-label-md text-primary mb-sm uppercase tracking-wider">
            Answer Framework
          </p>
          <p className="text-body-md text-on-surface">{question.answer_framework}</p>
        </div>
      ) : (
        <p className="text-body-lg text-on-surface font-medium">
          {question.question}
        </p>
      )}

      <p className="text-caption text-on-surface-variant mt-md text-right">
        {flipped ? "Tap to see question" : "Tap to reveal answer framework"}
      </p>
    </Card>
  );
}

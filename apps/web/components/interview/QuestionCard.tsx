"use client";
import { useState } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";
import type { PrepQuestionOut } from "@career-copilot/types";
import { Card } from "@/components/ui/Card";

/** Where a question came from, as the label before its basis. */
export function sourceLabel(source: string): string {
  return source === "overlap" ? "From your resume:" : source === "gap" ? "Bridging a gap:" : "From the JD:";
}

/** The answer guide is "what a strong answer covers", then (from the
 * generator) "Likely follow-up: …" — shown as two parts. */
function splitGuide(text: string): { covers: string; followUp: string | null } {
  const i = text.search(/likely follow-up:/i);
  if (i === -1) return { covers: text.trim(), followUp: null };
  return {
    covers: text.slice(0, i).trim(),
    followUp: text.slice(i).replace(/^likely follow-up:\s*/i, "").trim() || null,
  };
}

/**
 * One question to answer out loud. The question stays on screen; the answer
 * guide opens beneath it on request — it used to replace the question when
 * the card flipped, so you couldn't read both.
 */
export function QuestionCard({ question, practiced }: { question: PrepQuestionOut; practiced: boolean }) {
  const [open, setOpen] = useState(false);
  const { covers, followUp } = splitGuide(question.answer_framework ?? "");
  const hasGuide = covers.length > 0 || followUp !== null;

  return (
    <Card className="flex flex-col gap-md">
      <div className="flex items-center justify-between gap-sm">
        <span className="px-sm py-xs pill rounded-full bg-secondary-container text-on-secondary-container text-label-sm">
          {question.topic}
        </span>
        {practiced && (
          <span className="inline-flex items-center gap-xs px-sm py-xs rounded-full bg-success-accent/10 text-success-accent text-label-sm">
            <Check size={12} weight="bold" /> Practiced
          </span>
        )}
      </div>

      <p className="text-body-lg sm:text-headline-md text-on-surface font-medium">{question.question}</p>

      {question.basis && (
        <p className="text-caption text-primary/80 flex items-start gap-xs">
          <span className="shrink-0 font-semibold">{sourceLabel(question.source)}</span>
          <span className="text-on-surface-variant">{question.basis}</span>
        </p>
      )}

      {hasGuide && (
        <div className="border-t border-outline-variant/30 pt-sm">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-xs py-xs -my-xs text-label-md text-primary hover:underline"
          >
            <CaretDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
            {open ? "Hide the answer guide" : "What a strong answer covers"}
          </button>
          {open && (
            <div className="mt-sm flex flex-col gap-sm">
              {covers && <p className="text-body-md text-on-surface">{covers}</p>}
              {followUp && (
                <p className="text-body-sm text-on-surface-variant">
                  <span className="font-semibold text-on-surface">Likely follow-up: </span>
                  {followUp}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

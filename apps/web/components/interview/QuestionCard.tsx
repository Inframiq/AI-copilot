"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CaretDown, Check, CircleNotch } from "@phosphor-icons/react";
import type { PrepFollowupOut, PrepQuestionOut, PrepQuestionWithJdOut, Subscription } from "@career-copilot/types";
import { apiClient } from "@/lib/api-client";
import { Card } from "@/components/ui/Card";
import { Sheet } from "@/components/ui/Sheet";
import { FOCUS_RING } from "@/lib/focus";

/** Where a question came from: the small label above or beside it, in the
 * Interview Center, on this card and in "Make interview questions?". */
export function questionSource(source: string): { label: string; tone: string } {
  if (source === "overlap") return { label: "From your résumé", tone: "text-primary" };
  if (source === "gap") return { label: "Bridging a gap", tone: "text-tertiary" };
  return { label: "From the job", tone: "text-secondary" };
}

/** What to say when "Mark as practiced" didn't save (the tick is undone). */
export function practiceSaveError(): string {
  return typeof navigator !== "undefined" && !navigator.onLine
    ? "You're offline — this wasn't marked as practiced. Try again once you're back online."
    : "Couldn't mark this as practiced — it wasn't saved. Try again.";
}

/** Older sets' answer guide is "what a strong answer covers", then (from the
 * generator) "Likely follow-up: …" — shown as two parts. */
function splitGuide(text: string): { covers: string; followUp: string | null } {
  const i = text.search(/likely follow-up:/i);
  if (i === -1) return { covers: text.trim(), followUp: null };
  return {
    covers: text.slice(0, i).trim(),
    followUp: text.slice(i).replace(/^likely follow-up:\s*/i, "").trim() || null,
  };
}

/** A likely answer is "Label: text" lines; the label is set in bold. */
export function AnswerLines({ text }: { text: string }) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return (
    <ul className="flex flex-col gap-sm">
      {lines.map((line, i) => {
        const m = line.match(/^([^:]{1,32}):\s+(.+)$/);
        return (
          <li key={i} className="text-body-md text-on-surface">
            {m ? (
              <>
                <span className="font-semibold">{m[1]}:</span> {m[2]}
              </>
            ) : (
              line
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Set once the cost notice has been accepted, so it shows only the first time.
const COST_SEEN_KEY = "kripax-followup-cost-seen";

function costSeen(): boolean {
  try {
    return localStorage.getItem(COST_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markCostSeen() {
  try {
    localStorage.setItem(COST_SEEN_KEY, "1");
  } catch {
    // Private mode or blocked storage: the notice shows again next time.
  }
}

/**
 * One question to answer out loud. The question stays on screen; its likely
 * answer opens beneath it on request, followed by the interviewer's next
 * question. A follow-up's answer is written (and charged) only when asked
 * for, and adds the follow-up after it.
 */
export function QuestionCard({ question, practiced }: { question: PrepQuestionOut; practiced: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  // Only for the price shown — the server charges what it charges.
  const { data: subscription } = useQuery<Subscription>({
    queryKey: ["subscription"],
    queryFn: () => apiClient.getSubscription(),
  });
  const cost = subscription?.costs?.followup_answer ?? 3;

  const likely = (question.likely_answer ?? "").trim();
  const { covers, followUp: legacyFollowUp } = splitGuide(question.answer_framework ?? "");
  const chain = question.followups ?? [];
  const hasGuide = likely.length > 0 || covers.length > 0 || chain.length > 0 || legacyFollowUp !== null;

  function setChain(next: PrepFollowupOut[]) {
    const patch = <T extends PrepQuestionOut>(list: T[] | undefined) =>
      list?.map((q) => (q.id === question.id ? { ...q, followups: next } : q));
    queryClient.setQueryData<PrepQuestionOut[]>(["questions", question.session_id], patch);
    queryClient.setQueryData<PrepQuestionWithJdOut[]>(["myQuestions"], patch);
  }

  async function answer(followupId: string) {
    setConfirming(null);
    setBusy(followupId);
    setError(null);
    try {
      setChain(await apiClient.answerFollowup(followupId));
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Couldn't write this answer. Try again.");
    } finally {
      setBusy(null);
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
    }
  }

  function requestAnswer(followupId: string) {
    if (costSeen()) void answer(followupId);
    else setConfirming(followupId);
  }

  return (
    <Card className="flex flex-col gap-md">
      <div className="flex items-center justify-between gap-sm">
        <span className="px-sm py-0.5 rounded-md bg-surface-container text-on-surface-variant text-label-sm">
          {question.topic}
        </span>
        {practiced && (
          <span className="inline-flex items-center gap-xs px-sm py-0.5 rounded-full bg-success-container text-on-success-container text-label-sm">
            <Check size={12} weight="bold" /> Practiced
          </span>
        )}
      </div>

      <div className="flex flex-col gap-xs">
        <p className="flex flex-wrap items-baseline gap-x-xs">
          <span className={`font-label-caps text-label-caps uppercase ${questionSource(question.source).tone}`}>
            {questionSource(question.source).label}
          </span>
          {question.basis && <span className="text-caption text-on-surface-variant">· {question.basis}</span>}
        </p>
        <p className="text-body-lg sm:text-[20px] sm:leading-snug text-on-surface font-medium">{question.question}</p>
      </div>

      {/* Shown before the answer: knowing what is being tested is part of
          answering well. Older sets have none. */}
      {question.interviewer_intent?.trim() && (
        <p className="text-body-sm flex items-start gap-xs rounded-lg bg-surface-container-low px-sm py-xs">
          <span className="shrink-0 font-semibold text-on-surface">What they&apos;re testing:</span>
          <span className="text-on-surface-variant">{question.interviewer_intent.trim()}</span>
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
            {likely
              ? open ? "Hide the likely answer" : "Show a likely answer"
              : open ? "Hide the answer guide" : "What a strong answer covers"}
          </button>
          {open && (
            <div className="mt-sm flex flex-col gap-md">
              {likely ? (
                <AnswerLines text={likely} />
              ) : (
                covers && <p className="text-body-md text-on-surface">{covers}</p>
              )}

              {chain.length > 0 ? (
                <ol className="flex flex-col gap-md" aria-label="Follow-up questions">
                  {chain.map((f) => (
                    <li key={f.id} className="border-l-2 border-primary/30 pl-md flex flex-col gap-xs">
                      <p className="text-label-sm text-on-surface-variant uppercase tracking-wider">
                        Follow-up {f.position}
                      </p>
                      <p className="text-body-md text-on-surface font-medium">{f.question}</p>
                      {f.answer ? (
                        <div className="pt-xs">
                          <AnswerLines text={f.answer} />
                        </div>
                      ) : busy === f.id ? (
                        <p role="status" className="inline-flex items-center gap-xs text-body-sm text-on-surface-variant">
                          <CircleNotch size={14} className="animate-spin motion-reduce:animate-none text-primary" />
                          Writing the answer…
                        </p>
                      ) : (
                        <button
                          type="button"
                          onClick={() => requestAnswer(f.id)}
                          disabled={busy !== null}
                          className="self-start inline-flex items-center gap-xs mt-xs px-md py-xs rounded-lg border border-primary/30 text-label-md text-primary hover:bg-primary/5 disabled:opacity-50"
                        >
                          Write a likely answer · {cost} credits
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                legacyFollowUp && (
                  <p className="text-body-sm text-on-surface-variant">
                    <span className="font-semibold text-on-surface">Likely follow-up: </span>
                    {legacyFollowUp}
                  </p>
                )
              )}
              {error && <p role="alert" className="text-caption text-error">{error}</p>}
            </div>
          )}
        </div>
      )}

      {confirming && (
        <FollowupCostDialog
          cost={cost}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            markCostSeen();
            void answer(confirming);
          }}
        />
      )}
    </Card>
  );
}

/** Shown the first time a follow-up answer is asked for: what it costs. */
function FollowupCostDialog({
  cost, onCancel, onConfirm,
}: { cost: number; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Sheet labelledBy="followup-cost-title" describedBy="followup-cost-help" onClose={onCancel}>
      <div className="px-md sm:px-lg pt-md sm:pt-lg pb-md sm:pb-lg flex flex-col gap-md">
        <div className="pr-xl">
          <p className="font-label-caps text-label-caps uppercase text-primary">Follow-up answer</p>
          <h2 id="followup-cost-title" className="mt-sm text-headline-md text-on-surface">
            Follow-up answers use credits
          </h2>
          <p id="followup-cost-help" className="mt-xs text-body-sm text-on-surface-variant">
            Written from your résumé for this job, with the next follow-up an interviewer is likely to ask.
            Asked only this once.
          </p>
        </div>
        <div className="flex items-center justify-between gap-md border-y border-outline-variant/40 py-sm">
          <span className="text-body-sm text-on-surface">Each answer</span>
          <span className="text-label-md text-on-surface tabular-nums">{cost} credits</span>
        </div>
        <div className="flex gap-sm">
          <button
            type="button"
            onClick={onCancel}
            className={`flex-1 py-sm rounded-lg border border-outline-variant/50 text-label-md text-on-surface hover:bg-surface-container ${FOCUS_RING}`}
          >
            Cancel
          </button>
          <button
            type="button"
            data-autofocus
            onClick={onConfirm}
            className={`flex-[1.4] py-sm rounded-lg bg-primary text-on-primary text-label-md font-semibold hover:bg-primary-container ${FOCUS_RING}`}
          >
            Write answer · {cost} credits
          </button>
        </div>
      </div>
    </Sheet>
  );
}

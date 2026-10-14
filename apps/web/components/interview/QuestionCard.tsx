"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CaretDown, Check, CircleNotch, Coins, X } from "@phosphor-icons/react";
import type { PrepFollowupOut, PrepQuestionOut, PrepQuestionWithJdOut, Subscription } from "@career-copilot/types";
import { apiClient } from "@/lib/api-client";
import { Card } from "@/components/ui/Card";

/** Where a question came from, as the label before its basis. */
export function sourceLabel(source: string): string {
  return source === "overlap" ? "From your resume:" : source === "gap" ? "Bridging a gap:" : "From the JD:";
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-on-surface/30 backdrop-blur-sm" onClick={onCancel} />
      <div className="fixed inset-0 z-[71] flex items-end sm:items-center justify-center p-sm sm:p-lg pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="followup-cost-title"
          aria-describedby="followup-cost-help"
          className="pointer-events-auto w-full max-w-[28rem] bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-2xl"
        >
          <div className="p-md sm:p-lg pb-sm flex items-start gap-md">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Coins size={20} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 id="followup-cost-title" className="text-headline-md text-on-surface font-semibold">
                Follow-up answers use credits
              </h2>
              <p id="followup-cost-help" className="text-body-sm text-on-surface-variant mt-xs">
                Each follow-up answer costs {cost} credits. It is written from your résumé for this job and
                adds the next follow-up an interviewer is likely to ask.
              </p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              aria-label="Close"
              className="shrink-0 p-xs -m-xs rounded-full text-on-surface-variant hover:bg-surface-container-high/50"
            >
              <X size={18} />
            </button>
          </div>
          <div className="p-md sm:p-lg pt-sm flex gap-sm">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-sm rounded-xl border border-outline-variant/40 text-label-md text-on-surface hover:bg-surface-container"
            >
              Cancel
            </button>
            <button
              type="button"
              autoFocus
              onClick={onConfirm}
              className="flex-1 py-sm rounded-xl bg-primary text-on-primary text-label-md font-semibold hover:opacity-90"
            >
              Write answer · {cost} credits
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

"use client";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Microphone, X } from "@phosphor-icons/react";
import type { JDDetails, Subscription } from "@career-copilot/types";
import { apiClient } from "@/lib/api-client";
import { FOCUS_RING } from "@/lib/focus";
import {
  clearPrepQuestionsOffer,
  startPrepQuestions,
  usePrepQuestionsStore,
} from "@/stores/prep-questions-store";

/**
 * Asks, after Save to JD or Export, whether to make the job's interview
 * questions. A set costs credits, and saving or exporting used to make one
 * unasked for every job. Anything but yes — Not now, the X, Escape, a click
 * outside — means no; the job's page can still make them later.
 *
 * Not shown when the run this résumé came from already has a set: asking
 * again would return that set free and change nothing.
 */
export function PrepQuestionsOffer() {
  const queryClient = useQueryClient();
  const offer = usePrepQuestionsStore((s) => s.offer);
  const { data: details } = useQuery<JDDetails>({
    queryKey: ["jdDetails", offer?.jdId],
    queryFn: () => apiClient.getJdDetails(offer!.jdId),
    enabled: !!offer,
  });
  const { data: subscription } = useQuery<Subscription>({
    queryKey: ["subscription"],
    queryFn: () => apiClient.getSubscription(),
    enabled: !!offer,
  });

  // A job has one set. The server returns the existing one free when it was
  // written from this saved résumé, or hangs off this very run; otherwise a
  // new set replaces it.
  const run = offer?.sessionId ?? details?.session_id ?? null;
  const existing = details?.questions_total ?? 0;
  const hasSet =
    !!details && existing > 0 && (details.questions_match_resume === true || details.questions_session_id === run);
  const replaces = !!details && existing > 0 && !hasSet;
  const practiced = details?.questions_practiced ?? 0;

  useEffect(() => {
    if (offer && hasSet) clearPrepQuestionsOffer();
  }, [offer, hasSet]);

  useEffect(() => {
    if (!offer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && clearPrepQuestionsOffer();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [offer]);

  if (!offer || !details || hasSet) return null;

  // Only for what is shown — the server charges what it charges.
  const cost = subscription?.costs?.prep_questions ?? 5;
  const balance = subscription?.credits_remaining ?? null;
  const short = balance !== null && balance < cost;

  function accept() {
    if (!offer) return;
    clearPrepQuestionsOffer();
    void startPrepQuestions(queryClient, offer.jdId, {
      sessionId: offer.sessionId,
      title: offer.title,
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-on-surface/30 backdrop-blur-sm" onClick={clearPrepQuestionsOffer} />
      <div className="fixed inset-0 z-[71] flex items-end sm:items-center justify-center p-sm sm:p-lg pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="prep-offer-title"
          aria-describedby="prep-offer-help"
          className="pointer-events-auto w-full max-w-[28rem] bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-2xl"
        >
          <div className="p-md sm:p-lg pb-sm flex items-start gap-md">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Microphone size={20} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 id="prep-offer-title" className="text-headline-md text-on-surface font-semibold">
                Make interview questions for this job?
              </h2>
              <p id="prep-offer-help" className="text-body-sm text-on-surface-variant mt-xs">
                Up to 15 questions{offer.title ? ` for ${offer.title}` : ""}, each with a likely answer built from
                this résumé. Costs {cost} credits. They can also be made later from the job&apos;s page.
              </p>
              {replaces && (
                <p className="text-caption text-on-surface mt-xs">
                  Replaces this job&apos;s current {existing} question{existing !== 1 ? "s" : ""}, made from an
                  earlier résumé
                  {practiced > 0 ? ` (${practiced} practiced)` : ""}; their
                  practice progress and written follow-up answers are lost.
                </p>
              )}
              {balance !== null && (
                <p className={`text-caption mt-xs ${short ? "text-error" : "text-on-surface-variant"}`}>
                  {short
                    ? `Not enough credits: ${cost} needed, ${balance} left.`
                    : `Balance: ${balance} credit${balance !== 1 ? "s" : ""}.`}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={clearPrepQuestionsOffer}
              aria-label="Close"
              className={`shrink-0 p-xs -m-xs rounded-full text-on-surface-variant hover:bg-surface-container-high/50 ${FOCUS_RING}`}
            >
              <X size={18} />
            </button>
          </div>
          <div className="p-md sm:p-lg pt-sm flex gap-sm">
            <button
              type="button"
              onClick={clearPrepQuestionsOffer}
              className={`flex-1 py-sm rounded-xl border border-outline-variant/40 text-label-md text-on-surface hover:bg-surface-container ${FOCUS_RING}`}
            >
              Not now
            </button>
            <button
              type="button"
              onClick={accept}
              disabled={short}
              className={`flex-1 py-sm rounded-xl bg-primary text-on-primary text-label-md font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS_RING}`}
            >
              Make questions · {cost} credits
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

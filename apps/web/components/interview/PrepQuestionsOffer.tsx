"use client";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { JDDetails, Subscription } from "@career-copilot/types";
import { apiClient } from "@/lib/api-client";
import { FOCUS_RING } from "@/lib/focus";
import { Sheet } from "@/components/ui/Sheet";
import { PremiumOffer } from "@/components/plans/PremiumOffer";
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
    <Sheet labelledBy="prep-offer-title" describedBy="prep-offer-help" onClose={clearPrepQuestionsOffer}>
      <div className="px-md sm:px-lg pt-md sm:pt-lg pb-md sm:pb-lg flex flex-col gap-md">
        <div className="pr-xl">
          <p className="font-label-caps text-label-caps uppercase text-primary">Interview prep</p>
          <h2 id="prep-offer-title" className="mt-sm text-headline-md text-on-surface">
            Make interview questions?
          </h2>
          <p id="prep-offer-help" className="mt-xs text-body-sm text-on-surface-variant">
            {offer.title ? <>For <span className="text-on-surface font-medium">{offer.title}</span>, b</> : "B"}uilt
            from the résumé you saved for it. They can also be made later from the job&apos;s page.
          </p>
        </div>

        {/* What the set is: the three kinds the Interview Center labels. */}
        <ul className="rounded-xl bg-surface-container-low p-sm sm:p-md flex flex-col gap-sm" aria-label="What the set covers">
          {KINDS.map((k) => (
            <li key={k.label} className="flex items-baseline gap-sm">
              <span className={`h-2 w-2 shrink-0 rounded-full ${k.dot}`} aria-hidden />
              <span className="min-w-0 text-body-sm">
                <span className="text-on-surface font-medium">{k.label}</span>
                <span className="text-on-surface-variant"> — {k.detail}</span>
              </span>
            </li>
          ))}
          <li className="pt-xs border-t border-outline-variant/40 text-caption text-on-surface-variant">
            Up to 15 questions, each with a likely answer and the interviewer&apos;s follow-up.
          </li>
        </ul>

        {replaces && (
          <p className="rounded-xl border border-tertiary/30 bg-tertiary-fixed/40 px-md py-sm text-body-sm text-on-surface">
            Replaces this job&apos;s current {existing} question{existing !== 1 ? "s" : ""}, made from an earlier
            résumé{practiced > 0 ? ` (${practiced} practiced)` : ""}; their practice progress and written follow-up
            answers are lost.
          </p>
        )}

        {/* The cost, and what it leaves. */}
        <div className="flex items-center justify-between gap-md border-y border-outline-variant/40 py-sm">
          <span className="text-body-sm text-on-surface">Costs</span>
          <span className="text-right tabular-nums">
            <span className="block text-label-md text-on-surface">{cost} credits</span>
            {balance !== null && (
              <span className={`block text-caption ${short ? "text-error" : "text-on-surface-variant"}`}>
                {short ? `You have ${balance} · ${cost - balance} short` : `${balance} → ${balance - cost} left after`}
              </span>
            )}
          </span>
        </div>

        {short ? (
          <>
            <PremiumOffer subscription={subscription} onNavigate={clearPrepQuestionsOffer} />
            <button
              type="button"
              onClick={clearPrepQuestionsOffer}
              className={`self-center px-md py-xs rounded-lg text-label-md text-on-surface-variant hover:text-on-surface ${FOCUS_RING}`}
            >
              Not now
            </button>
          </>
        ) : (
          <div className="flex gap-sm">
            <button
              type="button"
              onClick={clearPrepQuestionsOffer}
              className={`flex-1 py-sm rounded-lg border border-outline-variant/50 text-label-md text-on-surface hover:bg-surface-container ${FOCUS_RING}`}
            >
              Not now
            </button>
            <button
              type="button"
              onClick={accept}
              data-autofocus
              className={`flex-[1.4] py-sm rounded-lg bg-primary text-on-primary text-label-md font-semibold hover:bg-primary-container ${FOCUS_RING}`}
            >
              Make questions · {cost} credits
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

// The three kinds of question in a set — the same labels and colours the
// Interview Center puts above each question.
const KINDS = [
  { label: "From your résumé", detail: "deep dives on your projects and numbers", dot: "bg-primary" },
  { label: "From the job", detail: "scenarios this role handles day to day", dot: "bg-secondary" },
  { label: "Bridging a gap", detail: "what the job wants that your résumé doesn't show yet", dot: "bg-tertiary" },
];

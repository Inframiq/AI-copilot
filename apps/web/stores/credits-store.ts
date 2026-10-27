import { create } from "zustand";

/**
 * An action the server refused for lack of credits (HTTP 402 "Out of
 * credits: …"), for OutOfCreditsDialog. The refusal still reaches the
 * caller as an error, so its own message shows where the action was; this
 * adds the one place that says what to do about it.
 */
export interface CreditRefusal {
  /** "Tailoring a résumé", "Interview questions", … — as the server named it. */
  action: string;
  cost: number | null;
  have: number | null;
}

export const useCreditsStore = create<{ refusal: CreditRefusal | null }>(() => ({ refusal: null }));

const OUT_OF_CREDITS = /^Out of credits: (.+?) costs (\d+) credits? and you have (\d+)\.?$/;

/** Records a 402 detail when it is the server's out-of-credits refusal;
 * anything else (an inactive subscription, say) is left to the caller. */
export function reportCreditRefusal(detail: unknown): void {
  if (typeof detail !== "string") return;
  const m = detail.match(OUT_OF_CREDITS);
  if (!m) return;
  useCreditsStore.setState({ refusal: { action: m[1], cost: Number(m[2]), have: Number(m[3]) } });
}

export function clearCreditRefusal(): void {
  useCreditsStore.setState({ refusal: null });
}

import { create } from "zustand";

/**
 * An action the server refused for credits (HTTP 402), for
 * OutOfCreditsDialog: not enough left ("Out of credits: …"), or a plan that
 * is no longer active. The refusal still reaches the caller as an error, so
 * its own message shows where the action was; this adds the one place that
 * says what to do about it — upgrade on Free, renew on Premium.
 */
export type CreditRefusal =
  | {
      kind: "credits";
      /** "Tailoring a résumé", "Interview questions", … — as the server named it. */
      action: string;
      cost: number | null;
      have: number | null;
    }
  | { kind: "inactive" };

export const useCreditsStore = create<{ refusal: CreditRefusal | null }>(() => ({ refusal: null }));

const OUT_OF_CREDITS = /^Out of credits: (.+?) costs (\d+) credits? and you have (\d+)\.?$/;
const INACTIVE = /^Your subscription is not active\.?$/;

/** Records a 402 detail when it is one of the server's credit refusals;
 * anything else is left to the caller. */
export function reportCreditRefusal(detail: unknown): void {
  if (typeof detail !== "string") return;
  if (INACTIVE.test(detail)) {
    useCreditsStore.setState({ refusal: { kind: "inactive" } });
    return;
  }
  const m = detail.match(OUT_OF_CREDITS);
  if (!m) return;
  useCreditsStore.setState({ refusal: { kind: "credits", action: m[1], cost: Number(m[2]), have: Number(m[3]) } });
}

export function clearCreditRefusal(): void {
  useCreditsStore.setState({ refusal: null });
}

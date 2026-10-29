import { create } from "zustand";

/**
 * Counts the server's refusals of a feature that needs agreement to a newer
 * Terms or Privacy Policy (403 "policy_update_required", apps/api
 * app/core/policy.py). PolicyUpdatePrompt checks the agreement again on
 * each one, so the prompt appears even when its first check failed or a
 * click beat it.
 */
export const usePolicyStore = create<{ refusals: number }>(() => ({ refusals: 0 }));

export const POLICY_UPDATE_REQUIRED = "policy_update_required";

/** Records the refusal when a 403's detail is the server's policy one. */
export function reportPolicyRefusal(detail: unknown): void {
  if (detail && typeof detail === "object" && (detail as { code?: unknown }).code === POLICY_UPDATE_REQUIRED) {
    usePolicyStore.setState((s) => ({ refusals: s.refusals + 1 }));
  }
}

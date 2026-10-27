import { create } from "zustand";
import type { QueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

/**
 * Interview prep questions being made right now, by JD.
 *
 * A tailored résumé saved to its JD is what they are made from. After Save
 * to JD or Export the Studio asks whether to make them (they cost credits);
 * a yes starts the request and nobody awaits it, so the user can carry on.
 * Held here, outside any page, so it survives navigation —
 * the JD page and the Interview Center read it to say "preparing", and every
 * list of questions is refreshed the moment the request comes back. Before,
 * a server background task did this out of sight, and the lists stayed empty
 * until something happened to fetch them again.
 */
interface PrepQuestionsState {
  /** jdId → the JD's title, for "Preparing questions for …". */
  pending: Record<string, string>;
  /** jdId → why the last attempt failed. */
  errors: Record<string, string>;
  /** A JD whose saved résumé could get a question set: the Studio asks
   * (components/interview/PrepQuestionsOffer.tsx). A set costs credits, so
   * saving or exporting no longer makes one unasked. */
  offer: PrepQuestionsOfferTarget | null;
}

export interface PrepQuestionsOfferTarget {
  jdId: string;
  /** The tailoring run the saved résumé came from, when known. */
  sessionId: string | null;
  title: string;
}

export const usePrepQuestionsStore = create<PrepQuestionsState>(() => ({
  pending: {},
  errors: {},
  offer: null,
}));

/** Ask whether to make this JD's interview questions. */
export function offerPrepQuestions(target: PrepQuestionsOfferTarget): void {
  usePrepQuestionsStore.setState({ offer: target });
}

/** The question was answered, or no longer applies. */
export function clearPrepQuestionsOffer(): void {
  usePrepQuestionsStore.setState({ offer: null });
}

/** Make (or fetch the existing) interview questions for a saved JD — or,
 * with `regenerate`, a new set in place of the existing one. Resolves once
 * they exist; never rejects — a failure is kept in `errors` (and a failed
 * regenerate leaves the old set). A second call while one is running for the
 * same JD is a no-op. */
export async function startPrepQuestions(
  queryClient: QueryClient,
  jdId: string,
  opts: { sessionId?: string | null; title?: string; regenerate?: boolean } = {},
): Promise<void> {
  const { pending } = usePrepQuestionsStore.getState();
  if (jdId in pending) return;
  usePrepQuestionsStore.setState((s) => {
    const errors = { ...s.errors };
    delete errors[jdId];
    return { pending: { ...s.pending, [jdId]: opts.title ?? "" }, errors };
  });
  try {
    const sessionId = opts.sessionId ?? undefined;
    await (opts.regenerate
      ? apiClient.generateJdPrepQuestions(jdId, sessionId, { regenerate: true })
      : apiClient.generateJdPrepQuestions(jdId, sessionId));
  } catch (err) {
    usePrepQuestionsStore.setState((s) => ({
      errors: {
        ...s.errors,
        [jdId]: err instanceof Error ? err.message : "Couldn't make interview questions. Try again.",
      },
    }));
  } finally {
    usePrepQuestionsStore.setState((s) => {
      const next = { ...s.pending };
      delete next[jdId];
      return { pending: next };
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["jdDetails", jdId] }),
      queryClient.invalidateQueries({ queryKey: ["myQuestions"] }),
      // A practice page's list (a regenerated set replaces it).
      queryClient.invalidateQueries({ queryKey: ["questions"] }),
      // Making a set costs credits.
      queryClient.invalidateQueries({ queryKey: ["subscription"] }),
    ]);
  }
}

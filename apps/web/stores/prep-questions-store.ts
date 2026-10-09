import { create } from "zustand";
import type { QueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

/**
 * Interview prep questions being made right now, by JD.
 *
 * Saving a tailored résumé to its JD is what makes them: the Studio starts
 * the request the moment the save succeeds and nobody awaits it, so the user
 * can carry on. Held here, outside any page, so it survives navigation —
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
}

export const usePrepQuestionsStore = create<PrepQuestionsState>(() => ({
  pending: {},
  errors: {},
}));

/** Make (or fetch the existing) interview questions for a saved JD. Resolves
 * once they exist; never rejects — a failure is kept in `errors`. A second
 * call while one is running for the same JD is a no-op. */
export async function startPrepQuestions(
  queryClient: QueryClient,
  jdId: string,
  opts: { sessionId?: string | null; title?: string } = {},
): Promise<void> {
  const { pending } = usePrepQuestionsStore.getState();
  if (jdId in pending) return;
  usePrepQuestionsStore.setState((s) => {
    const errors = { ...s.errors };
    delete errors[jdId];
    return { pending: { ...s.pending, [jdId]: opts.title ?? "" }, errors };
  });
  try {
    await apiClient.generateJdPrepQuestions(jdId, opts.sessionId ?? undefined);
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
    ]);
  }
}

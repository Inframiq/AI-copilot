import { create } from "zustand";
import type { Resume } from "@career-copilot/types";

/**
 * The one field we ask about after a résumé upload: the headline under the
 * name. It's the line the parser gets wrong most (or finds none), and it's
 * short enough to confirm at a glance — so the person checks it once, then
 * and there, instead of finding it wrong later in Studio or on the profile.
 *
 * `confirmHeadline` opens the app-wide popup (HeadlineConfirmModal, mounted
 * in app/providers.tsx) and resolves with the résumé as saved — the same
 * one back if they kept the headline or skipped. With no popup mounted
 * (tests, a page outside the providers) it resolves straight away.
 *
 * A read not saved yet (the Profile's upload: id "") isn't saved by the
 * popup either; the headline chosen comes back in its content, saved with
 * the profile.
 */

/** What the popup needs: a saved résumé, or an upload as read (id ""). */
export type HeadlineSubject = Pick<Resume, "id" | "content"> & Partial<Pick<Resume, "updated_at">>;

interface State {
  resume: HeadlineSubject | null;
  resolve: ((resume: HeadlineSubject) => void) | null;
  mounted: number;
}

export const useHeadlineConfirmStore = create<State>(() => ({ resume: null, resolve: null, mounted: 0 }));

export function confirmHeadline<T extends HeadlineSubject>(resume: T): Promise<T> {
  if (useHeadlineConfirmStore.getState().mounted === 0) return Promise.resolve(resume);
  // Only one popup on screen: an earlier ask still open keeps its résumé.
  const open = useHeadlineConfirmStore.getState();
  open.resolve?.(open.resume as HeadlineSubject);
  return new Promise((resolve) => {
    useHeadlineConfirmStore.setState({
      resume,
      resolve: (saved) => {
        useHeadlineConfirmStore.setState({ resume: null, resolve: null });
        resolve(saved as T);
      },
    });
  });
}

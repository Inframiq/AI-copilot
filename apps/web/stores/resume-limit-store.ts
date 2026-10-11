import { create } from "zustand";

/**
 * The 5-résumé limit, asked about instead of enforced silently.
 *
 * Creating a résumé past the limit is refused by the server (409, code
 * "resume_limit") with every résumé and which should go. `withResumeRoom`
 * wraps a create: on that refusal it opens the app-wide popup
 * (ResumeLimitModal, mounted in app/providers.tsx), waits while the user
 * exports and/or picks what to delete, and — once the popup has deleted
 * them — runs the create again. Cancel ends it with ResumeLimitCancelled,
 * which callers treat as "nothing happened" rather than an error.
 */

export interface LimitResume {
  id: string;
  title: string;
  updated_at: string | null;
  template_id: string;
  is_master: boolean;
  jd_title: string | null;
}

export interface ResumeLimitInfo {
  code: "resume_limit";
  message: string;
  limit: number;
  need: number;
  suggested: string[];
  resumes: LimitResume[];
}

interface State {
  info: ResumeLimitInfo | null;
  resolve: ((madeRoom: boolean) => void) | null;
}

export const useResumeLimitStore = create<State>(() => ({ info: null, resolve: null }));

export class ResumeLimitCancelled extends Error {
  constructor() {
    super("No résumé was added — none was deleted.");
    this.name = "ResumeLimitCancelled";
  }
}

export function isResumeLimitCancelled(e: unknown): e is ResumeLimitCancelled {
  return e instanceof ResumeLimitCancelled;
}

/** The server's refusal, if this error is one. (Duck-typed: this module is
 * imported by the API client, so it can't import ApiError back.) */
export function resumeLimitOf(e: unknown): ResumeLimitInfo | null {
  if (!e || typeof e !== "object") return null;
  const { status, detail } = e as { status?: number; detail?: unknown };
  if (status !== 409 || !detail || typeof detail !== "object") return null;
  return (detail as { code?: string }).code === "resume_limit" ? (detail as ResumeLimitInfo) : null;
}

/** Open the popup; resolves true once it has deleted enough to make room,
 * false if the user cancelled. */
export function askForResumeRoom(info: ResumeLimitInfo): Promise<boolean> {
  // A second ask while one is open (two creates at once) answers the first
  // as cancelled — only one popup is ever on screen.
  useResumeLimitStore.getState().resolve?.(false);
  return new Promise((resolve) => {
    useResumeLimitStore.setState({
      info,
      resolve: (madeRoom) => {
        useResumeLimitStore.setState({ info: null, resolve: null });
        resolve(madeRoom);
      },
    });
  });
}

/** Run a résumé create; if the limit refuses it, ask, then try again. */
export async function withResumeRoom<T>(create: () => Promise<T>): Promise<T> {
  // A few rounds at most: each round deletes at least what the server said
  // it needed, so a second refusal only happens if something else created a
  // résumé meanwhile.
  for (let round = 0; round < 3; round++) {
    try {
      return await create();
    } catch (e) {
      const info = resumeLimitOf(e);
      if (!info) throw e;
      if (!(await askForResumeRoom(info))) throw new ResumeLimitCancelled();
    }
  }
  return create();
}

import { create } from "zustand";
import { TOUR_STEPS } from "@/components/tour/tour-steps";

// Recorded once the user has finished or skipped the tour. Nothing reads
// this today — both trigger paths (onboarding's one-time redirect, and the
// Account page's "Replay guide" link) intentionally start the tour
// unconditionally rather than checking it. It exists so a future entry
// point (e.g. an automatic dashboard prompt outside the onboarding flow)
// has a "have they already seen this" signal to check without adding new
// storage wiring.
const SEEN_KEY = "career-copilot-tour-seen";

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // best-effort — nothing else to do if storage is unavailable
  }
}

interface TourState {
  active: boolean;
  stepIndex: number;
  start: () => void;
  next: () => void;
  prev: () => void;
  skip: () => void;
}

export const useTourStore = create<TourState>((set, get) => ({
  active: false,
  stepIndex: 0,

  start: () => set({ active: true, stepIndex: 0 }),

  next: () => {
    const { stepIndex } = get();
    if (stepIndex >= TOUR_STEPS.length - 1) {
      markSeen();
      set({ active: false, stepIndex: 0 });
      return;
    }
    set({ stepIndex: stepIndex + 1 });
  },

  prev: () => set((s) => ({ stepIndex: Math.max(0, s.stepIndex - 1) })),

  skip: () => {
    markSeen();
    set({ active: false, stepIndex: 0 });
  },
}));

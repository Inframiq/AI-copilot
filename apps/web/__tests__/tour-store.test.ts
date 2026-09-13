// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { useTourStore } from "../stores/tour-store";
import { TOUR_STEPS } from "../components/tour/tour-steps";

const SEEN_KEY = "career-copilot-tour-seen";

describe("useTourStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useTourStore.setState({ active: false, stepIndex: 0 });
  });

  it("starts inactive at step 0", () => {
    expect(useTourStore.getState().active).toBe(false);
    expect(useTourStore.getState().stepIndex).toBe(0);
  });

  it("start() activates the tour at step 0", () => {
    useTourStore.getState().start();
    expect(useTourStore.getState().active).toBe(true);
    expect(useTourStore.getState().stepIndex).toBe(0);
  });

  it("next() advances stepIndex without ending the tour mid-way", () => {
    useTourStore.getState().start();
    useTourStore.getState().next();
    expect(useTourStore.getState().active).toBe(true);
    expect(useTourStore.getState().stepIndex).toBe(1);
  });

  it("next() on the last step ends the tour and marks it seen", () => {
    useTourStore.setState({ active: true, stepIndex: TOUR_STEPS.length - 1 });
    useTourStore.getState().next();
    expect(useTourStore.getState().active).toBe(false);
    expect(localStorage.getItem(SEEN_KEY)).toBe("1");
  });

  it("prev() never goes below step 0", () => {
    useTourStore.setState({ active: true, stepIndex: 0 });
    useTourStore.getState().prev();
    expect(useTourStore.getState().stepIndex).toBe(0);
  });

  it("skip() ends the tour immediately and marks it seen", () => {
    useTourStore.setState({ active: true, stepIndex: 2 });
    useTourStore.getState().skip();
    expect(useTourStore.getState().active).toBe(false);
    expect(useTourStore.getState().stepIndex).toBe(0);
    expect(localStorage.getItem(SEEN_KEY)).toBe("1");
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

import { GuidedTour } from "../../components/tour/GuidedTour";
import { useTourStore } from "../../stores/tour-store";
import { TOUR_STEPS } from "../../components/tour/tour-steps";

const SEEN_KEY = "career-copilot-tour-seen";

// jsdom's getBoundingClientRect always returns zeros, which GuidedTour
// treats as "target not found/hidden" (its mobile-detection signal) — stub
// it so a spotlighted target measures as a real, visible element.
function stubBoundingRect() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top: 100,
    left: 20,
    width: 240,
    height: 48,
    bottom: 148,
    right: 260,
    x: 20,
    y: 100,
    toJSON: () => ({}),
  });
}

function renderTargets() {
  const container = document.createElement("div");
  for (const step of TOUR_STEPS) {
    const el = document.createElement("a");
    el.setAttribute("data-tour", step.href);
    container.appendChild(el);
  }
  document.body.appendChild(container);
  return container;
}

describe("GuidedTour", () => {
  beforeEach(() => {
    localStorage.clear();
    useTourStore.setState({ active: false, stepIndex: 0 });
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
    stubBoundingRect();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders nothing when the tour isn't active", () => {
    renderTargets();
    const { container } = render(<GuidedTour />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the first step once started, and advances on Next", async () => {
    renderTargets();
    render(<GuidedTour />);

    act(() => useTourStore.getState().start());
    expect(await screen.findByText(TOUR_STEPS[0].title)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText(TOUR_STEPS[1].title)).toBeInTheDocument();
  });

  it("goes back with the Back button", async () => {
    renderTargets();
    render(<GuidedTour />);
    act(() => useTourStore.getState().start());

    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText(TOUR_STEPS[1].title)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(await screen.findByText(TOUR_STEPS[0].title)).toBeInTheDocument();
  });

  it("ends and marks the tour seen when Skip tour is clicked", async () => {
    renderTargets();
    render(<GuidedTour />);
    act(() => useTourStore.getState().start());
    expect(await screen.findByText(TOUR_STEPS[0].title)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /skip tour/i }));
    expect(screen.queryByText(TOUR_STEPS[0].title)).not.toBeInTheDocument();
    expect(localStorage.getItem(SEEN_KEY)).toBe("1");
  });

  it("ends and marks the tour seen on the last step's 'Got it!'", async () => {
    renderTargets();
    render(<GuidedTour />);
    act(() => useTourStore.setState({ active: true, stepIndex: TOUR_STEPS.length - 1 }));
    expect(await screen.findByText(TOUR_STEPS.at(-1)!.title)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /got it/i }));
    expect(screen.queryByText(TOUR_STEPS.at(-1)!.title)).not.toBeInTheDocument();
    expect(localStorage.getItem(SEEN_KEY)).toBe("1");
  });

  it("skips on Escape", async () => {
    renderTargets();
    render(<GuidedTour />);
    act(() => useTourStore.getState().start());
    expect(await screen.findByText(TOUR_STEPS[0].title)).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByText(TOUR_STEPS[0].title)).not.toBeInTheDocument();
  });

  it("does not start on a narrow (mobile) viewport", async () => {
    renderTargets();
    Object.defineProperty(window, "innerWidth", { value: 400, configurable: true });
    render(<GuidedTour />);

    act(() => useTourStore.getState().start());
    expect(screen.queryByText(TOUR_STEPS[0].title)).not.toBeInTheDocument();
    expect(localStorage.getItem(SEEN_KEY)).toBe("1");
  });
});

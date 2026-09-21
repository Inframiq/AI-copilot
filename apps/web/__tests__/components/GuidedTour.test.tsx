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

  // The bubble used to open with a generic rocket glyph in a primary circle,
  // left over from before the brand had a mark of its own.
  it("wears the brand mark in the bubble", async () => {
    renderTargets();
    const { container } = render(<GuidedTour />);
    act(() => useTourStore.getState().start());
    expect(await screen.findByText(TOUR_STEPS[0].title)).toBeInTheDocument();

    const bubble = container.querySelector<HTMLElement>("[data-tour-bubble]")!;
    const mark = bubble.querySelector("img")!;
    expect(decodeURIComponent(mark.getAttribute("src")!)).toContain("/brand/logo-mark-light.png");
    // Decorative: the step title next to it already carries the meaning.
    expect(mark).toHaveAttribute("alt", "");
    expect(mark).toHaveAttribute("aria-hidden");
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

// ── Bubble follows the sidebar width ────────────────────────────────────────
// The bubble used to sit at a hardcoded left:296 (the old fixed 280px sidebar
// plus a 16px gap). The sidebar now collapses to a 72px rail, so a fixed
// offset would leave the bubble floating 224px away from it.

describe("GuidedTour bubble offset", () => {
  beforeEach(() => {
    localStorage.clear();
    useTourStore.setState({ active: false, stepIndex: 0 });
    delete document.documentElement.dataset.sidebar;
    document.documentElement.style.removeProperty("--sidebar-w");
    // Same setup the suite above uses: a wide viewport and a measurable
    // spotlight target, or GuidedTour renders nothing at all.
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
    stubBoundingRect();
    renderTargets();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    document.documentElement.style.removeProperty("--sidebar-w");
  });

  function bubbleLeft(): number {
    const el = screen.getByRole("dialog").querySelector<HTMLElement>("[data-tour-bubble]")!;
    return parseInt(el.style.left, 10);
  }

  it("clears a full-width sidebar", () => {
    document.documentElement.style.setProperty("--sidebar-w", "280px");
    render(<GuidedTour />);
    act(() => useTourStore.getState().start());
    expect(bubbleLeft()).toBe(296);
  });

  it("tucks in against a collapsed rail", () => {
    document.documentElement.style.setProperty("--sidebar-w", "72px");
    render(<GuidedTour />);
    act(() => useTourStore.getState().start());
    expect(bubbleLeft()).toBe(88);
  });

  it("falls back to the expanded width when the variable is unreadable", () => {
    render(<GuidedTour />);
    act(() => useTourStore.getState().start());
    expect(bubbleLeft()).toBe(296);
  });
});

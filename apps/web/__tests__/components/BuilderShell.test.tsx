// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
// fireEvent, not node.click(): a raw DOM click fires the handler but is not
// wrapped in act(), so React never flushes the state update and the next
// section does not render.
import { render, screen, fireEvent } from "@testing-library/react";

// The six editors are existing, already-tested components; mounting them
// would pull the whole store graph into what is a navigation test.
vi.mock("@/components/builder/SectionBody", () => ({
  SectionBody: ({ id }: { id: string }) => <div data-testid={`body-${id}`} />,
}));
vi.mock("@/lib/api-client", () => ({ apiClient: {} }));

import { BuilderShell } from "../../components/builder/BuilderShell";
import { useResumeStore } from "../../stores/resume-store";
import { useTailoringStore } from "../../stores/tailoring-store";

const CONTENT = {
  contact: { name: "Jane", email: "jane@example.com" },
  experience: [],
  education: [],
  skills: [],
};

function renderShell(onPreview = () => {}) {
  return render(
    <BuilderShell title="R" onBack={() => {}} backLabel="Back" onPreview={onPreview} />,
  );
}

describe("BuilderShell", () => {
  beforeEach(() => {
    useResumeStore.getState().resetStore();
    useTailoringStore.getState().resetStore();
    useResumeStore.setState({ content: CONTENT } as never);
  });

  it("opens on Contact", () => {
    renderShell();
    expect(screen.getByTestId("body-contact")).toBeTruthy();
  });

  it("shows only one section at a time", () => {
    renderShell();
    expect(screen.queryByTestId("body-skills")).toBeNull();
  });

  it("advances with Continue", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByTestId("body-summary")).toBeTruthy();
  });

  it("goes back with Previous", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /previous/i }));
    expect(screen.getByTestId("body-contact")).toBeTruthy();
  });

  it("jumps straight to a section from the stepper", () => {
    renderShell();
    fireEvent.click(screen.getByTestId("step-extras"));
    expect(screen.getByTestId("body-extras")).toBeTruthy();
  });

  it("calls onPreview from the last section", () => {
    const onPreview = vi.fn();
    renderShell(onPreview);
    fireEvent.click(screen.getByTestId("step-extras"));
    fireEvent.click(screen.getByRole("button", { name: /preview resume/i }));
    expect(onPreview).toHaveBeenCalled();
  });

  it("hides the context rail without a JD", () => {
    renderShell();
    expect(screen.queryByText(/target jd match/i)).toBeNull();
  });

  it("shows the context rail once a JD is attached", () => {
    useTailoringStore.setState({ jdId: "jd-1" } as never);
    renderShell();
    expect(screen.getByText(/target jd match/i)).toBeTruthy();
  });

  // Scrolled halfway down Experience, jumping to Contact left you looking at
  // the middle of a short section with its heading off-screen above.
  it("returns to the top of the page when the section changes", () => {
    const { container } = renderShell();
    const scroller = container.querySelector("[data-section-scroll]") as HTMLElement;
    // jsdom has no layout, so scrollTop is permanently 0 unless it is given
    // real storage. Without this the assertion would pass against any code.
    let scrollTop = 400;
    Object.defineProperty(scroller, "scrollTop", {
      get: () => scrollTop,
      set: (v: number) => { scrollTop = v; },
      configurable: true,
    });
    fireEvent.click(screen.getByTestId("step-education"));
    expect(scrollTop).toBe(0);
  });

  it("fades the incoming section rather than swapping it instantly", () => {
    const { container } = renderShell();
    expect(container.querySelector("main")?.className).toContain("section-enter");
  });
});


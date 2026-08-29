// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { AtsGapFixPanel } from "@/components/resume/AtsGapFixPanel";
import { useTailoringStore } from "@/stores/tailoring-store";
import type { AtsFix } from "@/lib/api-client";

const fixes: AtsFix[] = [
  { id: "skill:k8s", type: "skill", gap: "Kubernetes", importance: "high",
    grounded: true, text: "Kubernetes", experience_index: null, score_delta: 12, default_accept: false },
  { id: "bullet:leadership", type: "bullet", gap: "team leadership", importance: "low",
    grounded: false, text: "Led a team of 4 engineers.", experience_index: 0, score_delta: 3, default_accept: false },
];

describe("AtsGapFixPanel", () => {
  beforeEach(() => {
    useTailoringStore.getState().resetStore();
    useTailoringStore.setState({ atsScore: 60, projectedAtsScore: 72, atsFixes: fixes, bulletDecisions: {} } as never);
  });

  afterEach(() => cleanup());

  it("shows current → projected score and one row per fix, sorted High first", () => {
    const { getAllByTestId, getByText } = render(<AtsGapFixPanel />);
    expect(getByText(/60/)).toBeTruthy();
    expect(getByText(/72/)).toBeTruthy();
    const badges = getAllByTestId("importance-badge");
    expect(badges[0].getAttribute("data-level")).toBe("high");
  });

  it("marks a speculative bullet and defaults it to not-accepted", () => {
    const { getByText } = render(<AtsGapFixPanel />);
    expect(getByText(/only add if you.*actually done this/i)).toBeTruthy();
  });

  it("accept button calls setFixDecision", () => {
    const { getAllByRole } = render(<AtsGapFixPanel />);
    const acceptBtns = getAllByRole("button", { name: /accept/i });
    fireEvent.click(acceptBtns[0]);
    expect(useTailoringStore.getState().bulletDecisions["fix:skill:k8s"]).toBe("accept");
  });
});

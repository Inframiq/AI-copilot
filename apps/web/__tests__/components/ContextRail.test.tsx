// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/api-client", () => ({ apiClient: {} }));

import { ContextRail } from "../../components/builder/ContextRail";
import { useTailoringStore } from "../../stores/tailoring-store";

describe("ContextRail", () => {
  beforeEach(() => useTailoringStore.getState().resetStore());

  it("renders nothing without a JD context (Path B)", () => {
    const { container } = render(<ContextRail />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders once a JD is attached (Path A)", () => {
    useTailoringStore.setState({ jdId: "jd-1", missingSkills: ["Kubernetes"] } as never);
    render(<ContextRail />);
    expect(screen.getByText("Kubernetes")).toBeTruthy();
  });

  it("renders for a pasted JD with no id", () => {
    useTailoringStore.setState({ jdText: "Need Python.", missingSkills: ["Python"] } as never);
    render(<ContextRail />);
    expect(screen.getByText("Python")).toBeTruthy();
  });

  it("shows the ATS score when one has been computed", () => {
    useTailoringStore.setState({ jdId: "jd-1", atsScore: 72 } as never);
    render(<ContextRail />);
    expect(screen.getByTestId("rail-ats").textContent).toContain("72");
  });

  it("omits the score block before any analysis has run", () => {
    useTailoringStore.setState({ jdId: "jd-1", atsScore: null } as never);
    render(<ContextRail />);
    expect(screen.queryByTestId("rail-ats")).toBeNull();
  });

  it("badges a missing keyword with its importance", () => {
    useTailoringStore.setState({
      jdId: "jd-1",
      missingSkills: ["Kubernetes"],
      jdImportance: { kubernetes: "high" },
    } as never);
    render(<ContextRail />);
    expect(screen.getByTestId("importance-badge").getAttribute("data-level")).toBe("high");
  });

  it("caps the keyword list so the rail cannot run away", () => {
    useTailoringStore.setState({
      jdId: "jd-1",
      missingSkills: Array.from({ length: 20 }, (_, i) => `Skill${i}`),
    } as never);
    render(<ContextRail />);
    expect(screen.queryByText("Skill19")).toBeNull();
  });
});

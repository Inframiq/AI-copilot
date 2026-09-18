// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SectionStepper } from "../../components/builder/SectionStepper";
import type { ResumeContent } from "@career-copilot/types";

// contactRatio counts six fields and `complete` needs ratio >= 1, so a
// partially-filled contact is deliberately NOT complete. All six here.
const FILLED: ResumeContent = {
  contact: {
    name: "Jane Doe",
    email: "jane@example.com",
    phone: "+49 123 456",
    location: "Berlin",
    linkedin: "linkedin.com/in/janedoe",
    github: "github.com/janedoe",
  },
  summary: "Engineer with six years building payment systems for high traffic products.",
  experience: [],
  education: [],
  skills: [],
};

describe("SectionStepper", () => {
  it("marks a filled section complete", () => {
    render(<SectionStepper content={FILLED} current="experience" onSelect={() => {}} />);
    expect(screen.getByTestId("step-contact").getAttribute("data-state")).toBe("complete");
  });

  it("does not mark a partly-filled section complete", () => {
    const partial = { ...FILLED, contact: { name: "Jane Doe", email: "jane@example.com" } };
    render(<SectionStepper content={partial} current="summary" onSelect={() => {}} />);
    expect(screen.getByTestId("step-contact").getAttribute("data-state")).toBe("upcoming");
  });

  it("marks the current section current, even when it is empty", () => {
    render(<SectionStepper content={FILLED} current="experience" onSelect={() => {}} />);
    expect(screen.getByTestId("step-experience").getAttribute("data-state")).toBe("current");
  });

  it("marks an empty, non-current section upcoming", () => {
    render(<SectionStepper content={FILLED} current="experience" onSelect={() => {}} />);
    expect(screen.getByTestId("step-skills").getAttribute("data-state")).toBe("upcoming");
  });

  it("lets you jump backward, not just forward", () => {
    const onSelect = vi.fn();
    render(<SectionStepper content={FILLED} current="skills" onSelect={onSelect} />);
    screen.getByTestId("step-contact").click();
    expect(onSelect).toHaveBeenCalledWith("contact");
  });

  it("lets you jump forward past an incomplete section", () => {
    // Nothing is locked — the spec is explicit that this is not a wizard.
    const onSelect = vi.fn();
    render(<SectionStepper content={FILLED} current="contact" onSelect={onSelect} />);
    screen.getByTestId("step-extras").click();
    expect(onSelect).toHaveBeenCalledWith("extras");
  });

  it("names every step for screen readers", () => {
    render(<SectionStepper content={FILLED} current="contact" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /summary/i })).toBeTruthy();
  });

  it("marks the current step for assistive tech", () => {
    render(<SectionStepper content={FILLED} current="experience" onSelect={() => {}} />);
    expect(screen.getByTestId("step-experience").getAttribute("aria-current")).toBe("step");
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/studio/canvas/ContactSection", () => ({
  ContactSection: () => <div data-testid="contact" />,
}));
vi.mock("@/components/studio/canvas/SummarySection", () => ({
  SummarySection: () => <div data-testid="summary" />,
}));
vi.mock("@/components/studio/canvas/ExperienceSection", () => ({
  ExperienceSection: ({ focusIndex }: { focusIndex?: number }) => (
    <div data-testid="experience" data-focus={focusIndex ?? ""} />
  ),
}));
vi.mock("@/components/studio/canvas/EducationSection", () => ({
  EducationSection: () => <div data-testid="education" />,
}));
vi.mock("@/components/studio/canvas/SkillsSection", () => ({
  SkillsSection: () => <div data-testid="skills" />,
}));
vi.mock("@/components/studio/canvas/ExtrasSection", () => ({
  ExtrasSection: () => <div data-testid="extras" />,
}));

import { SectionBody } from "../../components/builder/SectionBody";

describe("SectionBody", () => {
  it("renders exactly the editor for the given section", () => {
    render(<SectionBody id="skills" />);
    expect(screen.getByTestId("skills")).toBeTruthy();
    expect(screen.queryByTestId("contact")).toBeNull();
  });

  it("renders each of the six sections", () => {
    for (const id of ["contact", "summary", "experience", "education", "skills", "extras"] as const) {
      const { unmount } = render(<SectionBody id={id} />);
      expect(screen.getByTestId(id)).toBeTruthy();
      unmount();
    }
  });

  it("passes focusIndex through to Experience", () => {
    render(<SectionBody id="experience" focusIndex={2} />);
    expect(screen.getByTestId("experience").getAttribute("data-focus")).toBe("2");
  });
});

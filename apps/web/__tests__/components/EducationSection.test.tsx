// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useResumeStore } from "@/stores/resume-store";
import { EducationSection } from "@/components/studio/canvas/EducationSection";

function setEducation(education: Array<Record<string, string>>) {
  useResumeStore.setState({
    content: { contact: { name: "Jane", email: "j@x.com" }, experience: [], education, skills: [] },
    templateId: "ats_clean",
  } as never);
}

describe("the Builder's education GPA and Honors fields", () => {
  beforeEach(() =>
    setEducation([{ institution: "GITAM", degree: "B.Tech", year: "2019", gpa: "8.6/10", honors: "Dean's List" }]),
  );

  it("shows what the résumé holds", () => {
    render(<EducationSection />);
    expect(screen.getByLabelText("GPA / CGPA / %")).toHaveValue("8.6/10");
    expect(screen.getByLabelText("Honors")).toHaveValue("Dean's List");
  });

  it("writes edits to that entry only", () => {
    setEducation([
      { institution: "GITAM", degree: "B.Tech", year: "2019" },
      { institution: "Narayana", degree: "Class XII", year: "2015" },
    ]);
    render(<EducationSection />);
    fireEvent.change(screen.getAllByLabelText("GPA / CGPA / %")[0], { target: { value: "3.8/4.0" } });
    fireEvent.change(screen.getAllByLabelText("Honors")[0], { target: { value: "First Class with Distinction" } });
    const education = useResumeStore.getState().content!.education;
    expect(education[0]).toMatchObject({ gpa: "3.8/4.0", honors: "First Class with Distinction" });
    expect(education[1]).toEqual({ institution: "Narayana", degree: "Class XII", year: "2015" });
  });
});

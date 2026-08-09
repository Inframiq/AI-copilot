// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileForm } from "../../components/networking/ProfileForm";
import { useResumeStore } from "../../stores/resume-store";

describe("ProfileForm", () => {
  beforeEach(() => {
    useResumeStore.getState().resetStore();
  });

  it("renders empty for a new profile and disables submit without a name", () => {
    render(<ProfileForm initial={null} onSave={vi.fn()} isSaving={false} error={null} />);
    expect(screen.getByPlaceholderText("Your full name")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save Profile" })).toBeDisabled();
  });

  it("enables submit once a display name is entered, and submits parsed skills", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProfileForm initial={null} onSave={onSave} isSaving={false} error={null} />);

    await userEvent.type(screen.getByPlaceholderText("Your full name"), "Jane Doe");
    await userEvent.type(screen.getByPlaceholderText("React, TypeScript, Python…"), "React, Go");

    const submit = screen.getByRole("button", { name: "Save Profile" });
    expect(submit).not.toBeDisabled();
    await userEvent.click(submit);

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: "Jane Doe", skills: ["React", "Go"] })
    );
  });

  it("shows the Saving… state and a passed-in error", () => {
    render(<ProfileForm initial={null} onSave={vi.fn()} isSaving={true} error="Something broke" />);
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    expect(screen.getByText("Something broke")).toBeInTheDocument();
  });

  it("only offers Import from Resume when resume content exists", () => {
    const { rerender } = render(<ProfileForm initial={null} onSave={vi.fn()} isSaving={false} error={null} />);
    expect(screen.queryByText(/Import name/)).not.toBeInTheDocument();

    act(() => {
      useResumeStore.getState().setResume("r1", { contact: { name: "Resume Name", email: "" }, experience: [], education: [], skills: ["Rust"] }, "ats_clean");
    });
    rerender(<ProfileForm initial={null} onSave={vi.fn()} isSaving={false} error={null} />);
    expect(screen.getByText(/Import name/)).toBeInTheDocument();
  });

  it("imports name and skills from the resume store on click", async () => {
    useResumeStore.getState().setResume("r1", { contact: { name: "Resume Name", email: "" }, experience: [], education: [], skills: ["Rust", "Go"] }, "ats_clean");
    render(<ProfileForm initial={null} onSave={vi.fn()} isSaving={false} error={null} />);

    await userEvent.click(screen.getByText(/Import name/));
    expect(screen.getByPlaceholderText("Your full name")).toHaveValue("Resume Name");
    expect(screen.getByDisplayValue("Rust, Go")).toBeInTheDocument();
  });

  it("only offers Import from Career Profile when one is passed in", () => {
    const { rerender } = render(<ProfileForm initial={null} onSave={vi.fn()} isSaving={false} error={null} />);
    expect(screen.queryByText("Import from Career Profile")).not.toBeInTheDocument();

    const careerProfile = {
      user_id: "u1",
      master_resume_id: null,
      contact: { name: "Career Name", email: "career@test.com", location: "Remote", linkedin: "https://linkedin.com/in/career", github: "https://github.com/career" },
      experience: [],
      education: [],
      skills: ["Kotlin"],
      certifications: [],
      headline: "Staff Engineer",
      created_at: "",
      updated_at: "",
    };
    rerender(<ProfileForm initial={null} careerProfile={careerProfile} onSave={vi.fn()} isSaving={false} error={null} />);
    expect(screen.getByText("Import from Career Profile")).toBeInTheDocument();
  });

  it("imports display name, headline, location, links and skills from the career profile on click", async () => {
    const careerProfile = {
      user_id: "u1",
      master_resume_id: null,
      contact: { name: "Career Name", email: "career@test.com", location: "Remote", linkedin: "https://linkedin.com/in/career", github: "https://github.com/career" },
      experience: [],
      education: [],
      skills: ["Kotlin", "Swift"],
      certifications: [],
      headline: "Staff Engineer",
      created_at: "",
      updated_at: "",
    };
    render(<ProfileForm initial={null} careerProfile={careerProfile} onSave={vi.fn()} isSaving={false} error={null} />);

    await userEvent.click(screen.getByText("Import from Career Profile"));
    expect(screen.getByPlaceholderText("Your full name")).toHaveValue("Career Name");
    expect(screen.getByPlaceholderText("Senior SWE at Google")).toHaveValue("Staff Engineer");
    expect(screen.getByPlaceholderText("San Francisco, CA")).toHaveValue("Remote");
    expect(screen.getByPlaceholderText("https://linkedin.com/in/you")).toHaveValue("https://linkedin.com/in/career");
    expect(screen.getByPlaceholderText("https://github.com/you")).toHaveValue("https://github.com/career");
    expect(screen.getByDisplayValue("Kotlin, Swift")).toBeInTheDocument();
  });

  it("toggles Open to Work and Available For chips", async () => {
    render(<ProfileForm initial={null} onSave={vi.fn()} isSaving={false} error={null} />);
    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");

    const contractChip = screen.getByText("Contract");
    await userEvent.click(contractChip);
    expect(contractChip.className).toContain("bg-secondary-container");
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isListed, repeatedAt, withoutRepeats } from "@/lib/duplicates";
import { findRepeat } from "@/lib/suggest/client";
import { fitProfileSections } from "@/lib/profile-sections";
import { SuggestInput } from "@/components/ui/SuggestInput";
import { useResumeStore } from "@/stores/resume-store";
import { SkillsSection } from "@/components/studio/canvas/SkillsSection";
import { ExtrasSection } from "@/components/studio/canvas/ExtrasSection";

describe("what counts as the same entry", () => {
  it("ignores case, spacing and punctuation", () => {
    expect([...repeatedAt(["React", "Node.js", "react", "node js", "  "])]).toEqual([2, 3]);
    expect(withoutRepeats(["Chess", "chess ", "Trekking", ""])).toEqual(["Chess", "Trekking", ""]);
    expect(isListed("NODE-JS", ["Node.js"])).toBe(true);
    expect(isListed("", ["Node.js"])).toBe(false);
  });

  it("counts a skill's alias as its name", async () => {
    expect(await findRepeat("skill", "JavaScript", ["Python", "JS"])).toBe("JS");
    expect(await findRepeat("skill", "golang", ["Go"])).toBe("Go");
    expect(await findRepeat("skill", "Java", ["JavaScript"])).toBeNull();
  });

  it("drops repeated lines and languages when the Profile is saved", () => {
    const fit = fitProfileSections({
      interests: ["Chess", "chess", "Trekking"],
      languages: [{ name: "Hindi", level: "Native" }, { name: "hindi", level: "" }, { name: "Telugu", level: "" }],
    });
    expect(fit.interests).toEqual(["Chess", "Trekking"]);
    expect(fit.languages.map((l) => l.name)).toEqual(["Hindi", "Telugu"]);
  });
});

function Field({ list = false, exclude }: { list?: boolean; exclude?: string[] }) {
  const [value, setValue] = useState("");
  return (
    <>
      <SuggestInput kind="skill" list={list} exclude={exclude} aria-label="Field" value={value} onValueChange={setValue} />
      <button>elsewhere</button>
    </>
  );
}

describe("suggestions leave out what's already listed", () => {
  it("for a field adding to a list", async () => {
    render(<Field exclude={["Python"]} />);
    await userEvent.type(screen.getByRole("combobox"), "pyt");
    await waitFor(() => expect(screen.queryAllByRole("option").length).toBeGreaterThan(0));
    expect(screen.queryByRole("option", { name: "Python" })).toBeNull();
  });

  it("for a tech stack, its own earlier items — and a repeat goes on leaving it", async () => {
    render(<Field list />);
    const field = screen.getByRole("combobox");
    await userEvent.type(field, "React, Node.js, rea");
    await waitFor(() => expect(screen.queryAllByRole("option").length).toBeGreaterThan(0));
    expect(screen.queryByRole("option", { name: "React" })).toBeNull();
    await userEvent.clear(field);
    await userEvent.type(field, "React, node js, react");
    await userEvent.click(screen.getByRole("button", { name: "elsewhere" }));
    await waitFor(() => expect(field).toHaveValue("React, Node.js"));
  });
});

describe("the Builder", () => {
  const renderIn = (ui: React.ReactNode) =>
    render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

  beforeEach(() => {
    useResumeStore.setState({
      content: {
        contact: { name: "Jane", email: "j@x.com" }, experience: [], education: [], skills: ["JavaScript"],
        languages: [{ name: "Hindi", level: "" }, { name: "hindi", level: "" }],
        certifications: ["PMP", "pmp"],
        interests: ["Chess", "Chess"],
      },
    } as never);
  });

  it("won't add a skill that's already there, under another spelling either, and says so", async () => {
    renderIn(<SkillsSection />);
    const box = screen.getByRole("combobox", { name: "Add a skill" });
    await userEvent.type(box, "js{Enter}");
    expect(await screen.findByText("JavaScript is already in your skills.")).toBeInTheDocument();
    expect(useResumeStore.getState().content!.skills).toEqual(["JavaScript"]);
    await userEvent.type(box, "Rust{Enter}");
    await waitFor(() => expect(useResumeStore.getState().content!.skills).toEqual(["JavaScript", "Rust"]));
  });

  it("flags a repeated language and certification, and keeps the certification", () => {
    renderIn(<ExtrasSection />);
    expect(screen.getByRole("combobox", { name: "Language 2" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("combobox", { name: "Certification 2" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/A renewal can stay/)).toBeInTheDocument();
    expect(useResumeStore.getState().content!.certifications).toEqual(["PMP", "pmp"]);
  });

  it("says a line is listed twice, and drops the repeat on leaving the box", () => {
    renderIn(<ExtrasSection />);
    const box = screen.getByLabelText(/^Interests/);
    expect(screen.getByText(/Listed twice: Chess/)).toBeInTheDocument();
    fireEvent.blur(box);
    expect(useResumeStore.getState().content!.interests).toEqual(["Chess"]);
  });
});

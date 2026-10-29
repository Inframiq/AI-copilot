// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ResumeContent, WorkProject } from "@career-copilot/types";
import { useResumeStore } from "@/stores/resume-store";
import { ExperienceSection } from "@/components/studio/canvas/ExperienceSection";
import { ResumeCanvas } from "@/components/studio/ResumeCanvas";
import { allRolePoints, projectBulletKey, projectLine } from "@/lib/work-projects";
import { listBullets } from "@/lib/wording-checks";
import { sectionStates } from "@/lib/section-completeness";

const BARCLAYS: WorkProject = {
  client: "Barclays", name: "Payments Hub", domain: "Banking", role: "Module Lead",
  start: "Jan 2022", end: "", tech_stack: "Java", bullets: ["Led the payments module."],
};

function content(experience: ResumeContent["experience"]): ResumeContent {
  return { contact: { name: "Asha", email: "a@x.com" }, experience, education: [], skills: [] };
}

const role = (extra: Partial<ResumeContent["experience"][number]> = {}) => ({
  company: "Infosys", title: "Senior Systems Engineer", start: "Jun 2019", end: "Present", bullets: ["Mentored joiners."], ...extra,
});

const experience = () => useResumeStore.getState().content!.experience;

function renderSection() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ExperienceSection />
    </QueryClientProvider>,
  );
}

describe("the line a project prints", () => {
  it("is the client, else the name · domain · role — only what's there", () => {
    expect(projectLine(BARCLAYS)).toBe("Barclays · Banking · Module Lead");
    expect(projectLine({ name: "Order Tracker", role: "Developer", bullets: [] })).toBe("Order Tracker · Developer");
    expect(projectLine({ name: "Payments Hub", bullets: [] })).toBe("Payments Hub");
    expect(projectLine({ bullets: ["x"] })).toBe("");
  });
});

describe("projects inside a role in the Builder", () => {
  beforeEach(() => useResumeStore.setState({ content: content([role()]) } as never));

  it("adds one, and keeps what's typed into it", async () => {
    renderSection();
    await userEvent.click(screen.getByRole("button", { name: "+ Add project" }));
    await userEvent.type(screen.getByLabelText("Client"), "Barclays");
    await userEvent.type(screen.getByLabelText("Project name"), "Payments Hub");
    await userEvent.type(screen.getByLabelText(/^Points/), "Led the payments module.");
    expect(experience()[0].projects).toEqual([
      expect.objectContaining({ client: "Barclays", name: "Payments Hub", bullets: ["Led the payments module."] }),
    ]);
    // The role's own points are untouched.
    expect(experience()[0].bullets).toEqual(["Mentored joiners."]);
    // The card is titled with the line the résumé will print.
    expect(screen.getByText("Barclays")).toBeInTheDocument();
  });

  it("moves and removes them", async () => {
    useResumeStore.setState({ content: content([role({ projects: [BARCLAYS, { name: "Order Tracker", bullets: [] }] })]) } as never);
    renderSection();
    await userEvent.click(screen.getByRole("button", { name: "Move project 2 up" }));
    expect(experience()[0].projects!.map(projectLine)).toEqual(["Order Tracker", "Barclays · Banking · Module Lead"]);
    await userEvent.click(screen.getByRole("button", { name: "Remove project 1" }));
    expect(experience()[0].projects!.map(projectLine)).toEqual(["Barclays · Banking · Module Lead"]);
  });

  it("keeps both roles' projects when two roles at one company are merged", async () => {
    useResumeStore.setState({
      content: content([
        role({ title: "Technology Lead", projects: [BARCLAYS] }),
        role({ title: "Systems Engineer", projects: [{ name: "Order Tracker", bullets: ["Built the API."] }] }),
      ]),
    } as never);
    renderSection();
    await userEvent.click(screen.getByRole("button", { name: "Merge into one entry" }));
    expect(experience()).toHaveLength(1);
    expect(experience()[0].projects!.map(projectLine)).toEqual(["Barclays · Banking · Module Lead", "Order Tracker"]);
  });
});

describe("a role's project points count as its points", () => {
  it("for completeness, wording checks, and their review keys", () => {
    const c = content([role({ bullets: [], projects: [BARCLAYS] })]);
    expect(allRolePoints(c.experience[0])).toEqual(["Led the payments module."]);
    expect(sectionStates(c).find((s) => s.id === "experience")!.ratio).toBe(1);
    expect(listBullets(c)).toEqual([
      { key: "exp0_p0_b0", text: "Led the payments module.", where: "Barclays · Banking · Module Lead" },
    ]);
    expect(projectBulletKey(2, 0, 1)).toBe("exp2_p0_b1");
  });
});

describe("a project's dates in the Studio preview", () => {
  it("open the picker", () => {
    const onEditDate = vi.fn();
    const html = `<div><span data-field="experience.0.projects.1.start">Jan 2022</span></div>`;
    const { container } = render(<ResumeCanvas html={html} editable onEdit={() => {}} onEditDate={onEditDate} />);
    const host = container.querySelector("[data-canvas]") as HTMLElement;
    const el = (host.shadowRoot ?? host).querySelector<HTMLElement>("[data-field]")!;
    expect(el.getAttribute("contenteditable")).toBe("false");
    el.click();
    expect(onEditDate).toHaveBeenCalledWith({ path: "experience.0.projects.1.start", value: "Jan 2022" });
  });
});

describe("the review's merge of accepted points", () => {
  it("keeps a role's projects as they are", async () => {
    const { buildMergedContent } = await import("@/stores/tailoring-store");
    const original = content([role({ projects: [BARCLAYS] })]);
    const pending = content([role({ bullets: ["Mentored new joiners to independence."], projects: [BARCLAYS] })]);
    const merged = buildMergedContent(pending, original, { exp0_b0: "accept" }, []);
    expect(merged.experience[0].bullets).toEqual(["Mentored new joiners to independence."]);
    expect(merged.experience[0].projects).toEqual([BARCLAYS]);
  });
});

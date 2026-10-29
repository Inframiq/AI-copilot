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

// ── The Profile's project cards (phase 2) ────────────────────────────────────

describe("project cards in the Profile, and their way onto a résumé", () => {
  it("moves the old Projects box into the first card, so nothing is lost", async () => {
    const { blankExperienceEntry, withWorkProjects } = await import("@/lib/career-profile-client");
    const old = blankExperienceEntry({ company: "Infosys", projects: "Payment gateway v2, Search re-index" });
    delete (old as { workProjects?: unknown }).workProjects; // saved before cards existed
    const moved = withWorkProjects(old);
    expect(moved.projects).toBe("");
    expect(moved.workProjects).toHaveLength(1);
    expect(moved.workProjects![0]).toMatchObject({ responsibilities: "Payment gateway v2, Search re-index", client: "" });
    // A role that already has cards keeps them; one with neither gets none.
    expect(withWorkProjects(moved)).toEqual(moved);
    expect(withWorkProjects(blankExperienceEntry()).workProjects).toEqual([]);
  });

  it("starts a résumé with each card as a project, its points labelled like the role's", async () => {
    const { blankExperienceEntry, blankWorkProject, profileToResumeContent } = await import("@/lib/career-profile-client");
    const role = blankExperienceEntry({
      company: "Infosys", title: "Senior Systems Engineer", start: "Jun 2019", current: true,
      responsibilities: "Mentored joiners",
      workProjects: [blankWorkProject({
        client: "Barclays", name: "Payments Hub", role: "Module Lead", domain: "Banking", start: "Jan 2022",
        techStack: "Java", responsibilities: "Led the payments module", impact: "Cut settlement time by 30%",
      })],
    });
    const resume = profileToResumeContent({
      master_resume_id: null, contact: { name: "A", email: "a@x.com" }, headline: null, experience: [role],
      projects: [], education: [], skills: [], certifications: [], role_status: null, photo_url: null, photo_path: null,
    });
    expect(resume.experience[0].bullets).toEqual(["Responsibilities: Mentored joiners"]);
    expect(resume.experience[0].projects).toEqual([{
      client: "Barclays", name: "Payments Hub", role: "Module Lead", domain: "Banking", start: "Jan 2022",
      tech_stack: "Java", bullets: ["Responsibilities: Led the payments module", "Impact: Cut settlement time by 30%"],
    }]);
  });

  it("reads a résumé's projects back into cards (an upload)", async () => {
    const { resumeContentToCareerProfileInput } = await import("@/lib/career-profile-client");
    const input = resumeContentToCareerProfileInput(
      content([role({ projects: [{ ...BARCLAYS, start: "January 2022", bullets: ["Led the module.", "Shipped v2."] }] })]),
      null,
    );
    expect(input.experience[0].workProjects).toEqual([expect.objectContaining({
      client: "Barclays", domain: "Banking", role: "Module Lead", start: "Jan 2022",
      techStack: "Java", responsibilities: "Led the module.; Shipped v2.",
    })]);
  });
});

// ── Phase 3: the review and the JD ordering ──────────────────────────────────

describe("reviewing a tailored role's project points", () => {
  const ORDER: WorkProject = { name: "Order Tracker", role: "Developer", tech_stack: "Node.js", bullets: ["Built the order API."] };
  const original = content([role({ projects: [ORDER, BARCLAYS] })]);
  const tailored = content([role({
    bullets: ["Mentored new joiners to independence."],
    projects: [ORDER, { ...BARCLAYS, bullets: ["Led the payments module for 12 developers."] }],
  })]);

  it("parses and resolves a project point's key", async () => {
    const { parseBulletKey, withBulletText } = await import("@/stores/tailoring-store");
    expect(parseBulletKey("exp0_p1_b0")).toEqual({ section: "experience", entryIdx: 0, projectIdx: 1, bulletIdx: 0 });
    expect(parseBulletKey("exp0_b2")).toEqual({ section: "experience", entryIdx: 0, projectIdx: null, bulletIdx: 2 });
    expect(parseBulletKey("proj0_p1_b0")).toBeNull();
    const edited = withBulletText(tailored, "exp0_p1_b0", "Edited.");
    expect(edited.experience[0].projects![1].bullets).toEqual(["Edited."]);
    expect(edited.experience[0].projects![0]).toBe(ORDER);
    expect(withBulletText(tailored, "exp0_p7_b0", "x")).toBe(tailored);
  });

  it("lists a project's rewritten point under the role's company and the project's line", async () => {
    const { deriveBulletChanges } = await import("@/stores/tailoring-store");
    const changes = deriveBulletChanges(tailored, original);
    expect(changes.map((c) => [c.key, c.company, c.jobTitle])).toEqual([
      ["exp0_b0", "Infosys", "Senior Systems Engineer"],
      ["exp0_p1_b0", "Infosys", "Barclays · Banking · Module Lead"],
    ]);
    expect(changes[1]).toMatchObject({ jobIdx: 0, projectIdx: 1, original: "Led the payments module.", tailored: "Led the payments module for 12 developers." });
  });

  it("keeps a rejected project point as it was", async () => {
    const { buildMergedContent } = await import("@/stores/tailoring-store");
    const merged = buildMergedContent(tailored, original, { exp0_p1_b0: "reject" }, []);
    expect(merged.experience[0].projects![1].bullets).toEqual(["Led the payments module."]);
    expect(merged.experience[0].bullets).toEqual(["Mentored new joiners to independence."]);
  });

  it("puts the project that fits the JD first, drops none, and keeps order on a tie", async () => {
    const { buildMergedContent } = await import("@/stores/tailoring-store");
    const banking = buildMergedContent(tailored, original, {}, [], [], {}, undefined, {
      terms: ["payments", "Java"], text: "Backend engineer for a banking platform: payments, Java, Kafka.",
    });
    expect(banking.experience[0].projects!.map(projectLine)).toEqual(["Barclays · Banking · Module Lead", "Order Tracker · Developer"]);
    const retail = buildMergedContent(tailored, original, {}, [], [], {}, undefined, { terms: ["Node.js", "order"] });
    expect(retail.experience[0].projects!.map(projectLine)).toEqual(["Order Tracker · Developer", "Barclays · Banking · Module Lead"]);
    const nothing = buildMergedContent(tailored, original, {}, [], [], {}, undefined, { terms: ["Haskell"] });
    expect(nothing.experience[0].projects!.map(projectLine)).toEqual(["Order Tracker · Developer", "Barclays · Banking · Module Lead"]);
    // Without a JD, nothing moves.
    expect(buildMergedContent(tailored, original, {}, []).experience[0].projects![0]).toEqual(ORDER);
  });

  it("judges a project with no client or domain on its points too", async () => {
    const { projectFit } = await import("@/lib/work-projects");
    expect(projectFit({ name: "Search re-index", bullets: ["Moved search to Elasticsearch."] }, ["Elasticsearch"])).toBe(1);
    expect(projectFit({ bullets: ["Fixed batch jobs."] }, ["Elasticsearch"])).toBe(0);
  });
});

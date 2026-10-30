// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";

// One save goes through `results` in order; the payload of each is kept.
let results: Array<{ data: unknown; error: unknown }> = [];
let upserts: Array<Record<string, unknown>> = [];
vi.mock("@/lib/supabase", () => ({
  createBrowserClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => {
      const q = {
        upsert(payload: Record<string, unknown>) { upserts.push({ ...payload }); return q; },
        select() { return q; },
        single: async () => results.shift() ?? { data: { user_id: "user-1" }, error: null },
      };
      return q;
    },
  }),
}));

import {
  EXTRA_SECTIONS,
  LINE_SECTIONS,
  PROFILE_LIMITS,
  SECTION_INFO,
  capEdit,
  emptyProfileSections,
  fitProfileSections,
  profileSectionsToResume,
  resumeSectionsToProfile,
  type ProfileSections,
} from "@/lib/profile-sections";
import {
  profileToResumeContent,
  resumeContentToCareerProfileInput,
  upsertCareerProfile,
  type CareerProfileInput,
} from "@/lib/career-profile-client";
import type { ResumeContent } from "@career-copilot/types";
import { useResumeStore } from "@/stores/resume-store";
import { ExtrasSection } from "@/components/studio/canvas/ExtrasSection";
import { SummarySection } from "@/components/studio/canvas/SummarySection";

const API = join(process.cwd(), "..", "api");

const FULL: ProfileSections = {
  summary: "Backend engineer building payment APIs.",
  objective: "Seeking a platform engineering role.",
  languages: [{ name: "Telugu", level: "Native" }, { name: "German", level: "" }],
  awards: ["Dean's List, 2024"],
  achievements: ["98.6 percentile, CAT 2024"],
  leadership: ["President, Coding Club"],
  volunteer: ["Taught computing at a government school"],
  interests: ["Chess", "Trekking"],
};

const RESUME: ResumeContent = {
  contact: { name: "Asha", email: "a@x.com" },
  experience: [], education: [], skills: [],
  ...FULL,
  summary: FULL.summary!,
  objective: FULL.objective!,
};

const BASE: CareerProfileInput = {
  master_resume_id: null, contact: { name: "Asha", email: "a@x.com" }, headline: null,
  experience: [], projects: [], education: [], skills: [], certifications: [],
  role_status: null, photo_url: null, photo_path: null,
};

// ── Profile and résumé hold the same sections ────────────────────────────────
// "Adding one means adding both": each check below fails when a section is
// added to the list without the place it also has to go.

describe("every Profile section is a résumé section", () => {
  it("survives résumé → profile → résumé unchanged", () => {
    const profile = resumeSectionsToProfile(RESUME);
    expect(profile).toEqual(FULL);
    expect(profileSectionsToResume(profile)).toEqual(FULL);
  });

  it("is carried by an upload into the Profile, and by Start Blank into a résumé", () => {
    const input = resumeContentToCareerProfileInput(RESUME, null);
    for (const key of ["summary", ...EXTRA_SECTIONS] as const) expect(input[key], key).toEqual(FULL[key]);
    const started = profileToResumeContent({ ...BASE, ...FULL });
    for (const key of ["summary", ...EXTRA_SECTIONS] as const) expect(started[key], key).toEqual(FULL[key]);
  });

  it("leaves empty sections off a résumé started from the Profile", () => {
    expect(profileSectionsToResume(emptyProfileSections())).toEqual({});
    expect(Object.keys(profileToResumeContent(BASE))).not.toContain("interests");
  });

  it("is printed by every résumé template", () => {
    const dir = join(API, "templates");
    for (const file of readdirSync(dir).filter((f) => /^ats_.*\.html$/.test(f))) {
      const html = readFileSync(join(dir, file), "utf8");
      for (const key of ["languages", ...LINE_SECTIONS]) expect(html, `${file}: ${key}`).toContain(`render_${key}()`);
      expect(html, `${file}: objective`).toMatch(/\{% elif objective %\}/);
    }
  });

  it("is read from an uploaded résumé", () => {
    const parser = readFileSync(join(API, "app/services/resume_parser.py"), "utf8");
    for (const key of ["summary", ...EXTRA_SECTIONS]) expect(parser, key).toContain(`"${key}"`);
  });

  it("can be edited in the Résumé Builder", () => {
    useResumeStore.setState({ content: RESUME } as never);
    render(createElement(ExtrasSection));
    for (const key of ["languages", ...LINE_SECTIONS] as const) {
      expect(screen.getByRole("heading", { name: SECTION_INFO[key].label }), key).toBeInTheDocument();
    }
    expect(screen.getByLabelText(/^Interests/)).toHaveValue("Chess\nTrekking");
    render(createElement(SummarySection));
    expect(screen.getByLabelText("Objective")).toHaveValue(FULL.objective);
  });
});

// ── The database's limits (migration 053) ────────────────────────────────────

describe("the limits", () => {
  it("are the ones migration 053 puts on the database", () => {
    const mig = readFileSync(join(API, "alembic/versions/053_profile_holds_every_resume_section.py"), "utf8");
    const num = (name: string) => Number(new RegExp(`^${name} = (\\d+)`, "m").exec(mig)?.[1]);
    expect(num("MAX_ITEMS")).toBe(PROFILE_LIMITS.items);
    expect(num("MAX_ITEM_CHARS")).toBe(PROFILE_LIMITS.itemChars);
    expect(num("MAX_LANGUAGES")).toBe(PROFILE_LIMITS.languages);
    expect(num("MAX_LANGUAGE_CHARS")).toBe(PROFILE_LIMITS.languageChars);
    for (const key of LINE_SECTIONS) expect(mig, key).toContain(`"${key}"`);
    // Raised by 055 so an uploaded résumé's long summary fits whole.
    const raised = readFileSync(join(API, "alembic/versions/055_long_uploaded_summary_fits.py"), "utf8");
    const now = (name: string) => Number(new RegExp(`^${name} = (\\d+)`, "m").exec(raised)?.[1]);
    expect(now("MAX_SUMMARY_CHARS")).toBe(PROFILE_LIMITS.summaryChars);
    expect(now("MAX_OBJECTIVE_CHARS")).toBe(PROFILE_LIMITS.objectiveChars);
  });

  it("never cut a text that arrived longer than the word cap", () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
    // Typing past the cap stops at it.
    expect(capEdit(words(80), words(81), 80)).toBe(words(80));
    expect(capEdit("", words(90), 80)).toBe(words(80));
    // An uploaded 330-word summary: a fix inside it stays whole, trimming
    // always goes through, and it can't grow.
    const upload = words(330);
    const fixed = upload.replace("w5 ", "w5, ");
    expect(capEdit(upload, fixed, 80)).toBe(fixed);
    expect(capEdit(upload, words(200), 80)).toBe(words(200));
    expect(capEdit(upload, `${upload} more`, 80)).toBe(upload);
  });

  it("are kept on the way in, so an uploaded résumé can always be saved", () => {
    const fit = fitProfileSections({
      summary: "s".repeat(1500),
      // Past 055's 4,000 characters is cut; 1,500 fits whole.
      objective: "  ",
      languages: Array.from({ length: 20 }, (_, i) => ({ name: `L${i}`, level: "x".repeat(200) })),
      awards: [...Array.from({ length: 25 }, (_, i) => `A${i}`), "  "],
      interests: ["  Chess ", "", "c".repeat(400)],
    });
    expect(fit.summary).toHaveLength(1500);
    expect(fit.objective).toBeNull();
    expect(fit.languages).toHaveLength(15);
    expect(fit.languages[0].level).toHaveLength(100);
    expect(fit.awards).toHaveLength(20);
    expect(fit.interests).toEqual(["Chess", "c".repeat(300)]);
    expect(fit.volunteer).toEqual([]);
  });
});

// ── Saving ───────────────────────────────────────────────────────────────────

describe("upsertCareerProfile", () => {
  beforeEach(() => {
    results = [];
    upserts = [];
  });

  it("writes the sections it's given, inside the limits", async () => {
    await upsertCareerProfile({ ...BASE, ...FULL, interests: [" Chess ", ""] });
    expect(upserts[0]).toMatchObject({ summary: FULL.summary, interests: ["Chess"], leadership: FULL.leadership });
  });

  it("saves LinkedIn and GitHub in their standard form, and leaves a bad one for the database", async () => {
    await upsertCareerProfile({
      ...BASE,
      contact: { ...BASE.contact, linkedin: "https://www.linkedin.com/in/asha/", github: "github.com/a/b" },
    });
    expect(upserts[0].contact).toMatchObject({ linkedin: "linkedin.com/in/asha", github: "github.com/a/b" });
  });

  it("writes an emptied section, so clearing one on the Profile clears it", async () => {
    await upsertCareerProfile({ ...BASE, ...emptyProfileSections() });
    expect(upserts[0]).toMatchObject({ summary: null, awards: [], languages: [] });
  });

  // Saving a photo from the Builder copies the profile field by field; a
  // section it didn't name must not be wiped by that save.
  it("leaves alone every section it isn't given", async () => {
    await upsertCareerProfile({ ...BASE, photo_url: "u", photo_path: "user-1/p.png" });
    for (const key of ["summary", ...EXTRA_SECTIONS]) expect(upserts[0], key).not.toHaveProperty(key);
  });

  it("saves without the sections while the database doesn't have them yet, when they're empty", async () => {
    results = [{ data: null, error: { code: "PGRST204", message: "Could not find the 'awards' column" } }];
    await upsertCareerProfile({ ...BASE, ...emptyProfileSections() });
    expect(upserts).toHaveLength(2);
    expect(upserts[1]).not.toHaveProperty("awards");
    expect(upserts[1]).toMatchObject({ user_id: "user-1", contact: BASE.contact });
  });

  it("says so rather than dropping sections the person filled in", async () => {
    results = [{ data: null, error: { code: "PGRST204", message: "Could not find the 'awards' column" } }];
    await expect(upsertCareerProfile({ ...BASE, ...FULL })).rejects.toThrow(/aren't available yet/);
    expect(upserts).toHaveLength(1);
  });
});

// ── The Builder's one-per-line boxes ─────────────────────────────────────────
// They rebuilt their text from the saved lines on every keystroke, which
// dropped the empty line Enter had just made: a second award could never be
// started at the end of the box.

describe("a one-per-line box in the Builder", () => {
  it("keeps the new line Enter makes, and saves the item once it has text", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    useResumeStore.setState({ content: { ...RESUME, awards: ["Dean's List, 2024"] } } as never);
    render(createElement(ExtrasSection));
    const box = screen.getByLabelText(/^Awards/) as HTMLTextAreaElement;
    await userEvent.click(box);
    await userEvent.keyboard("{End}{Enter}");
    expect(box.value).toBe("Dean's List, 2024\n");
    await userEvent.keyboard("Hackathon winner");
    expect(useResumeStore.getState().content!.awards).toEqual(["Dean's List, 2024", "Hackathon winner"]);
  });

  it("follows a change made elsewhere", async () => {
    useResumeStore.setState({ content: { ...RESUME, interests: ["Chess"] } } as never);
    render(createElement(ExtrasSection));
    const { act } = await import("@testing-library/react");
    act(() => useResumeStore.getState().updateContent({ interests: ["Chess", "Trekking"] }));
    expect(screen.getByLabelText(/^Interests/)).toHaveValue("Chess\nTrekking");
  });
});

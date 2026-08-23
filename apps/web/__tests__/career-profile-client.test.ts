import { describe, it, expect, vi, beforeEach } from "vitest";

// Chainable Supabase query double: .select()/.eq()/.upsert() return `this`,
// .maybeSingle()/.single() resolve the configured result, and the object
// itself is thenable so `await sb.from(...).upsert(...)` (no .select())
// also resolves it — matching how setProfileMasterResume calls it.
class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  constructor(private result: { data: unknown; error: unknown }) {}
  select() { return this; }
  eq() { return this; }
  upsert(payload: unknown, opts: unknown) {
    upsertCalls.push({ payload, opts });
    return this;
  }
  maybeSingle() { return Promise.resolve(this.result); }
  single() { return Promise.resolve(this.result); }
  then<TResult1, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled as any) as PromiseLike<TResult1 | TResult2>;
  }
}

let queryResult: { data: unknown; error: unknown } = { data: null, error: null };
let upsertCalls: Array<{ payload: unknown; opts: unknown }> = [];
const getUserMock = vi.fn();

vi.mock("@/lib/supabase", () => ({
  createBrowserClient: () => ({
    auth: { getUser: getUserMock },
    from: () => new FakeQuery(queryResult),
  }),
}));

import {
  getCareerProfile,
  upsertCareerProfile,
  setProfileMasterResume,
  profileToResumeContent,
  resumeContentToCareerProfileInput,
  inferExpType,
  type CareerProfile,
} from "../lib/career-profile-client";

const SAMPLE_PROFILE: CareerProfile = {
  user_id: "user-1",
  master_resume_id: null,
  contact: { name: "Jane Doe", email: "jane@example.com" },
  experience: [
    {
      id: "e1",
      type: "internship",
      company: "Acme",
      title: "SWE Intern",
      start: "2024-06",
      end: "2024-08",
      current: false,
      responsibilities: "Built things",
      achievements: "Shipped a feature",
      projects: "",
      impact: "",
    },
  ],
  projects: [
    {
      id: "p1",
      name: "Campus Marketplace",
      techStack: "React, Supabase",
      link: "https://github.com/jane/campus-marketplace",
      start: "2024-01",
      end: "2024-05",
      description: "Built a full-stack listings app; Reached 200 active users",
    },
  ],
  education: [
    { id: "ed1", institution: "MIT", degree: "BSc", field: "CS", year: "2025" },
  ],
  skills: ["React", "Python"],
  certifications: [{ id: "c1", name: "AWS SAA", issuer: "AWS", year: "2025" }],
  headline: "Aspiring SWE",
  role_status: "student",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("career-profile-client", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    queryResult = { data: null, error: null };
    upsertCalls = [];
  });

  describe("getCareerProfile", () => {
    it("returns the profile row when one exists", async () => {
      queryResult = { data: SAMPLE_PROFILE, error: null };
      const result = await getCareerProfile();
      expect(result).toEqual(SAMPLE_PROFILE);
    });

    it("returns null when no profile row exists yet", async () => {
      queryResult = { data: null, error: null };
      const result = await getCareerProfile();
      expect(result).toBeNull();
    });

    it("throws when the query errors", async () => {
      queryResult = { data: null, error: { message: "boom" } };
      await expect(getCareerProfile()).rejects.toThrow("boom");
    });

    it("throws Not authenticated when there is no user", async () => {
      getUserMock.mockResolvedValue({ data: { user: null } });
      await expect(getCareerProfile()).rejects.toThrow("Not authenticated");
    });
  });

  describe("upsertCareerProfile", () => {
    it("upserts with the current user id merged in and returns the row", async () => {
      queryResult = { data: SAMPLE_PROFILE, error: null };
      const { user_id: _uid, created_at: _c, updated_at: _u, ...input } = SAMPLE_PROFILE;
      const result = await upsertCareerProfile(input);
      expect(result).toEqual(SAMPLE_PROFILE);
      expect(upsertCalls[0].payload).toMatchObject({ user_id: "user-1" });
      expect(upsertCalls[0].opts).toEqual({ onConflict: "user_id" });
    });
  });

  describe("setProfileMasterResume", () => {
    it("upserts just the master_resume_id", async () => {
      queryResult = { data: null, error: null };
      await setProfileMasterResume("resume-42");
      expect(upsertCalls[0].payload).toEqual({ user_id: "user-1", master_resume_id: "resume-42" });
    });

    it("throws on error", async () => {
      queryResult = { data: null, error: { message: "db down" } };
      await expect(setProfileMasterResume("resume-42")).rejects.toThrow("db down");
    });
  });

  describe("profileToResumeContent", () => {
    it("maps experience with type-annotated company and filtered bullets", () => {
      const result = profileToResumeContent(SAMPLE_PROFILE) as any;
      expect(result.experience[0].company).toBe("Acme (Internship)");
      expect(result.experience[0].end).toBe("2024-08");
      expect(result.experience[0].bullets).toEqual([
        "Responsibilities: Built things",
        "Achievements: Shipped a feature",
      ]);
    });

    it("marks current roles as Present", () => {
      const profile = {
        ...SAMPLE_PROFILE,
        experience: [{ ...SAMPLE_PROFILE.experience[0], current: true }],
      };
      const result = profileToResumeContent(profile) as any;
      expect(result.experience[0].end).toBe("Present");
    });

    it("maps education and certifications", () => {
      const result = profileToResumeContent(SAMPLE_PROFILE) as any;
      expect(result.education[0]).toEqual({ institution: "MIT", degree: "BSc in CS", year: "2025" });
      expect(result.certifications).toEqual(["AWS SAA — AWS"]);
    });

    it("maps projects, splitting the description into bullets", () => {
      const result = profileToResumeContent(SAMPLE_PROFILE) as any;
      expect(result.projects[0]).toEqual({
        name: "Campus Marketplace",
        tech_stack: "React, Supabase",
        link: "https://github.com/jane/campus-marketplace",
        start: "2024-01",
        end: "2024-05",
        bullets: ["Built a full-stack listings app", "Reached 200 active users"],
      });
    });

    it("omits empty project fields rather than emitting empty strings", () => {
      const profile = {
        ...SAMPLE_PROFILE,
        projects: [{ id: "p2", name: "Solo Script", techStack: "", link: "", start: "", end: "", description: "" }],
      };
      const result = profileToResumeContent(profile) as any;
      expect(result.projects[0]).toEqual({
        name: "Solo Script",
        tech_stack: undefined,
        link: undefined,
        start: undefined,
        end: undefined,
        bullets: [],
      });
    });
  });

  describe("inferExpType", () => {
    it("detects 'Intern' as a whole word in the title", () => {
      expect(inferExpType("Talent Acquisition Intern", "K12 Techno Services")).toBe("internship");
    });

    it("detects 'Internship' as a whole word in the title", () => {
      expect(inferExpType("Software Engineering Internship", "Acme")).toBe("internship");
    });

    it("detects intern mentioned in the company instead of the title", () => {
      expect(inferExpType("Analyst", "Acme Internship Program")).toBe("internship");
    });

    it("is case-insensitive", () => {
      expect(inferExpType("INTERN", "Acme")).toBe("internship");
    });

    it("does not false-positive on 'International' containing 'intern' as a substring", () => {
      expect(inferExpType("International Business Analyst", "Acme")).toBe("full-time");
    });

    it("defaults to full-time when neither title nor company mentions intern", () => {
      expect(inferExpType("Software Engineer", "Acme")).toBe("full-time");
    });
  });

  describe("resumeContentToCareerProfileInput", () => {
    it("infers internship type from an uploaded resume's parsed job title", () => {
      const result = resumeContentToCareerProfileInput(
        {
          contact: { name: "Jane Doe", email: "jane@example.com" },
          experience: [
            { company: "K12 Techno Services", title: "Talent Acquisition Intern", start: "Apr 2022", end: "Jun 2022", bullets: [] },
            { company: "Acme Corp", title: "Senior Engineer", start: "Jan 2022", bullets: [] },
          ],
          education: [],
          skills: [],
        } as any,
        null
      );
      expect(result.experience[0].type).toBe("internship");
      expect(result.experience[1].type).toBe("full-time");
    });
  });
});

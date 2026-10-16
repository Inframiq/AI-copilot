import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ResumeContent } from "@career-copilot/types";

vi.mock("@/lib/api-client", () => ({
  apiClient: { updateResume: vi.fn().mockResolvedValue({}) },
  isResumeChanged: () => null,
}));

import { useResumeStore, withSkillList } from "../stores/resume-store";
import { sectionStates } from "../lib/section-completeness";

const BASE = {
  contact: { name: "Jane Doe", email: "jane@example.com" },
  experience: [],
  education: [],
} as unknown as ResumeContent;

// The API keeps résumé content exactly as sent, and its templates draw skills
// grouped by category too — so a résumé can arrive in a shape the Studio's
// type says it never has. Opening one crashed the Studio on skills.filter.
describe("skills reach the Studio as a flat list", () => {
  beforeEach(() => useResumeStore.getState().resetStore());

  it("flattens grouped skills, keeping their order", () => {
    const grouped = { ...BASE, skills: { Languages: ["Go", "Python"], Tools: ["Docker"] } } as unknown as ResumeContent;
    useResumeStore.getState().setResume("r1", grouped, "ats_clean");
    const content = useResumeStore.getState().content!;
    expect(content.skills).toEqual(["Go", "Python", "Docker"]);
    expect(() => sectionStates(content)).not.toThrow();
  });

  it("gives a résumé with no skills an empty list", () => {
    useResumeStore.getState().setResume("r1", BASE, "ats_clean");
    expect(useResumeStore.getState().content!.skills).toEqual([]);
    expect(() => sectionStates(useResumeStore.getState().content)).not.toThrow();
  });

  it("drops entries that are not text", () => {
    const odd = { ...BASE, skills: ["SQL", 7, null, { x: 1 }] } as unknown as ResumeContent;
    expect(withSkillList(odd).skills).toEqual(["SQL"]);
  });

  it("applies to a tailored draft too", () => {
    useResumeStore.getState().setResume("r1", { ...BASE, skills: ["SQL"] }, "ats_clean");
    useResumeStore.getState().startDraft({ ...BASE, skills: { Data: ["Spark"] } } as unknown as ResumeContent, "jd1");
    expect(useResumeStore.getState().content!.skills).toEqual(["Spark"]);
  });

  it("leaves an ordinary résumé untouched", () => {
    const plain = { ...BASE, skills: ["TypeScript"] };
    expect(withSkillList(plain)).toBe(plain);
  });
});

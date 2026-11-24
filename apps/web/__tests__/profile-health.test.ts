// Profile Health: how complete My Profile is, part by part. It was ten
// yes/no checks, so a profile read from one upload — jobs with no dates or
// points, no summary — sat at 80%.
import { describe, it, expect } from "vitest";
import { computeProfileHealth } from "@/lib/profile-health";
import type { CareerProfile, ExperienceEntry } from "@/lib/career-profile-client";

const job = (over: Partial<ExperienceEntry> = {}): ExperienceEntry => ({
  id: "j", type: "full-time", company: "Acme", title: "Accountant", location: "", start: "Jan 2020",
  end: "Dec 2022", current: false, responsibilities: "• Closed the books monthly", achievements: "",
  projects: "", impact: "", ...over,
});

const full = (over: Partial<CareerProfile> = {}): CareerProfile => ({
  user_id: "u", master_resume_id: null, role_status: "working", photo_url: null, photo_path: null,
  created_at: "", updated_at: "",
  contact: { name: "Jane Doe", email: "jane@example.com", phone: "+91 90000 00000", location: "Pune",
             linkedin: "linkedin.com/in/jane" },
  headline: "Senior Accountant",
  summary: "Accountant with six years of monthly closes and audits.",
  experience: [job(), job({ id: "k", start: "Jan 2018", end: "Dec 2019" })],
  projects: [],
  education: [{ id: "e", institution: "Pune University", degree: "B.Com", year: "2017" }],
  skills: ["Tally", "Excel", "GST", "Audit", "Payroll", "SAP"],
  certifications: [],
  ...over,
});

describe("computeProfileHealth", () => {
  it("is complete only when every part is", () => {
    expect(computeProfileHealth(full())).toEqual({ score: 100, label: "Complete" });
  });

  it("doesn't ask for GitHub or a website", () => {
    expect(computeProfileHealth(full()).score).toBe(100);
  });

  it("counts a job without points or dates as unfinished, and says which step adds the most", () => {
    // What one upload often leaves: jobs read, but no points or dates.
    const h = computeProfileHealth(full({
      experience: [job({ responsibilities: "" }), job({ id: "k", responsibilities: "", start: "", end: "" })],
    }));
    expect(h.score).toBe(75);
    expect(h.label).toBe("Add points to 2 jobs");
  });

  it("names missing dates once every job has points", () => {
    const h = computeProfileHealth(full({ experience: [job(), job({ id: "k", start: "", end: "" })] }));
    expect(h.score).toBe(88);
    expect(h.label).toBe("Add dates to 1 job");
  });

  it("takes a current job's missing end date as fine", () => {
    expect(computeProfileHealth(full({ experience: [job({ end: "", current: true })] })).score).toBe(100);
  });

  it("counts points written in a job's project cards", () => {
    const h = computeProfileHealth(full({
      experience: [job({
        responsibilities: "",
        workProjects: [{ id: "p", client: "Barclays", name: "", role: "", domain: "", start: "", end: "",
                         techStack: "", responsibilities: "• Reconciled ledgers", achievements: "", impact: "" }],
      })],
    }));
    expect(h.score).toBe(100);
  });

  it("asks for the summary", () => {
    const h = computeProfileHealth(full({ summary: null }));
    expect(h).toEqual({ score: 85, label: "Add a professional summary" });
  });

  it("counts skills up to six, not any five as all", () => {
    const h = computeProfileHealth(full({ skills: ["Tally", "Excel", "GST"] }));
    expect(h.score).toBe(93);
    expect(h.label).toBe("Add 3 more skills");
  });

  it("counts an education entry without its year as unfinished", () => {
    const h = computeProfileHealth(full({ education: [{ id: "e", institution: "Pune University", degree: "B.Com", year: "" }] }));
    expect(h).toEqual({ score: 85, label: "Finish 1 education entry" });
  });

  it("reads a student's projects and internships as their work", () => {
    const student = full({
      role_status: "student", experience: [],
      projects: [{ id: "p", name: "Campus marketplace", techStack: "React", start: "", end: "",
                   description: "• Built listings and chat" }],
    });
    expect(computeProfileHealth(student).score).toBe(100);
    expect(computeProfileHealth({ ...student, projects: [] }).label).toBe("Add a project or internship");
    const unfinished = { ...student.projects[0], description: "" };
    expect(computeProfileHealth({ ...student, projects: [unfinished] }).label).toBe("Finish 1 project");
    expect(computeProfileHealth({ ...student, experience: [job({ responsibilities: "" })] }).label).toBe("Finish 1 internship");
  });

  it("takes a student's career objective for the summary", () => {
    const student = full({ role_status: "student", summary: null, objective: "Seeking an audit internship." });
    expect(computeProfileHealth(student).score).toBe(100);
  });

  it("is zero with no profile", () => {
    expect(computeProfileHealth(null)).toEqual({ score: 0, label: "Finish your profile" });
  });
});

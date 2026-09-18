import { describe, it, expect } from "vitest";
import { readField, writeField } from "../lib/field-path";
import type { ResumeContent } from "@career-copilot/types";

const CONTENT = {
  contact: { name: "Jane", email: "jane@example.com" },
  summary: "A summary.",
  experience: [
    { company: "Acme", title: "Engineer", start: "2020", bullets: ["First", "Second"] },
  ],
  education: [{ institution: "State", degree: "BS", year: "2019" }],
  skills: ["Python", "Go"],
} as unknown as ResumeContent;

describe("readField", () => {
  it("reads a top-level string", () => {
    expect(readField(CONTENT, "summary")).toBe("A summary.");
  });
  it("reads a nested object field", () => {
    expect(readField(CONTENT, "contact.email")).toBe("jane@example.com");
  });
  it("reads an array element", () => {
    expect(readField(CONTENT, "skills.1")).toBe("Go");
  });
  it("reads a nested array element", () => {
    expect(readField(CONTENT, "experience.0.bullets.1")).toBe("Second");
  });
  it("returns undefined for a path that does not exist", () => {
    expect(readField(CONTENT, "experience.9.bullets.0")).toBeUndefined();
  });
  it("returns undefined for a malformed path", () => {
    expect(readField(CONTENT, "")).toBeUndefined();
  });
});

describe("writeField", () => {
  it("writes a top-level string", () => {
    expect(writeField(CONTENT, "summary", "New").summary).toBe("New");
  });
  it("writes a nested object field", () => {
    expect(writeField(CONTENT, "contact.email", "new@x.com").contact.email).toBe("new@x.com");
  });
  it("writes a nested array element", () => {
    const out = writeField(CONTENT, "experience.0.bullets.1", "Rewritten");
    expect(out.experience[0].bullets[1]).toBe("Rewritten");
  });
  it("does not mutate the input", () => {
    writeField(CONTENT, "summary", "New");
    expect(CONTENT.summary).toBe("A summary.");
  });
  it("leaves siblings untouched", () => {
    const out = writeField(CONTENT, "experience.0.bullets.0", "Changed");
    expect(out.experience[0].bullets[1]).toBe("Second");
    expect(out.contact.name).toBe("Jane");
  });
  it("returns the content unchanged for a path that does not exist", () => {
    // A stale data-field from an older render must never corrupt the resume.
    expect(writeField(CONTENT, "experience.9.bullets.0", "Nope")).toEqual(CONTENT);
  });
  it("returns the content unchanged for a malformed path", () => {
    expect(writeField(CONTENT, "", "Nope")).toEqual(CONTENT);
  });
  it("never invents structure for a key that is absent", () => {
    expect(writeField(CONTENT, "contact.nickname", "Janey")).toEqual(CONTENT);
  });
});

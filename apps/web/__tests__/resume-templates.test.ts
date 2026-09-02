import { describe, it, expect } from "vitest";
import { RESUME_TEMPLATES, templateRequiresPhoto } from "../lib/resume-templates";

describe("templateRequiresPhoto", () => {
  it("is true for the photo templates", () => {
    expect(templateRequiresPhoto("ats_sidebar")).toBe(true);
    expect(templateRequiresPhoto("ats_professional")).toBe(true);
  });
  it("is false for the text-only templates", () => {
    expect(templateRequiresPhoto("ats_clean")).toBe(false);
    expect(templateRequiresPhoto("ats_modern")).toBe(false);
    expect(templateRequiresPhoto("ats_minimal")).toBe(false);
  });
  it("is false for an unknown id", () => {
    expect(templateRequiresPhoto("nope")).toBe(false);
  });
  it("photo templates declare a shape", () => {
    for (const id of ["ats_sidebar", "ats_professional"]) {
      const t = RESUME_TEMPLATES.find((x) => x.id === id)!;
      expect(t).toHaveProperty("photo.shape");
    }
  });
});

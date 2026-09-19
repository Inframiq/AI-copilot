import { describe, it, expect } from "vitest";
import { RESUME_TEMPLATES, templateRequiresPhoto } from "../lib/resume-templates";

// Kept in step with pdf.py's TEMPLATES_REQUIRING_PHOTO — the API-side test
// test_the_web_gallery_lists_exactly_the_templates_the_api_renders parses this
// same file and fails if the two lists drift apart.
const PHOTO_TEMPLATES = ["ats_sidebar", "ats_professional", "ats_portrait"];
const TEXT_ONLY = [
  "ats_clean",
  "ats_modern",
  "ats_minimal",
  "ats_executive",
  "ats_compact",
  "ats_banner",
  "ats_technical",
];

describe("templateRequiresPhoto", () => {
  it.each(PHOTO_TEMPLATES)("is true for %s", (id) => {
    expect(templateRequiresPhoto(id)).toBe(true);
  });

  it.each(TEXT_ONLY)("is false for %s", (id) => {
    expect(templateRequiresPhoto(id)).toBe(false);
  });

  it("is false for an unknown id", () => {
    expect(templateRequiresPhoto("nope")).toBe(false);
  });

  it("photo templates declare a shape", () => {
    for (const id of PHOTO_TEMPLATES) {
      const t = RESUME_TEMPLATES.find((x) => x.id === id)!;
      expect(t).toHaveProperty("photo.shape");
    }
  });
});

describe("the gallery itself", () => {
  it("covers every template exactly once", () => {
    const ids = RESUME_TEMPLATES.map((t) => t.id);
    expect(ids).toHaveLength(PHOTO_TEMPLATES.length + TEXT_ONLY.length);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...PHOTO_TEMPLATES, ...TEXT_ONLY].sort());
  });

  // The picker shows a label and leans on the description as its only
  // explanation of what a tile actually is — an empty one is a blank tile.
  it("gives every template a label and a description", () => {
    for (const t of RESUME_TEMPLATES) {
      expect(t.label.trim().length).toBeGreaterThan(0);
      expect(t.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("keeps labels distinct, since the label is all the tile shows", () => {
    const labels = RESUME_TEMPLATES.map((t) => t.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

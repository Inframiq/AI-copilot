import { describe, it, expect } from "vitest";
import cases from "../../../packages/types/social-link-cases.json";
import { isSocialLinkOk, tidyContactLinks, tidySocialLink } from "@/lib/social-links";

// The same examples the database is tested against (test_migration_054.py),
// so the form and the database agree on what a profile link is.
describe.each(["linkedin", "github"] as const)("%s links", (field) => {
  it.each(cases[field].tidy)("tidies %j to %j", (typed, saved) => {
    expect(tidySocialLink(field, typed)).toBe(saved);
    // The standard form is its own standard form.
    expect(tidySocialLink(field, saved)).toBe(saved);
  });

  it.each(cases[field].refused)("refuses %j", (typed) => {
    expect(tidySocialLink(field, typed)).toBeNull();
    expect(isSocialLinkOk(field, typed)).toBe(false);
  });

  it("leaves an empty field empty", () => {
    expect(tidySocialLink(field, "  ")).toBe("");
    expect(tidySocialLink(field, undefined)).toBe("");
    expect(isSocialLinkOk(field, "")).toBe(true);
  });
});

it("refuses a GitHub name one past the 39-character limit", () => {
  expect(tidySocialLink("github", `github.com/${"a".repeat(39)}`)).toBe(`github.com/${"a".repeat(39)}`);
  expect(tidySocialLink("github", `github.com/${"a".repeat(40)}`)).toBeNull();
});

describe("tidyContactLinks", () => {
  const contact = { name: "Asha", email: "a@x.com", linkedin: "https://www.linkedin.com/in/asha/", github: "github.com/asha/repo" };

  it("puts good links in the standard form and keeps a bad one as it was", () => {
    expect(tidyContactLinks(contact)).toEqual({ ...contact, linkedin: "linkedin.com/in/asha" });
  });

  it("leaves a bad one out when asked, for a save that isn't editing links", () => {
    expect(tidyContactLinks(contact, { dropBad: true })).toEqual({ ...contact, linkedin: "linkedin.com/in/asha", github: "" });
  });

  it("doesn't add a field the contact doesn't have", () => {
    const nameOnly: { name: string; linkedin?: string } = { name: "Asha" };
    expect(tidyContactLinks(nameOnly)).toEqual({ name: "Asha" });
  });
});

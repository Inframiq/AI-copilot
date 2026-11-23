// @vitest-environment jsdom
// A degree's short form written in full (lib/degree-names). The API's
// services/degree_names.py passes the same cases.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";
import { fullDegreeName } from "@/lib/degree-names";
import { DegreeFullName } from "@/components/profile/DegreeFullName";

const CASES = JSON.parse(
  readFileSync(join(process.cwd(), "..", "..", "packages", "types", "degree-name-cases.json"), "utf8"),
) as { full: [string, string][]; none: string[] };

describe("a degree's short form, in full", () => {
  it.each(CASES.full)("%s → %s", (written, full) => {
    expect(fullDegreeName(written)).toBe(full);
    expect(fullDegreeName(full)).toBeNull();
  });

  it.each(CASES.none)("offers nothing for %j", (written) => {
    expect(fullDegreeName(written)).toBeNull();
  });
});

describe("DegreeFullName", () => {
  it("offers the full name and changes nothing until picked", () => {
    const onUse = vi.fn();
    render(<DegreeFullName value="B.Tech in CSE" onUse={onUse} />);
    expect(onUse).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Write in full: Bachelor of Technology (B.Tech) in CSE" }));
    expect(onUse).toHaveBeenCalledWith("Bachelor of Technology (B.Tech) in CSE");
  });

  it("shows nothing for a degree already in full", () => {
    const { container } = render(<DegreeFullName value="Bachelor of Technology" onUse={vi.fn()} />);
    expect(container.textContent).toBe("");
  });
});

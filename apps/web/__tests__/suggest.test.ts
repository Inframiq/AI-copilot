import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildIndex, canonicalName, fold, loadSuggestions, suggest, type SuggestKind } from "@/lib/suggest";

const KINDS: SuggestKind[] = ["skill", "jobTitle", "degree", "college", "language", "certification", "city"];

describe("fold", () => {
  it("ignores case, accents, and how a name is punctuated or spaced", () => {
    expect(fold("Node.js")).toBe(fold("node js"));
    expect(fold("NODE-JS")).toBe("node js");
    expect(fold("São Paulo")).toBe("sao paulo");
    expect(fold("C++")).toBe("c++");
    expect(fold("C#")).not.toBe(fold("C"));
  });
});

describe("suggestions from the app's own lists", () => {
  it("puts the standard name first for an alias, and ranks exact before longer names", async () => {
    const skills = await loadSuggestions("skill");
    expect(suggest(skills, "js")[0]).toBe("JavaScript");
    expect(suggest(skills, "java").slice(0, 2)).toEqual(["Java", "JavaScript"]);
    expect(suggest(skills, "react")[0]).toBe("React");
    expect(suggest(skills, "nodejs")[0]).toBe("Node.js");
    expect(suggest(skills, "c++")[0]).toBe("C++");
  });

  it("gives the list's spelling for exactly a name or an alias", async () => {
    const skills = await loadSuggestions("skill");
    expect(canonicalName(skills, "javascript")).toBe("JavaScript");
    expect(canonicalName(skills, "JS")).toBe("JavaScript");
    expect(canonicalName(skills, "node js")).toBe("Node.js");
    expect(canonicalName(skills, "postgres")).toBe("PostgreSQL");
    expect(canonicalName(skills, "Reactive programming")).toBeNull();
  });

  it("won't choose for an alias two names share", async () => {
    const titles = await loadSuggestions("jobTitle");
    expect(canonicalName(titles, "pm")).toBeNull();
    expect(suggest(titles, "pm")).toEqual(expect.arrayContaining(["Product Manager", "Project Manager"]));
  });

  it("finds a city by its start, the largest first", async () => {
    const cities = await loadSuggestions("city");
    expect(suggest(cities, "hyderabad").slice(0, 2)).toEqual(["Hyderabad, India", "Hyderabad, Pakistan"]);
    expect(suggest(cities, "visakh")).toContain("Visakhapatnam, India");
    expect(suggest(cities, "new york")[0]).toBe("New York City, United States");
  });

  it("finds colleges worldwide, by any word of the name", async () => {
    const colleges = await loadSuggestions("college");
    expect(suggest(colleges, "stanford")).toContain("Stanford University");
    expect(suggest(colleges, "bombay")).toContain("Indian Institute of Technology, Bombay");
  });

  it("finds degrees by the abbreviation people type", async () => {
    const degrees = await loadSuggestions("degree");
    expect(suggest(degrees, "btech")[0]).toBe("Bachelor of Technology (B.Tech)");
    expect(canonicalName(degrees, "MBA")).toBe("Master of Business Administration (MBA)");
  });

  it("gives at most eight, and nothing for nothing typed", async () => {
    const cities = await loadSuggestions("city");
    expect(suggest(cities, "a")).toHaveLength(8);
    expect(suggest(cities, "  ")).toEqual([]);
  });

  it("loads each list once, for every field of its kind", async () => {
    expect(loadSuggestions("skill")).toBe(loadSuggestions("skill"));
  });
});

describe("the lists themselves", () => {
  const dir = join(process.cwd(), "lib/suggest/data");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

  it("are all loadable by a kind", async () => {
    expect(files.sort()).toEqual(
      ["certifications", "cities", "colleges", "degrees", "job-titles", "languages", "skills"].map((f) => `${f}.json`),
    );
    for (const kind of KINDS) expect((await loadSuggestions(kind)).entries.length, kind).toBeGreaterThan(50);
  });

  it.each(files)("%s says where it comes from, and repeats no name", (file) => {
    const data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    expect(data.source).toBeTruthy();
    const names = data.names.map((n: string | string[]) => (typeof n === "string" ? n : n[0]));
    expect(names.every((n: string) => typeof n === "string" && n.trim() === n && n.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  it("carry the licence of the public datasets they're built from", () => {
    const cities = JSON.parse(readFileSync(join(dir, "cities.json"), "utf8"));
    const colleges = JSON.parse(readFileSync(join(dir, "colleges.json"), "utf8"));
    expect(cities.license).toMatch(/CC BY 4\.0/);
    expect(colleges.license).toMatch(/MIT License/);
  });

  it("never let an alias stand for a name in another entry by accident", () => {
    // An alias equal to another entry's own name would make that name
    // ambiguous, and stop it ever being chosen for exactly what's typed.
    for (const file of ["skills", "job-titles", "degrees", "languages", "certifications"]) {
      const data = JSON.parse(readFileSync(join(dir, `${file}.json`), "utf8"));
      const index = buildIndex(data.names);
      for (const item of data.names) {
        const name = typeof item === "string" ? item : item[0];
        expect(canonicalName(index, name), `${file}: ${name}`).toBe(name);
      }
    }
  });
});

import { describe, it, expect } from "vitest";
import { classifyChange } from "@/lib/point-kind";
import type { BulletChange } from "@/stores/tailoring-store";

const ORIGINAL = {
  contact: { name: "Jane" },
  summary: "Backend engineer working with Docker.",
  experience: [
    { title: "Engineer", company: "Acme", bullets: ["Managed the deploy process.", "Built services in Python."] },
  ],
  education: [],
  skills: ["Python", "CI/CD"],
} as never;

const change = (tailored: string, bulletIdx = 0): BulletChange => ({
  key: `exp0_b${bulletIdx}`, jobIdx: 0, bulletIdx, jobTitle: "Engineer", company: "Acme",
  original: "Managed the deploy process.", tailored,
});

describe("classifyChange", () => {
  it("is a rewording when every targeted keyword is already evidenced in the résumé", () => {
    const r = classifyChange(
      change("Owned the CI/CD deploy process for Python services."),
      { responsibility: "own deploys", keywords: ["CI/CD", "Python"] },
      ORIGINAL,
    );
    expect(r).toEqual({ kind: "reworded", newTerms: [] });
  });

  it("names the JD terms the rewrite adds that the résumé never mentions", () => {
    const r = classifyChange(
      change("Managed Kubernetes deploys with Docker and Terraform."),
      { responsibility: "", keywords: ["Kubernetes", "Docker", "Terraform", "Go"] },
      ORIGINAL,
    );
    // Docker is in the summary; Go is targeted but never made it into the text.
    expect(r).toEqual({ kind: "adds_terms", newTerms: ["Kubernetes", "Terraform"] });
  });

  it("matches whole terms only, case-insensitively", () => {
    const r = classifyChange(
      change("Managed deploys using go-to-market tooling in PYTHON."),
      { responsibility: "", keywords: ["Go", "python"] },
      ORIGINAL,
    );
    expect(r).toEqual({ kind: "reworded", newTerms: [] });
  });

  it("catches a JD term the rewrite slipped in without targeting it", () => {
    const r = classifyChange(
      change("Managed deploys with Terraform."),
      { responsibility: "", keywords: [] },
      ORIGINAL,
      ["Terraform", "Python", "Kubernetes"],
    );
    expect(r).toEqual({ kind: "adds_terms", newTerms: ["Terraform"] });
  });

  it("names each new term once, however it was sourced", () => {
    const r = classifyChange(
      change("Ran Kubernetes deploys."),
      { responsibility: "", keywords: ["Kubernetes"] },
      ORIGINAL,
      ["kubernetes"],
    );
    expect(r.newTerms).toEqual(["Kubernetes"]);
  });

  it("is a rewording when there is no rationale to check", () => {
    expect(classifyChange(change("Ran deploys."), undefined, ORIGINAL).kind).toBe("reworded");
  });
});

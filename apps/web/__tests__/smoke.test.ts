import { describe, it, expect } from "vitest";
// Verify critical imports compile without error
import { useResumeStore } from "../stores/resume-store";
import { useTailoringStore } from "../stores/tailoring-store";
import { apiClient } from "../lib/api-client";

describe("smoke", () => {
  it("resume store exists", () => expect(useResumeStore).toBeDefined());
  it("tailoring store exists", () => expect(useTailoringStore).toBeDefined());
  it("apiClient exists", () => expect(apiClient).toBeDefined());
});

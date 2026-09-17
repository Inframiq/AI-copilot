import { describe, it, expect } from "vitest";
import { diffWords, type DiffOp } from "../lib/word-diff";

/** Reassemble one side of the diff, to prove no text is lost or duplicated. */
const original = (ops: DiffOp[]) => ops.filter((o) => o.type !== "insert").map((o) => o.text).join("");
const tailored = (ops: DiffOp[]) =>
  ops.filter((o) => o.type !== "delete").map((o) => o.tailoredText ?? o.text).join("");

describe("diffWords", () => {
  it("marks an identical string as all equal", () => {
    const ops = diffWords("Built the checkout flow", "Built the checkout flow");
    expect(ops.every((o) => o.type === "equal")).toBe(true);
  });

  it("round-trips both sides exactly", () => {
    const a = "Reduced checkout latency by 40% for users";
    const b = "Cut end-to-end checkout latency 40% across users";
    const ops = diffWords(a, b);
    expect(original(ops)).toBe(a);
    expect(tailored(ops)).toBe(b);
  });

  it("marks an added word as an insert", () => {
    const ops = diffWords("Built checkout", "Built resilient checkout");
    const inserted = ops.filter((o) => o.type === "insert").map((o) => o.text.trim()).filter(Boolean);
    expect(inserted).toContain("resilient");
  });

  it("marks a removed word as a delete", () => {
    const ops = diffWords("Built resilient checkout", "Built checkout");
    const deleted = ops.filter((o) => o.type === "delete").map((o) => o.text.trim()).filter(Boolean);
    expect(deleted).toContain("resilient");
  });

  it("marks a swapped word as both a delete and an insert", () => {
    const ops = diffWords("Built the checkout flow", "Engineered the checkout flow");
    expect(ops.filter((o) => o.type === "delete").map((o) => o.text.trim())).toContain("Built");
    expect(ops.filter((o) => o.type === "insert").map((o) => o.text.trim())).toContain("Engineered");
  });

  it("leaves untouched words equal when only one word changes", () => {
    const ops = diffWords("Built the checkout flow", "Engineered the checkout flow");
    const kept = ops.filter((o) => o.type === "equal").map((o) => o.text).join("");
    expect(kept).toContain("the checkout flow");
  });

  it("treats punctuation attached to a word as part of it", () => {
    const ops = diffWords("Shipped checkout.", "Shipped checkout!");
    expect(original(ops)).toBe("Shipped checkout.");
    expect(tailored(ops)).toBe("Shipped checkout!");
  });

  it("is case sensitive so a capitalisation change is visible", () => {
    const ops = diffWords("built checkout", "Built checkout");
    expect(ops.some((o) => o.type === "insert")).toBe(true);
  });

  it("handles an empty original", () => {
    const ops = diffWords("", "Brand new bullet");
    expect(tailored(ops)).toBe("Brand new bullet");
    expect(original(ops)).toBe("");
  });

  it("handles an empty rewrite", () => {
    const ops = diffWords("Old bullet", "");
    expect(original(ops)).toBe("Old bullet");
    expect(tailored(ops)).toBe("");
  });

  it("merges adjacent ops of the same type into one segment", () => {
    const ops = diffWords("a b c d", "a x y d");
    // "b c" deleted and "x y" inserted should each be a single run, not
    // four separate one-word ops — the UI highlights runs, not words.
    expect(ops.filter((o) => o.type === "delete")).toHaveLength(1);
    expect(ops.filter((o) => o.type === "insert")).toHaveLength(1);
  });

  it("does not blow up on a long summary-length pair", () => {
    const a = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    const b = Array.from({ length: 200 }, (_, i) => `word${i * 2}`).join(" ");
    expect(() => diffWords(a, b)).not.toThrow();
  });

  it("keeps the rewrite's own spacing before a trailing insert", () => {
    // "team" ends the original with no trailing space; the rewrite continues
    // past it. Reusing the original's token would render "teamof 6".
    const ops = diffWords("Led a team", "Led a team of 6");
    expect(tailored(ops)).toBe("Led a team of 6");
  });

  it("keeps the original's own spacing before a trailing delete", () => {
    const ops = diffWords("Led a team of 6", "Led a team");
    expect(original(ops)).toBe("Led a team of 6");
  });
});

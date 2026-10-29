import { describe, it, expect } from "vitest";
import data from "../../../packages/types/plain-text-cases.json";
import { plainDeep, plainText } from "../lib/plain-text";

const cases = data.cases as Array<[string, string]>;

describe("plainText — the cases shared with the API", () => {
  it.each(cases)("%j", (raw, plain) => {
    expect(plainText(raw)).toBe(plain);
    expect(plainText(plain)).toBe(plain);
  });
});

describe("plainDeep", () => {
  it("cleans every string inside, and moves nothing else", () => {
    const value = {
      name: "Jane\u00a0Doe",
      photo_url: null,
      points: ["Cut cost \u2014 by 20%", "\u201cOwned\u201d it"],
      current: true,
      n: 3,
    };
    expect(plainDeep(value)).toEqual({
      name: "Jane Doe",
      photo_url: null,
      points: ["Cut cost - by 20%", '"Owned" it'],
      current: true,
      n: 3,
    });
  });
});

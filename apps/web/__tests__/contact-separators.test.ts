// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { hideLineEndSeparators } from "@/lib/contact-separators";

/** A contact line laid out as given: each node's top, in order. jsdom has
 *  no layout, so the positions are supplied. */
function line(tops: Array<[kind: "item" | "sep", top: number]>) {
  const root = document.createElement("div");
  const div = document.createElement("div");
  root.appendChild(div);
  tops.forEach(([kind, top], i) => {
    const span = document.createElement("span");
    if (kind === "sep") span.setAttribute("data-contact-sep", String(i));
    else span.className = "contact-item";
    span.getBoundingClientRect = () => ({ top, bottom: top + 12, left: 0, right: 0, width: 0, height: 12, x: 0, y: top, toJSON: () => ({}) });
    div.appendChild(span);
  });
  return root;
}

const visible = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>("[data-contact-sep]")).map((s) => s.style.visibility !== "hidden");

describe("hideLineEndSeparators", () => {
  it("hides only the separator whose next item starts a new line", () => {
    const root = line([["item", 0], ["sep", 0], ["item", 0], ["sep", 0], ["item", 14], ["sep", 14], ["item", 14]]);
    expect(hideLineEndSeparators(root)).toBe(1);
    expect(visible(root)).toEqual([true, false, true]);
  });

  it("leaves a line that fits alone", () => {
    const root = line([["item", 0], ["sep", 0], ["item", 0]]);
    expect(hideLineEndSeparators(root)).toBe(0);
    expect(visible(root)).toEqual([true]);
  });

  it("shows a separator again once the line no longer wraps", () => {
    const root = line([["item", 0], ["sep", 0], ["item", 14]]);
    hideLineEndSeparators(root);
    const item = root.querySelectorAll("span")[2] as HTMLElement;
    item.getBoundingClientRect = () => ({ top: 0, bottom: 12, left: 0, right: 0, width: 0, height: 12, x: 0, y: 0, toJSON: () => ({}) });
    expect(hideLineEndSeparators(root)).toBe(0);
    expect(visible(root)).toEqual([true]);
  });
});

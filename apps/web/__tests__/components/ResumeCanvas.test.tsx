// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ResumeCanvas } from "../../components/studio/ResumeCanvas";

const HTML = `<div><p data-field="summary">Old summary.</p>
<span data-field="experience.0.bullets.0">Old bullet.</span></div>`;

function shadow(container: HTMLElement) {
  const host = container.querySelector("[data-canvas]") as HTMLElement;
  return host.shadowRoot ?? host;
}

function fields(container: HTMLElement) {
  return shadow(container).querySelectorAll<HTMLElement>("[data-field]");
}

describe("ResumeCanvas", () => {
  it("renders the document", () => {
    const { container } = render(<ResumeCanvas html={HTML} editable={false} onEdit={() => {}} />);
    expect(fields(container).length).toBe(2);
  });

  it("isolates the document in a shadow root", () => {
    // The template ships its own <style> including @page rules; letting those
    // into the app's cascade would restyle the surrounding UI.
    const { container } = render(<ResumeCanvas html={HTML} editable={false} onEdit={() => {}} />);
    expect((container.querySelector("[data-canvas]") as HTMLElement).shadowRoot).toBeTruthy();
  });

  // jsdom does not implement the isContentEditable property, so assert on
  // the attribute the component actually sets.
  it("marks annotated regions editable in edit mode", () => {
    const { container } = render(<ResumeCanvas html={HTML} editable onEdit={() => {}} />);
    expect(fields(container)[0].getAttribute("contenteditable")).toBe("true");
  });

  it("leaves them read-only in preview mode", () => {
    const { container } = render(<ResumeCanvas html={HTML} editable={false} onEdit={() => {}} />);
    expect(fields(container)[0].getAttribute("contenteditable")).toBe("false");
  });

  it("reports an edit with its field path and new text", () => {
    const onEdit = vi.fn();
    const { container } = render(<ResumeCanvas html={HTML} editable onEdit={onEdit} />);
    const node = fields(container)[0];
    node.textContent = "New summary.";
    fireEvent.blur(node);
    expect(onEdit).toHaveBeenCalledWith("summary", "New summary.");
  });

  it("reports the indexed path for a bullet", () => {
    const onEdit = vi.fn();
    const { container } = render(<ResumeCanvas html={HTML} editable onEdit={onEdit} />);
    const node = fields(container)[1];
    node.textContent = "New bullet.";
    fireEvent.blur(node);
    expect(onEdit).toHaveBeenCalledWith("experience.0.bullets.0", "New bullet.");
  });

  it("does not report an edit when the text is unchanged", () => {
    const onEdit = vi.fn();
    const { container } = render(<ResumeCanvas html={HTML} editable onEdit={onEdit} />);
    fireEvent.blur(fields(container)[0]);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("does not report edits at all in preview mode", () => {
    const onEdit = vi.fn();
    const { container } = render(<ResumeCanvas html={HTML} editable={false} onEdit={onEdit} />);
    const node = fields(container)[0];
    node.textContent = "Changed anyway.";
    fireEvent.blur(node);
    expect(onEdit).not.toHaveBeenCalled();
  });

  // §13 — without this, an editable region is indistinguishable from a
  // read-only one and the only way to discover editing is to click and hope.
  it("gives editable regions a visible affordance", () => {
    const { container } = render(<ResumeCanvas html={HTML} editable onEdit={() => {}} />);
    const style = shadow(container).querySelector("style[data-studio-affordance]");
    expect(style?.textContent).toContain("[data-field]:hover");
  });

  it("adds no affordance styling in preview mode", () => {
    const { container } = render(<ResumeCanvas html={HTML} editable={false} onEdit={() => {}} />);
    expect(shadow(container).querySelector("style[data-studio-affordance]")).toBeNull();
  });

  it("commits the field on Enter rather than inserting a line break", () => {
    const onEdit = vi.fn();
    const { container } = render(<ResumeCanvas html={HTML} editable onEdit={onEdit} />);
    const node = fields(container)[0];
    node.textContent = "New summary.";
    // dispatchEvent returns false when the handler called preventDefault, which
    // is what stops the browser injecting a <br> into a one-line résumé field.
    expect(fireEvent.keyDown(node, { key: "Enter" })).toBe(false);
    expect(onEdit).toHaveBeenCalledWith("summary", "New summary.");
  });

  it("does not report the same edit twice when Enter is followed by blur", () => {
    const onEdit = vi.fn();
    const { container } = render(<ResumeCanvas html={HTML} editable onEdit={onEdit} />);
    const node = fields(container)[0];
    node.textContent = "New summary.";
    fireEvent.keyDown(node, { key: "Enter" });
    fireEvent.blur(node);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("leaves Shift+Enter alone", () => {
    const onEdit = vi.fn();
    const { container } = render(<ResumeCanvas html={HTML} editable onEdit={onEdit} />);
    const node = fields(container)[0];
    node.textContent = "New summary.";
    expect(fireEvent.keyDown(node, { key: "Enter", shiftKey: true })).toBe(true);
    expect(onEdit).not.toHaveBeenCalled();
  });
});

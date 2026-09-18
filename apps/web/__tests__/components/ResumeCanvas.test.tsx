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

  // @page is a print-only rule: browsers ignore it entirely, so the document
  // rendered edge-to-edge on screen while the exported PDF had half an inch
  // of margin. The Studio's whole premise is that they are the same document.
  it("gives the page the margin its own @page rule declares", () => {
    const html = `<style>@page { margin: 0.5in; }</style><p data-field="summary">x</p>`;
    const { container } = render(<ResumeCanvas html={html} editable={false} onEdit={() => {}} />);
    const host = container.querySelector("[data-canvas]") as HTMLElement;
    expect(host.style.padding).toBe("0.5in");
  });

  it("reads the margin past other @page descriptors", () => {
    const html = `<style>@page { size: Letter; margin: 1in; }</style><p data-field="summary">x</p>`;
    const { container } = render(<ResumeCanvas html={html} editable={false} onEdit={() => {}} />);
    expect((container.querySelector("[data-canvas]") as HTMLElement).style.padding).toBe("1in");
  });

  it("leaves the page unpadded when it declares no page margin", () => {
    const { container } = render(<ResumeCanvas html={HTML} editable={false} onEdit={() => {}} />);
    expect((container.querySelector("[data-canvas]") as HTMLElement).style.padding).toBe("");
  });

  // Skills render as one comma-joined line, so the whole line is the field and
  // it has to be split back into the array the résumé actually stores.
  it("splits a joined list back into an array on its own separator", () => {
    const onEdit = vi.fn();
    const html = `<div data-field="skills" data-field-split=", ">Python, SQL</div>`;
    const { container } = render(<ResumeCanvas html={html} editable onEdit={onEdit} />);
    const node = fields(container)[0];
    node.textContent = "Python, SQL, Go";
    fireEvent.blur(node);
    expect(onEdit).toHaveBeenCalledWith("skills", ["Python", "SQL", "Go"]);
  });

  it("drops blanks left by trailing or doubled separators", () => {
    const onEdit = vi.fn();
    const html = `<div data-field="skills" data-field-split=", ">Python</div>`;
    const { container } = render(<ResumeCanvas html={html} editable onEdit={onEdit} />);
    const node = fields(container)[0];
    node.textContent = "Python,  , SQL,";
    fireEvent.blur(node);
    expect(onEdit).toHaveBeenCalledWith("skills", ["Python", "SQL"]);
  });

  it("splits on a separator that is not a comma", () => {
    const onEdit = vi.fn();
    const html = `<div data-field="skills" data-field-split=" · ">Python · SQL</div>`;
    const { container } = render(<ResumeCanvas html={html} editable onEdit={onEdit} />);
    const node = fields(container)[0];
    node.textContent = "Python · SQL · Go";
    fireEvent.blur(node);
    expect(onEdit).toHaveBeenCalledWith("skills", ["Python", "SQL", "Go"]);
  });

  it("leaves an ordinary field a plain string", () => {
    const onEdit = vi.fn();
    const { container } = render(<ResumeCanvas html={HTML} editable onEdit={onEdit} />);
    const node = fields(container)[0];
    node.textContent = "New summary.";
    fireEvent.blur(node);
    expect(onEdit).toHaveBeenCalledWith("summary", "New summary.");
  });

  // Prose fields carry the toolbar's formatting, so they must round-trip
  // markup. Reading textContent would silently throw every bold away on the
  // next blur, which is worse than not offering the button at all.
  it("keeps the formatting on a field marked rich", () => {
    const onEdit = vi.fn();
    const html = `<p data-field="summary" data-field-rich>Old.</p>`;
    const { container } = render(<ResumeCanvas html={html} editable onEdit={onEdit} />);
    const node = fields(container)[0];
    node.innerHTML = "Owned <b>end-to-end</b> delivery.";
    fireEvent.blur(node);
    expect(onEdit).toHaveBeenCalledWith("summary", "Owned <b>end-to-end</b> delivery.");
  });

  it("strips the wrapper markup contenteditable adds to a rich field", () => {
    const onEdit = vi.fn();
    const html = `<p data-field="summary" data-field-rich>Old.</p>`;
    const { container } = render(<ResumeCanvas html={html} editable onEdit={onEdit} />);
    const node = fields(container)[0];
    node.innerHTML = '<div><b style="">x</b></div>';
    fireEvent.blur(node);
    expect(onEdit).toHaveBeenCalledWith("summary", "<b>x</b>");
  });

  it("lets a rich field accept formatting at all", () => {
    // plaintext-only would make execCommand("bold") a no-op, so these fields
    // opt out of the paste protection the others keep.
    const html = `<p data-field="summary" data-field-rich>Old.</p>`;
    const { container } = render(<ResumeCanvas html={html} editable onEdit={() => {}} />);
    expect(fields(container)[0].getAttribute("contenteditable")).toBe("true");
  });

  it("reports nothing when a rich field's markup is unchanged", () => {
    const onEdit = vi.fn();
    const html = `<p data-field="summary" data-field-rich>Old <b>bold</b>.</p>`;
    const { container } = render(<ResumeCanvas html={html} editable onEdit={onEdit} />);
    fireEvent.blur(fields(container)[0]);
    expect(onEdit).not.toHaveBeenCalled();
  });
});


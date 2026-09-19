// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResumeCanvas } from "../../components/studio/ResumeCanvas";
import { LinkEditor } from "../../components/studio/LinkEditor";
import { writeField } from "../../lib/field-path";
import type { ResumeContent } from "@career-copilot/types";

const HTML = `<div class="contact"><span data-field="contact.email">a@b.com</span> |
<span data-field="contact.linkedin"><a href="https://linkedin.com/in/jane" data-link="contact.linkedin"
 data-link-url="linkedin.com/in/jane" data-link-text="LinkedIn">LinkedIn</a></span></div>`;

function shadow(container: HTMLElement) {
  const host = container.querySelector("[data-canvas]") as HTMLElement;
  return host.shadowRoot ?? host;
}

const LINK = { path: "contact.linkedin", url: "linkedin.com/in/jane", text: "LinkedIn", rect: { top: 0, bottom: 20, left: 10 } };

describe("editing links in the Studio", () => {
  it("opens the link editor instead of following or typing into a link", () => {
    const onEditLink = vi.fn();
    const { container } = render(
      <ResumeCanvas html={HTML} editable onEdit={() => {}} onEditLink={onEditLink} />,
    );
    const root = shadow(container);
    const link = root.querySelector<HTMLElement>("[data-link]")!;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(onEditLink).toHaveBeenCalledWith(
      expect.objectContaining({ path: "contact.linkedin", url: "linkedin.com/in/jane", text: "LinkedIn" }),
    );
    // The field holding the link is not typed into in place.
    const wrapper = root.querySelector<HTMLElement>('[data-field="contact.linkedin"]')!;
    expect(wrapper.getAttribute("contenteditable")).toBe("false");
    // Other contact fields still are.
    expect(root.querySelector('[data-field="contact.email"]')!.getAttribute("contenteditable")).toBe("true");
  });

  it("opens from the keyboard too", () => {
    const onEditLink = vi.fn();
    const { container } = render(
      <ResumeCanvas html={HTML} editable onEdit={() => {}} onEditLink={onEditLink} />,
    );
    const link = shadow(container).querySelector<HTMLElement>("[data-link]")!;
    expect(link.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(link, { key: "Enter" });
    expect(onEditLink).toHaveBeenCalledTimes(1);
  });

  it("does nothing to links in preview mode", () => {
    const onEditLink = vi.fn();
    const { container } = render(
      <ResumeCanvas html={HTML} editable={false} onEdit={() => {}} onEditLink={onEditLink} />,
    );
    shadow(container).querySelector<HTMLElement>("[data-link]")!.click();
    expect(onEditLink).not.toHaveBeenCalled();
  });

  it("saves the display text and the URL separately", () => {
    const onSave = vi.fn();
    render(<LinkEditor link={LINK} onSave={onSave} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Display text"), { target: { value: "My LinkedIn" } });
    fireEvent.change(screen.getByLabelText("Link URL"), { target: { value: " linkedin.com/in/jane-doe " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("linkedin.com/in/jane-doe", "My LinkedIn");
  });

  it("will not save a link with no URL", () => {
    const onSave = vi.fn();
    render(<LinkEditor link={LINK} onSave={onSave} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Link URL"), { target: { value: "  " } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<LinkEditor link={LINK} onSave={() => {}} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("writeField createLeaf", () => {
  const content = {
    contact: { name: "Jane", email: "j@x.com", linkedin: "linkedin.com/in/jane" },
    experience: [], education: [], skills: [],
  } as unknown as ResumeContent;

  it("adds a new key only when asked", () => {
    expect(writeField(content, "contact.linkedin_label", "LinkedIn")).toBe(content);
    const next = writeField(content, "contact.linkedin_label", "LinkedIn", { createLeaf: true });
    expect(next.contact.linkedin_label).toBe("LinkedIn");
    expect(content.contact.linkedin_label).toBeUndefined();
  });

  it("never creates a parent or an array slot", () => {
    expect(writeField(content, "projects.0.link_label", "x", { createLeaf: true })).toBe(content);
    expect(writeField(content, "experience.3", "x", { createLeaf: true })).toBe(content);
  });
});

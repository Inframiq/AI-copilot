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

  it("offers to add each link a project is missing, beside its name", () => {
    const onEditLink = vi.fn();
    const html = `<div class="job-row"><span data-field="projects.0.name">OdTect</span> &middot;
<span><a href="https://github.com/j/o" data-link="projects.0.link" data-link-url="github.com/j/o" data-link-text="GitHub">GitHub</a></span></div>
<div class="job-row"><span data-field="projects.1.name">Disk Monitor</span></div>
<div><span data-field="experience.0.name">Not a project</span></div>`;
    const { container } = render(
      <ResumeCanvas html={html} editable onEdit={() => {}} onEditLink={onEditLink} />,
    );
    const root = shadow(container);
    const labels = (i: number) =>
      Array.from(root.querySelector(`[data-field="projects.${i}.name"]`)!.nextElementSibling!.querySelectorAll("button"))
        .map((b) => b.textContent);

    expect(labels(0)).toEqual(["+ Live link"]);
    expect(labels(1)).toEqual(["+ Link", "+ Live link"]);
    expect(root.querySelectorAll("[data-studio-add-links]")).toHaveLength(2);

    const add = root.querySelector('[data-field="projects.0.name"]')!.nextElementSibling!.querySelector("button")!;
    add.click();
    expect(onEditLink).toHaveBeenCalledWith(
      expect.objectContaining({ path: "projects.0.live_link", url: "", text: "" }),
    );
  });

  it("offers no add-link buttons in preview mode", () => {
    const html = `<div><span data-field="projects.0.name">Disk Monitor</span></div>`;
    const { container } = render(
      <ResumeCanvas html={html} editable={false} onEdit={() => {}} onEditLink={() => {}} />,
    );
    expect(shadow(container).querySelector("[data-studio-add-links]")).toBeNull();
  });

  it("removes an existing link, but offers no remove while adding one", () => {
    const onRemove = vi.fn();
    const { unmount } = render(<LinkEditor link={LINK} onSave={() => {}} onRemove={onRemove} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalled();
    unmount();

    render(
      <LinkEditor link={{ ...LINK, url: "", text: "" }} onSave={() => {}} onRemove={onRemove} onClose={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
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

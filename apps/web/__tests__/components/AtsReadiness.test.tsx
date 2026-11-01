// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AtsView } from "../../components/studio/AtsView";
import { SpacingPanel } from "../../components/studio/controls/SpacingPanel";
import { TypePanel } from "../../components/studio/controls/TypePanel";
import { TemplateGallery } from "../../components/studio/controls/TemplateGallery";
import { useResumeStore } from "../../stores/resume-store";
import { accentReadsOnWhite, contrastOnWhite } from "../../lib/accent-contrast";
import { ensureResumeFonts, resumeFontFaceCss, RESUME_FONT_FILES } from "../../lib/resume-fonts";
import { RESUME_TEMPLATES } from "../../lib/resume-templates";

describe("ATS view", () => {
  const text = "Jane Doe\njane@x.com | +1 555 010 0100\nEXPERIENCE\nEngineer, Acme | Jun 2022 - Present";

  it("shows the extracted text beside the findings", () => {
    render(
      <AtsView
        data={{
          text,
          page_count: 1,
          findings: [
            { id: "link-unreadable", level: "error", message: "The link x.com did not come out.", field: "contact.linkedin" },
            { id: "filler", level: "warning", message: 'Lead with what was done, not "responsible for".', field: "experience.1.bullets.0" },
          ],
        }}
        isPending={false}
        isError={false}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByRole("region", { name: "Text an ATS reads" }).textContent).toContain("Engineer, Acme | Jun 2022 - Present");
    expect(screen.getByText("1 problem an ATS would trip on")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Problems" }).textContent).toContain("Contact: The link x.com did not come out.");
    expect(screen.getByRole("list", { name: "Suggestions" }).textContent).toContain("Experience 2:");
  });

  it("says so when nothing would trip a parser", () => {
    render(<AtsView data={{ text, page_count: 1, findings: [] }} isPending={false} isError={false} onRetry={() => {}} />);
    expect(screen.getByRole("status").textContent).toMatch(/reads cleanly/i);
    expect(screen.queryByRole("list", { name: "Problems" })).toBeNull();
  });

  it("waits, then offers a retry on failure", () => {
    const { rerender } = render(<AtsView data={undefined} isPending isError={false} onRetry={() => {}} />);
    expect(screen.getByText("Reading the export")).toBeTruthy();
    let retried = false;
    rerender(<AtsView data={undefined} isPending={false} isError onRetry={() => { retried = true; }} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retried).toBe(true);
  });
});

describe("paper size", () => {
  beforeEach(() => useResumeStore.getState().resetStore());

  it("starts on A4 and switches to Letter", () => {
    render(<SpacingPanel />);
    const a4 = screen.getByRole("radio", { name: /A4/ });
    const letter = screen.getByRole("radio", { name: /Letter/ });
    expect(a4.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(letter);
    expect(useResumeStore.getState().pageSize).toBe("Letter");
    expect(useResumeStore.getState().isDirty).toBe(true);
  });

  it("is what a loaded résumé saved, and A4 when it saved none", () => {
    useResumeStore.getState().setResume("r1", { contact: { name: "J" } } as never, "ats_clean",
      undefined, undefined, undefined, undefined, undefined, undefined, null, "Letter");
    expect(useResumeStore.getState().pageSize).toBe("Letter");
    useResumeStore.getState().setResume("r2", { contact: { name: "J" } } as never, "ats_clean");
    expect(useResumeStore.getState().pageSize).toBe("A4");
  });

  it("new résumés start at 1.15 line spacing, the top of the ATS band", () => {
    expect(useResumeStore.getState().lineSpacing).toBe(1.15);
  });
});

describe("accent colour", () => {
  it("matches the server's 4.5:1 rule", () => {
    expect(accentReadsOnWhite("#111111")).toBe(true);
    expect(accentReadsOnWhite("#5c6bc0")).toBe(true);
    for (const light of ["#ffffff", "#f5f5f5", "#ffee88", "#00aa55"]) expect(accentReadsOnWhite(light)).toBe(false);
    expect(contrastOnWhite("not a colour")).toBe(0);
  });

  it("says when a colour is too light to be used", () => {
    useResumeStore.getState().resetStore();
    useResumeStore.getState().setAccentColor("#f5f5f5");
    render(<TypePanel />);
    expect(screen.getByRole("status").textContent).toMatch(/too light/i);
  });
});

describe("résumé fonts", () => {
  it("declares all four faces of every bundled family", () => {
    const css = resumeFontFaceCss();
    for (const [family, file] of Object.entries(RESUME_FONT_FILES)) {
      for (const suffix of ["Regular", "Bold", "Italic", "BoldItalic"]) {
        expect(css).toContain(`/fonts/resume/${file}-${suffix}.ttf`);
      }
      expect(css).toContain(`font-family: "${family}"`);
    }
  });

  it("registers once, on the document", () => {
    ensureResumeFonts();
    ensureResumeFonts();
    expect(document.head.querySelectorAll("style#resume-fonts")).toHaveLength(1);
  });
});

describe("template gallery", () => {
  it("labels the photo templates as not for job portals", () => {
    render(<TemplateGallery value="ats_clean" onChange={() => {}} />);
    const photo = RESUME_TEMPLATES.filter((t) => "photo" in t);
    expect(screen.getAllByText("Photo · not for job portals")).toHaveLength(photo.length);
  });
});

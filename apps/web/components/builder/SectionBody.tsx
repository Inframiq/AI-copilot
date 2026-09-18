"use client";
import type { SectionId } from "@/lib/section-completeness";
import { ContactSection } from "@/components/studio/canvas/ContactSection";
import { SummarySection } from "@/components/studio/canvas/SummarySection";
import { ExperienceSection } from "@/components/studio/canvas/ExperienceSection";
import { EducationSection } from "@/components/studio/canvas/EducationSection";
import { SkillsSection } from "@/components/studio/canvas/SkillsSection";
import { ExtrasSection } from "@/components/studio/canvas/ExtrasSection";

/**
 * Renders one section's editor.
 *
 * Extracted from SectionChain's private `bodyFor` switch so the Builder can
 * show a single section without the accordion around it. SectionChain itself
 * is removed once the Builder serves the studio route — with StudioShell gone
 * it has no other consumer, so this mapping is the part worth keeping.
 */
export function SectionBody({ id, focusIndex }: { id: SectionId; focusIndex?: number }) {
  switch (id) {
    case "contact":
      return <ContactSection />;
    case "summary":
      return <SummarySection />;
    case "experience":
      return <ExperienceSection focusIndex={focusIndex} />;
    case "education":
      return <EducationSection focusIndex={focusIndex} />;
    case "skills":
      return <SkillsSection />;
    case "extras":
      return <ExtrasSection />;
  }
}

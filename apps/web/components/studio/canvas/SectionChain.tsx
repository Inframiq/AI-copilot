"use client";
import { sectionStates, type SectionId } from "@/lib/section-completeness";
import type { ResumeContent } from "@career-copilot/types";
import { SectionBand } from "./SectionBand";
import { ContactSection } from "./ContactSection";
import { SummarySection } from "./SummarySection";
import { ExperienceSection } from "./ExperienceSection";
import { EducationSection } from "./EducationSection";
import { SkillsSection } from "./SkillsSection";
import { ExtrasSection } from "./ExtrasSection";

// A collapsed band still has to say what is inside it, or the chain is
// just six labels. Every branch returns real text — never an empty string,
// which would read as a rendering bug.
export function sectionDigest(content: ResumeContent | null, id: SectionId): string {
  if (!content) return "Nothing added yet";
  const list = (names: string[]) =>
    names.length === 0
      ? "Nothing added yet"
      : names.length <= 2
      ? names.join(" · ")
      : `${names.slice(0, 2).join(" · ")} · ${names.length - 2} more`;

  switch (id) {
    case "contact":
      return content.contact.name?.trim() || "No name yet";
    case "summary":
      return content.summary?.trim() ? content.summary.trim() : "No summary yet";
    case "experience":
      return list(content.experience.map((j) => j.company || j.title || "Untitled role"));
    case "education":
      return list(content.education.map((e) => e.institution || e.degree || "Untitled"));
    case "skills":
      return content.skills.length === 0
        ? "Nothing added yet"
        : `${content.skills.length} skill${content.skills.length === 1 ? "" : "s"}`;
    case "extras": {
      const parts = [
        (content.languages ?? []).length > 0 ? "Languages" : null,
        (content.certifications ?? []).length > 0 ? "Certifications" : null,
        (content.awards ?? []).length > 0 ? "Awards" : null,
      ].filter(Boolean) as string[];
      return parts.length > 0 ? parts.join(" · ") : "Nothing added yet";
    }
  }
}

export function SectionChain({
  content,
  openSection,
  onOpenChange,
  focusEntry,
}: {
  content: ResumeContent | null;
  openSection: SectionId | null;
  onOpenChange: (id: SectionId | null) => void;
  focusEntry?: { section: SectionId; index: number };
}) {
  const states = sectionStates(content);

  function bodyFor(id: SectionId) {
    const focusIndex = focusEntry?.section === id ? focusEntry.index : undefined;
    switch (id) {
      case "contact": return <ContactSection />;
      case "summary": return <SummarySection />;
      case "experience": return <ExperienceSection focusIndex={focusIndex} />;
      case "education": return <EducationSection focusIndex={focusIndex} />;
      case "skills": return <SkillsSection />;
      case "extras": return <ExtrasSection />;
    }
  }

  return (
    <div className="flex flex-col gap-sm">
      {states.map((state) => {
        const open = state.id === openSection;
        return (
          <SectionBand
            key={state.id}
            state={state}
            digest={sectionDigest(content, state.id)}
            open={open}
            onToggle={() => onOpenChange(open ? null : state.id)}
          >
            {/* Mounted only while open, so a closed band costs nothing and
                cannot be found by a query for another section's fields. */}
            {open ? bodyFor(state.id) : null}
          </SectionBand>
        );
      })}
    </div>
  );
}

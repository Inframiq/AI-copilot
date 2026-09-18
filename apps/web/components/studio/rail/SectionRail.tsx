"use client";
import type React from "react";
import { motion } from "motion/react";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import type { ResumeContent } from "@career-copilot/types";
import {
  sectionStates,
  completeCount,
  type SectionId,
} from "@/lib/section-completeness";
import { SectionRow } from "./SectionRow";

export function SectionRail({
  content,
  activeSection,
  collapsed = false,
  onToggleCollapsed,
  onSelect,
  onSelectEntry,
  pendingBySection,
  footer,
}: {
  content: ResumeContent | null;
  activeSection: SectionId;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onSelect: (id: SectionId) => void;
  onSelectEntry?: (id: SectionId, index: number) => void;
  pendingBySection?: Partial<Record<SectionId, number>>;
  footer?: React.ReactNode;
}) {
  const states = sectionStates(content);
  const { complete, total } = completeCount(states);

  // Sub-rows let the user jump straight to a role instead of scrolling the
  // whole section — the old tab strip could only address a section.
  const entriesFor = (id: SectionId): string[] | undefined => {
    if (!content) return undefined;
    if (id === "experience")
      return content.experience.map((j) => j.company || j.title || "Untitled role");
    if (id === "education")
      return content.education.map((e) => e.institution || e.degree || "Untitled");
    return undefined;
  };

  return (
    <motion.aside
      // Width is animated, not toggled, so collapsing while a section band
      // opens reads as one movement handing space to the editor.
      initial={false}
      animate={{ width: collapsed ? 64 : 260 }}
      transition={{ type: "spring", stiffness: 220, damping: 30 }}
      className="flex flex-col h-full shrink-0 bg-surface-container-low border-r border-outline-variant/20 overflow-hidden"
    >
      <nav
        aria-label="Resume sections"
        className="flex flex-col gap-xs p-sm flex-1 overflow-y-auto"
      >
        {states.map((state) => (
          <SectionRow
            key={state.id}
            state={state}
            collapsed={collapsed}
            isActive={state.id === activeSection}
            entries={collapsed ? undefined : entriesFor(state.id)}
            pendingChanges={pendingBySection?.[state.id]}
            onSelect={onSelect}
            onSelectEntry={onSelectEntry}
          />
        ))}
      </nav>

      {onToggleCollapsed && (
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex items-center justify-center py-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
        >
          {collapsed ? <CaretRight size={14} /> : <CaretLeft size={14} />}
        </button>
      )}

      {!collapsed && (
        <div className="px-md py-sm border-t border-outline-variant/20">
          <p className="tabular text-caption text-on-surface-variant">
            {complete} of {total} complete
          </p>
        </div>
      )}

      {!collapsed && footer}
    </motion.aside>
  );
}

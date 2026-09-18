"use client";
import { useState } from "react";
import { X } from "@phosphor-icons/react";
import { motion, AnimatePresence } from "motion/react";
import { useResumeStore } from "@/stores/resume-store";

// A chip editor, not the old newline-joined textarea: skills are discrete
// values and editing them as one blob made reordering and de-duping a
// manual text exercise.
export function SkillsSection() {
  const content = useResumeStore((s) => s.content);
  const updateContent = useResumeStore((s) => s.updateContent);
  const [draft, setDraft] = useState("");
  if (!content) return null;

  const skills = content.skills;

  function add() {
    const value = draft.trim();
    setDraft("");
    if (!value) return;
    if (skills.some((s) => s.toLowerCase() === value.toLowerCase())) return;
    updateContent({ skills: [...skills, value] });
  }

  return (
    <section className="flex flex-col gap-md">
      <h2 className="text-label-caps text-on-surface-variant">Skills</h2>

      <div className="flex flex-wrap gap-xs">
        <AnimatePresence initial={false}>
          {skills.map((skill) => (
            <motion.span
              key={skill}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
              className="flex items-center gap-xs pl-sm pr-xs py-xs rounded-full bg-secondary-container text-on-secondary-container text-label-sm"
            >
              {skill}
              <button
                type="button"
                aria-label={`Remove ${skill}`}
                onClick={() =>
                  updateContent({ skills: skills.filter((s) => s !== skill) })
                }
                className="rounded-full p-0.5 hover:bg-error/15 hover:text-error transition-colors"
              >
                <X size={12} weight="bold" />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>
      </div>

      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder="Add a skill and press Enter…"
        className="w-full px-md py-sm rounded-xl border border-outline-variant/50 bg-surface-container-lowest text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
      />
    </section>
  );
}

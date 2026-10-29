"use client";
import { useState } from "react";
import { X } from "@phosphor-icons/react";
import { motion, AnimatePresence } from "motion/react";
import { useResumeStore } from "@/stores/resume-store";
import { SuggestInput } from "@/components/ui/SuggestInput";
import { canonicalFor, findRepeat } from "@/lib/suggest/client";

// A chip editor, not the old newline-joined textarea: skills are discrete
// values and editing them as one blob made reordering and de-duping a
// manual text exercise.
export function SkillsSection() {
  const content = useResumeStore((s) => s.content);
  const updateContent = useResumeStore((s) => s.updateContent);
  const [draft, setDraft] = useState("");
  // Says why a skill wasn't added (it's already there); cleared on typing.
  const [note, setNote] = useState<string | null>(null);
  if (!content) return null;

  const skills = content.skills;

  /** Adds what's typed, or a suggestion picked. Typed text that is exactly
   * a known skill or its alias ("js") goes in as the list's name. */
  async function add(picked?: string) {
    const typed = (picked ?? draft).trim();
    setDraft("");
    if (!typed) return;
    const value =
      picked ?? (await canonicalFor("skill", typed).catch(() => null)) ?? typed;
    // As the list is now: the lookups above are asynchronous.
    const current = useResumeStore.getState().content?.skills ?? skills;
    // Never twice — "js" when JavaScript is there, "node js" for Node.js.
    const already = await findRepeat("skill", value, current);
    if (already) return setNote(`${already} is already in your skills.`);
    updateContent({ skills: [...(useResumeStore.getState().content?.skills ?? current), value] });
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
                className="relative rounded-full p-0.5 before:absolute before:-inset-1.5 before:content-[''] hover:bg-error/15 hover:text-error transition-colors"
              >
                <X size={12} weight="bold" />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>
      </div>

      <SuggestInput
        kind="skill"
        aria-label="Add a skill"
        value={draft}
        onValueChange={(v) => { setDraft(v); setNote(null); }}
        onPick={add}
        exclude={skills}
        aria-describedby={note ? "builder-skill-note" : undefined}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={() => add()}
        placeholder="Add a skill and press Enter…"
        className="w-full px-md py-sm rounded-xl border border-outline-variant/50 bg-surface-container-lowest text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
      />
      <p id="builder-skill-note" role="status" className="text-caption text-on-surface-variant empty:hidden">{note}</p>
    </section>
  );
}

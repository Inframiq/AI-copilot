"use client";
import { useResumeStore } from "@/stores/resume-store";
import { wordCount } from "@/lib/misc-points";
import { PROFILE_LIMITS, SECTION_INFO, capEdit, summaryCapNote } from "@/lib/profile-sections";
import { SummaryWriter } from "@/components/resume/SummaryWriter";
import { ProfileDifference } from "./ProfileDifference";

// Matches resume_spec.py HARD_LIMITS["summary"]["max_words"] — the backend
// from-scratch generator enforces the same cap.
export const SUMMARY_MAX_WORDS = PROFILE_LIMITS.summaryWords;

export function SummarySection() {
  const content = useResumeStore((s) => s.content);
  const updateContent = useResumeStore((s) => s.updateContent);
  if (!content) return null;

  const words = (content.summary ?? "").trim().split(/\s+/).filter(Boolean);
  const count = words.length;

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    // Never cut, typed or pasted: past the cap it's flagged below and the
    // autosave waits until it fits (resume-store, summaryCapError).
    updateContent({ summary: e.target.value });
  }

  return (
    <section className="flex flex-col gap-md">
      <header className="flex items-baseline justify-between gap-sm">
        <h2 className="text-label-caps text-on-surface-variant">Professional Summary</h2>
        <span
          className={`tabular text-caption ${
            count > SUMMARY_MAX_WORDS
              ? "text-error font-semibold"
              : count === SUMMARY_MAX_WORDS ? "text-tertiary font-semibold" : "text-on-surface-variant"
          }`}
        >
          {count} / {SUMMARY_MAX_WORDS} words
        </span>
      </header>
      <ProfileDifference field="summary" />
      <textarea
        value={content.summary ?? ""}
        onChange={handleChange}
        rows={7}
        placeholder="Write a compelling professional summary…"
        className="w-full px-md py-md rounded-xl border border-outline-variant/50 bg-surface-container-lowest text-on-surface text-body-md leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
      />

      <SummaryWriter
        current={content.summary ?? ""}
        getContent={() => content}
        onUse={(summary) => updateContent({ summary })}
      />
      {count >= SUMMARY_MAX_WORDS && (
        <p className={`text-caption ${count > SUMMARY_MAX_WORDS ? "text-error" : "text-tertiary"}`}>
          {count > SUMMARY_MAX_WORDS
            ? summaryCapNote(count)
            : `${SUMMARY_MAX_WORDS} words is the limit for a professional summary.`}
        </p>
      )}

      {/* The Profile's Objective, here too (lib/profile-sections.ts). A
          template prints the summary when there is one, else this. */}
      <header className="flex items-baseline justify-between gap-sm mt-sm">
        <label htmlFor="builder-objective" className="text-label-caps text-on-surface-variant">
          Objective
        </label>
        <span className="tabular text-caption text-on-surface-variant">
          {wordCount(content.objective ?? "")} / {PROFILE_LIMITS.objectiveWords} words
        </span>
      </header>
      <ProfileDifference field="objective" />
      <textarea
        id="builder-objective"
        value={content.objective ?? ""}
        onChange={(e) => updateContent({ objective: capEdit(content.objective ?? "", e.target.value, PROFILE_LIMITS.objectiveWords) })}
        rows={3}
        placeholder={SECTION_INFO.objective.placeholder}
        className="w-full px-md py-md rounded-xl border border-outline-variant/50 bg-surface-container-lowest text-on-surface text-body-md leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
      />
    </section>
  );
}


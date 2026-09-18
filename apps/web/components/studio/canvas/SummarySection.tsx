"use client";
import { useResumeStore } from "@/stores/resume-store";

// Matches resume_spec.py HARD_LIMITS["summary"]["max_words"] — the backend
// from-scratch generator enforces the same cap.
export const SUMMARY_MAX_WORDS = 80;

export function SummarySection() {
  const content = useResumeStore((s) => s.content);
  const updateContent = useResumeStore((s) => s.updateContent);
  if (!content) return null;

  const words = (content.summary ?? "").trim().split(/\s+/).filter(Boolean);
  const count = words.length;

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    const next = value.trim().split(/\s+/).filter(Boolean);
    // Trim from the end so text already typed at the front is never
    // silently rewritten.
    updateContent({
      summary:
        next.length <= SUMMARY_MAX_WORDS
          ? value
          : next.slice(0, SUMMARY_MAX_WORDS).join(" "),
    });
  }

  return (
    <section className="flex flex-col gap-md">
      <header className="flex items-baseline justify-between gap-sm">
        <h2 className="text-label-caps text-on-surface-variant">Professional Summary</h2>
        <span
          className={`tabular text-caption ${
            count >= SUMMARY_MAX_WORDS ? "text-error font-semibold" : "text-on-surface-variant"
          }`}
        >
          {count} / {SUMMARY_MAX_WORDS} words
        </span>
      </header>
      <textarea
        value={content.summary ?? ""}
        onChange={handleChange}
        rows={7}
        placeholder="Write a compelling professional summary…"
        className="w-full px-md py-md rounded-xl border border-outline-variant/50 bg-surface-container-lowest text-on-surface text-body-md leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
      />
      {count >= SUMMARY_MAX_WORDS && (
        <p className="text-caption text-error">
          A tight, {SUMMARY_MAX_WORDS}-word summary reads stronger on an ATS resume than a long
          one — trim before adding more.
        </p>
      )}
    </section>
  );
}

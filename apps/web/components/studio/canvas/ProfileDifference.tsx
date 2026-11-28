"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useResumeStore } from "@/stores/resume-store";
import { careerProfileQuery } from "@/lib/reveal";

type Field = "summary" | "objective";

const LABEL: Record<Field, string> = { summary: "summary", objective: "objective" };

/** Same words, same order: spacing and line breaks aside. */
function same(a: string, b: string): boolean {
  const tidy = (s: string) => s.replace(/\s+/g, " ").trim();
  return tidy(a) === tidy(b);
}

const keptKey = (resumeId: string, field: Field) => `kripax.profile-difference.${resumeId}.${field}`;

function readKept(resumeId: string, field: Field): string | null {
  try { return localStorage.getItem(keptKey(resumeId, field)); } catch { return null; }
}

function writeKept(resumeId: string, field: Field, value: string) {
  try { localStorage.setItem(keptKey(resumeId, field), value); } catch { /* the offer only returns next visit */ }
}

/**
 * The Profile's summary (or objective), offered when it differs from the
 * master résumé's. Uploading a résumé on the Profile saves the file's text
 * as the résumé and the form's — often rephrased — as the profile, so the
 * two can part. Nothing changes until the user picks: "Use profile …"
 * applies it here (and autosaves); "Keep this one" leaves the résumé as it
 * is and the offer stays away until the profile's text changes again.
 *
 * Only on the profile's master résumé: a résumé tailored to a job is meant
 * to differ, and so is a draft.
 */
export function ProfileDifference({ field }: { field: Field }) {
  const resumeId = useResumeStore((s) => s.resumeId);
  const current = useResumeStore((s) => s.content?.[field] ?? "");
  const isDraft = useResumeStore((s) => s.draftJdId !== null);
  const updateContent = useResumeStore((s) => s.updateContent);
  const profile = useQuery(careerProfileQuery).data;
  const theirs = (profile?.[field] ?? "").trim();
  // Read after mount: storage isn't there on the server's render.
  const [kept, setKept] = useState<string | null>(null);
  useEffect(() => { if (resumeId) setKept(readKept(resumeId, field)); }, [resumeId, field]);

  if (!resumeId || isDraft || !profile || profile.master_resume_id !== resumeId) return null;
  if (!theirs || same(theirs, current) || (kept !== null && same(kept, theirs))) return null;

  const label = LABEL[field];
  return (
    <div
      role="status"
      className="flex flex-col gap-sm rounded-xl border border-primary/30 bg-primary/5 p-md"
    >
      <p className="text-label-md font-semibold text-on-surface">
        The profile has a different {label}.
      </p>
      <p className="whitespace-pre-line text-body-sm text-on-surface-variant">{theirs}</p>
      <div className="flex flex-wrap gap-sm">
        <button
          type="button"
          onClick={() => updateContent({ [field]: theirs })}
          className="rounded-lg bg-primary px-md py-xs text-label-md text-on-primary hover:opacity-90"
        >
          Use profile {label}
        </button>
        <button
          type="button"
          onClick={() => { writeKept(resumeId, field, theirs); setKept(theirs); }}
          className="rounded-lg border border-outline-variant/60 px-md py-xs text-label-md text-on-surface hover:bg-surface-container"
        >
          Keep this one
        </button>
      </div>
    </div>
  );
}

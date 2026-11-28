"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useResumeStore } from "@/stores/resume-store";
import { careerProfileQuery } from "@/lib/reveal";
import { apiClient } from "@/lib/api-client";
import {
  SECTION_INFO,
  fitProfileSections,
  resumeSectionsToProfile,
  type ExtraSection,
  type LanguageEntry,
} from "@/lib/profile-sections";
import type { Resume, ResumeContent } from "@career-copilot/types";

export type DifferenceField = "headline" | "summary" | ExtraSection;

type Value = string | string[] | LanguageEntry[];

const LABEL: Record<DifferenceField, string> = {
  headline: "Headline",
  summary: "Professional summary",
  ...(Object.fromEntries(Object.entries(SECTION_INFO).map(([k, v]) => [k, v.label])) as Record<ExtraSection, string>),
};

const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

/** The field as the Profile holds it and as the résumé does, each in the
 * Profile's shape (blanks and repeats dropped), so only a real difference
 * counts. Empty is "". */
function sides(field: DifferenceField, profile: Parameters<typeof fitProfileSections>[0] & { headline?: string | null }, content: ResumeContent): [Value, Value] {
  if (field === "headline") return [tidy(profile.headline ?? ""), tidy(content.headline ?? "")];
  const theirs = fitProfileSections(profile)[field];
  const ours = resumeSectionsToProfile(content)[field];
  return [theirs ?? "", ours ?? ""];
}

const isEmpty = (v: Value) => (typeof v === "string" ? !tidy(v) : v.length === 0);
const key = (v: Value) => (typeof v === "string" ? tidy(v) : JSON.stringify(v));

const keptKey = (resumeId: string, field: DifferenceField) => `kripax.profile-difference.${resumeId}.${field}`;

function readKept(resumeId: string, field: DifferenceField): string | null {
  try { return localStorage.getItem(keptKey(resumeId, field)); } catch { return null; }
}

function writeKept(resumeId: string, field: DifferenceField, value: string) {
  try { localStorage.setItem(keptKey(resumeId, field), value); } catch { /* the offer only returns next visit */ }
}

/**
 * A Profile section offered when it differs from the uploaded résumé's.
 * Uploading on the Profile saves the file's text as the master résumé and
 * the form's — often edited (a summary rephrased to fit) — as the profile,
 * so the two can part. Nothing changes until the user picks: "Use profile
 * …" puts the Profile's version here (and autosaves); "Keep this one"
 * leaves the résumé as it is, and the offer stays away until the Profile's
 * version changes again.
 *
 * Only on the profile's master résumé, and only one that came from an
 * uploaded file: a résumé tailored to a job is meant to differ, and so is a
 * draft. Only when the Profile has something there: an empty section is
 * never offered as a removal.
 */
export function ProfileDifference({ field }: { field: DifferenceField }) {
  const resumeId = useResumeStore((s) => s.resumeId);
  const content = useResumeStore((s) => s.content);
  const isDraft = useResumeStore((s) => s.draftJdId !== null);
  const updateContent = useResumeStore((s) => s.updateContent);
  const profile = useQuery(careerProfileQuery).data;
  const resume = useQuery<Resume>({
    queryKey: ["resume", resumeId],
    queryFn: () => apiClient.getResume(resumeId!),
    // Only the profile's master is ever offered anything.
    enabled: !!resumeId && profile?.master_resume_id === resumeId,
    staleTime: 2 * 60 * 1000,
  }).data;
  // Read after mount: storage isn't there on the server's render.
  const [kept, setKept] = useState<string | null>(null);
  useEffect(() => { if (resumeId) setKept(readKept(resumeId, field)); }, [resumeId, field]);

  if (!resumeId || !content || isDraft || !profile || profile.master_resume_id !== resumeId) return null;
  if (!resume?.original_file_name) return null;

  const [theirs, ours] = sides(field, profile, content);
  if (isEmpty(theirs) || key(theirs) === key(ours) || kept === key(theirs)) return null;

  const label = LABEL[field];
  return (
    <div role="status" aria-label={`Profile ${label}`} className="flex flex-col gap-sm rounded-xl border border-primary/30 bg-primary/5 p-md">
      <p className="text-label-md font-semibold text-on-surface">Different in the profile: {label}</p>
      {typeof theirs === "string" ? (
        <p className="whitespace-pre-line text-body-sm text-on-surface-variant">{theirs}</p>
      ) : (
        <ul className="list-disc pl-lg text-body-sm text-on-surface-variant">
          {theirs.map((item, i) => (
            <li key={i}>
              {typeof item === "string" ? item : item.level ? `${item.name} (${item.level})` : item.name}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-sm">
        <button
          type="button"
          onClick={() => updateContent({ [field]: theirs } as Partial<ResumeContent>)}
          className="rounded-lg bg-primary px-md py-xs text-label-md text-on-primary hover:opacity-90"
        >
          Use profile version
        </button>
        <button
          type="button"
          onClick={() => { writeKept(resumeId, field, key(theirs)); setKept(key(theirs)); }}
          className="rounded-lg border border-outline-variant/60 px-md py-xs text-label-md text-on-surface hover:bg-surface-container"
        >
          Keep this one
        </button>
      </div>
    </div>
  );
}

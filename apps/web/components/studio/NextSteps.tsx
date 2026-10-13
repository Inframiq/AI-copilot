"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle, EnvelopeSimple, Microphone, X } from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import { FOCUS_RING } from "@/lib/focus";
import type { JDCoverLetter } from "@career-copilot/types";

/**
 * What comes after Save to JD or Export: the cover letter and the interview
 * questions for the same job, one click away. Going back to the analyzer to
 * find them broke the flow at the moment the résumé was done.
 *
 * The letter is written from the résumé just saved for the job. One that
 * already exists is opened rather than written again.
 */
export function NextSteps({
  jdId,
  jdTitle,
  resumeId,
  done,
  onDismiss,
}: {
  jdId: string;
  jdTitle?: string;
  /** The résumé saved for this job: what the letter is written from. */
  resumeId: string;
  done: "saved" | "exported";
  onDismiss: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: letter } = useQuery<JDCoverLetter>({
    queryKey: ["jdCoverLetter", jdId],
    queryFn: () => apiClient.getJdCoverLetter(jdId),
  });
  const existing = letter?.cover_letter_id ?? null;

  async function handleLetter() {
    if (existing) {
      router.push(`/cover-letters/${existing}`);
      return;
    }
    setWriting(true);
    setError(null);
    try {
      const { cover_letter_id } = await apiClient.generateCoverLetter(resumeId, jdId, 50);
      queryClient.invalidateQueries({ queryKey: ["jdCoverLetter", jdId] });
      queryClient.invalidateQueries({ queryKey: ["coverLetters"] });
      // Writing a letter spends credits — keep the meter honest.
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
      router.push(`/cover-letters/${cover_letter_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the cover letter. Please try again.");
      setWriting(false);
    }
  }

  return (
    <section
      aria-label="Next steps"
      className="tp-step flex shrink-0 flex-wrap items-center gap-x-md gap-y-sm border-b border-success/25 bg-success-container/30 px-md py-sm sm:px-lg"
    >
      <div className="flex min-w-0 basis-full flex-col gap-0.5 sm:basis-0 sm:flex-1">
        <p className="flex min-w-0 items-center gap-xs text-label-sm text-on-surface">
          <CheckCircle size={18} weight="fill" className="shrink-0 text-success" />
          <span className="min-w-0 sm:truncate">
            Résumé {done === "exported" ? "exported" : "saved"}
            {jdTitle ? <> for <span className="font-semibold">{jdTitle}</span></> : null}. Next, the cover letter.
          </span>
        </p>
        {/* The whole journey, so this reads as a step in it, not an end. */}
        <ol aria-label="Your application" className="hidden items-center gap-xs pl-[26px] text-caption text-on-surface-variant sm:flex">
          {["Analyze", "Tailor", "Résumé"].map((step) => (
            <li key={step} className="flex items-center gap-xs">
              <span className="text-success">✓</span> {step} <span aria-hidden className="text-outline">›</span>
            </li>
          ))}
          <li className="font-semibold text-primary" aria-current="step">Cover letter</li>
        </ol>
      </div>
      <div className="flex items-center gap-xs">
        <button
          type="button"
          onClick={handleLetter}
          disabled={writing}
          className={`flex items-center gap-xs rounded-xl bg-primary px-sm py-xs text-label-sm text-on-primary shadow-sm transition-all hover:shadow-md active:scale-95 disabled:opacity-60 sm:px-md ${FOCUS_RING}`}
        >
          <EnvelopeSimple size={16} />
          {writing ? "Writing…" : existing ? "Open cover letter" : "Write cover letter"}
          {!writing && <ArrowRight size={14} />}
        </button>
        <button
          type="button"
          onClick={() => router.push(`/interview?jd=${jdId}`)}
          className={`flex items-center gap-xs rounded-xl border border-primary/40 px-sm py-xs text-label-sm text-primary transition-colors hover:bg-primary/10 sm:px-md ${FOCUS_RING}`}
        >
          <Microphone size={16} />
          <span className="sm:hidden">Interview</span>
          <span className="hidden sm:inline">Interview questions</span>
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className={`flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-on-surface/5 ${FOCUS_RING}`}
        >
          <X size={14} />
        </button>
      </div>
      {error && <p role="alert" className="basis-full text-caption text-error">{error}</p>}
    </section>
  );
}

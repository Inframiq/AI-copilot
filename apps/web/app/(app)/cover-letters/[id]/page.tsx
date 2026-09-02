"use client";
import { use, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { DownloadSimple, Copy, FloppyDisk, Sparkle } from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import { Card } from "@/components/ui/Card";
import { HumanizeSlider } from "@/components/resume/HumanizeSlider";
import type { CoverLetter } from "@career-copilot/types";

export default function CoverLetterEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sliderValue, setSliderValue] = useState<number | null>(null);

  const { data: letter, isError, refetch } = useQuery<CoverLetter>({
    queryKey: ["coverLetter", id],
    queryFn: () => apiClient.getCoverLetter(id),
    // Poll while generation is in flight; stop once it lands on a terminal status.
    refetchInterval: (query) => (query.state.data?.status === "pending" ? 3000 : false),
    // Without this, TanStack Query pauses the interval whenever the tab
    // isn't focused/visible — generation can finish server-side while the
    // user's tabbed away, and the UI never picks it up until something else
    // (a manual reload) triggers a fresh fetch. Confirmed live: a letter sat
    // on "Generating…" for 90+ seconds while the DB already had it at
    // status=completed; a reload showed it instantly.
    refetchIntervalInBackground: true,
  });

  // Defense in depth on top of refetchIntervalInBackground above — if
  // polling ever stalls for any other reason, don't leave the user staring
  // at a spinner with no way out.
  const [pollingStalled, setPollingStalled] = useState(false);
  useEffect(() => {
    setPollingStalled(false);
    if (letter?.status !== "pending") return;
    const timer = setTimeout(() => setPollingStalled(true), 20_000);
    return () => clearTimeout(timer);
  }, [letter?.status, id]);

  // Seed the draft from the fetched content exactly once it arrives — never
  // re-seed on a later refetch (that would blow away unsaved edits). Tracks
  // by id so navigating from one letter to another does re-seed.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  useEffect(() => {
    if (letter?.status === "completed" && letter.content !== null && seededFor !== id) {
      setDraft(letter.content);
      setSeededFor(id);
    }
  }, [letter, id, seededFor]);

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    try {
      await apiClient.updateCoverLetter(id, draft);
      queryClient.invalidateQueries({ queryKey: ["coverLetter", id] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRegenerate(nextHumanizeLevel: number) {
    if (!letter || isRegenerating) return;
    // The resume this letter was generated from has since been deleted —
    // regenerating needs a real resume to run the AI against, unlike
    // viewing/editing/exporting the existing letter, which only needs its
    // own already-saved content.
    if (!letter.resume_id) {
      setError("Can't regenerate — the resume this letter was written from has been deleted.");
      return;
    }
    setIsRegenerating(true);
    setError(null);
    try {
      // The backend always creates a brand-new CoverLetter row rather than
      // mutating this one, so re-fetching this id would just show the same
      // stale content. Navigate to the new letter's page instead — it
      // already handles the "pending" status with a spinner + polling.
      const { cover_letter_id } = await apiClient.generateCoverLetter(
        letter.resume_id, letter.jd_id, nextHumanizeLevel, letter.tailoring_session_id ?? undefined
      );
      router.push(`/cover-letters/${cover_letter_id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to regenerate");
    } finally {
      setIsRegenerating(false);
    }
  }

  async function handleExportPdf() {
    setIsExporting(true);
    setError(null);
    try {
      const { signed_url } = await apiClient.generateCoverLetterPdf(id);
      const response = await fetch(signed_url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = "cover-letter.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to export PDF");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (isError) {
    return (
      <div className="max-w-[900px] mx-auto p-gutter pb-xxl flex flex-col items-center justify-center gap-md py-xxl text-center">
        <p className="text-body-md text-error font-medium">
          Could not load this cover letter. It may have been deleted, or you may not have access to it.
        </p>
        <a href="/cover-letters" className="text-label-md text-primary hover:underline">
          Back to Cover Letters
        </a>
      </div>
    );
  }

  if (!letter || letter.status === "pending") {
    return (
      <div className="max-w-[900px] mx-auto p-gutter pb-xxl flex flex-col items-center justify-center gap-md py-xxl text-center">
        <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
        <p className="text-body-md text-on-surface-variant">Generating your cover letter…</p>
        {pollingStalled && (
          <>
            <p className="text-body-sm text-on-surface-variant max-w-[24rem]">
              This is taking longer than expected — it may already be done.
            </p>
            <button
              onClick={() => refetch()}
              className="text-label-md text-primary hover:underline"
            >
              Check again
            </button>
          </>
        )}
      </div>
    );
  }

  if (letter.status === "failed") {
    return (
      <div className="max-w-[900px] mx-auto p-gutter pb-xxl flex flex-col items-center justify-center gap-md py-xxl text-center">
        <p className="text-body-md text-error font-medium">Generation failed. Try regenerating from the Cover Letters list.</p>
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto p-gutter pb-xxl flex flex-col gap-section">
      <section className="pb-md">
        <h1 className="text-headline-xl text-on-surface mb-xs font-bold" style={{ letterSpacing: "-0.02em" }}>
          Cover Letter
        </h1>
      </section>

      <Card className="flex flex-col gap-md">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={16}
          className="w-full px-md py-sm rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-on-surface text-body-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
        />
        <HumanizeSlider
          value={sliderValue ?? letter.humanize_level}
          onChange={setSliderValue}
          onCommit={handleRegenerate}
          disabled={isRegenerating || !letter.resume_id}
        />
        {error && <p className="text-caption text-error">{error}</p>}
        <div className="flex flex-wrap gap-sm">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-xs px-md py-sm rounded-xl text-label-md text-on-primary bg-primary shadow-md hover:shadow-lg transition-all disabled:opacity-50"
          >
            <FloppyDisk size={16} />
            {isSaving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={handleExportPdf}
            disabled={isExporting}
            className="flex items-center gap-xs px-md py-sm rounded-xl text-label-md text-on-surface border border-outline-variant/40 hover:bg-surface-container transition-all disabled:opacity-50"
          >
            <DownloadSimple size={16} />
            {isExporting ? "Exporting…" : "Download PDF"}
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-xs px-md py-sm rounded-xl text-label-md text-on-surface border border-outline-variant/40 hover:bg-surface-container transition-all"
          >
            <Copy size={16} />
            {copied ? "Copied!" : "Copy Text"}
          </button>
          <button
            onClick={() => handleRegenerate(sliderValue ?? letter.humanize_level)}
            disabled={isRegenerating || !letter.resume_id}
            title={!letter.resume_id ? "The resume this letter was written from has been deleted" : undefined}
            className="flex items-center gap-xs px-md py-sm rounded-xl text-label-md text-primary border border-primary/30 hover:bg-primary/5 transition-all disabled:opacity-50"
          >
            <Sparkle size={16} className={isRegenerating ? "animate-pulse" : ""} />
            {isRegenerating ? "Regenerating…" : "Regenerate"}
          </button>
        </div>
      </Card>
    </div>
  );
}

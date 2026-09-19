"use client";
import { use, useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { CircleNotch, FileDashed, WarningCircle } from "@phosphor-icons/react";
import { ApiError, apiClient } from "@/lib/api-client";
import { useResumeStore } from "@/stores/resume-store";
import { useHydratedResume } from "@/lib/use-hydrated-resume";
import { FOCUS_RING } from "@/lib/focus";
import { useTailoringStore } from "@/stores/tailoring-store";
import { writeField } from "@/lib/field-path";
import { downloadFile, resumeFileName } from "@/lib/download";
import { ResumeCanvas } from "@/components/studio/ResumeCanvas";
import { FormatToolbar } from "@/components/studio/FormatToolbar";
import { StudioHeader, type StudioMode } from "@/components/studio/StudioHeader";
import { CanvasNotice } from "@/components/studio/CanvasNotice";

/**
 * The Resume Studio: the document is the interface.
 *
 * Both this and the Builder read the same stores, so moving between them
 * keeps every edit — there is no separate Studio state to synchronise.
 */
export default function StudioPreviewPage({
  params,
}: {
  params: Promise<{ resumeId: string }>;
}) {
  const { resumeId } = use(params);
  const router = useRouter();
  // The store is shared with the Builder but only the Builder used to fill
  // it, so opening this link directly showed an empty page.
  const { isLoading: isLoadingResume, isError: resumeFailed } = useHydratedResume(resumeId);
  const content = useResumeStore((s) => s.content);
  const templateId = useResumeStore((s) => s.templateId);
  const updateContent = useResumeStore((s) => s.updateContent);
  // The JD path reached the Studio through the review, not the Builder, so
  // "Back" must retrace that route rather than dropping the user into six
  // sections they deliberately skipped.
  const jdId = useTailoringStore((s) => s.jdId);
  const jdText = useTailoringStore((s) => s.jdText);
  const fromJd = !!jdId || !!jdText.trim();
  const [mode, setMode] = useState<StudioMode>("edit");
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Keyed on the content so an inline edit re-renders the document it was
  // made on. The server render is the only source — rendering client-side
  // would reintroduce the template drift this whole design avoids.
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["resumeHtml", resumeId, templateId, content],
    queryFn: () => apiClient.renderResumeHtml(resumeId, { content: content ?? undefined }),
    enabled: !!content,
  });

  const handleEdit = useCallback(
    (path: string, value: string | string[]) => {
      const current = useResumeStore.getState().content;
      if (!current) return;
      // writeField ignores a path that no longer resolves, so a stale
      // data-field from an earlier render cannot corrupt the résumé.
      updateContent(writeField(current, path, value));
    },
    [updateContent],
  );

  async function handleExport() {
    setIsExporting(true);
    setExportError(null);
    try {
      // The page shows the store's content, which autosave writes only after
      // a pause; the PDF is rendered from what is saved. Flush first, or an
      // export right after an edit would miss it.
      if (useResumeStore.getState().isDirty) await useResumeStore.getState().saveNow();
      const { signed_url } = await apiClient.generatePdf(resumeId, templateId);
      // Generating is not downloading: this step was lost when the old
      // workbench was removed, so the button spun and then did nothing.
      await downloadFile(signed_url, resumeFileName(content?.contact?.name));
    } catch (err) {
      // Previously a bare finally: a failed export reset the button and said
      // nothing, so it read as a click that simply did not work.
      setExportError(err instanceof Error ? err.message : "Export failed. Please try again.");
    } finally {
      setIsExporting(false);
    }
  }

  function body() {
    if (!content && isLoadingResume) {
      return (
        <CanvasNotice
          tone="working"
          icon={<CircleNotch size={28} className="animate-spin" />}
          title="Opening your résumé"
          detail="Fetching the version you last saved."
        />
      );
    }
    if (!content && resumeFailed) {
      return (
        <CanvasNotice
          tone="problem"
          icon={<WarningCircle size={28} />}
          title="We couldn't open this résumé"
          detail="It may have been deleted, or the connection dropped on the way."
          action={
            <button
              type="button"
              onClick={() => router.push(`/studio/${resumeId}`)}
              className={`mt-xs rounded-xl bg-primary px-lg py-sm text-label-md text-on-primary transition-opacity hover:opacity-90 ${FOCUS_RING}`}
            >
              Back to the Builder
            </button>
          }
        />
      );
    }
    if (!content) {
      return (
        <CanvasNotice
          icon={<FileDashed size={28} />}
          title="Nothing to preview yet"
          detail="Add your details in the Builder and your résumé will appear here."
        />
      );
    }
    if (isError) {
      // A 409 is a refusal with a reason the user can act on — most often a
      // template that needs a photo. Burying that under the generic message
      // sends them hunting for a fault that is really a one-line fix.
      const refusal = error instanceof ApiError && error.status === 409 ? error.message : null;
      return (
        <CanvasNotice
          tone="problem"
          icon={<WarningCircle size={28} />}
          title={refusal ? "This template needs something more" : "We couldn't render your résumé"}
          detail={refusal ?? "Your work is saved. This is usually temporary."}
          action={
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-xs rounded-xl bg-primary px-lg py-sm text-label-md text-on-primary transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Try again
            </button>
          }
        />
      );
    }
    if (isPending) {
      return (
        <CanvasNotice
          tone="working"
          icon={<CircleNotch size={28} className="animate-spin" />}
          title="Laying out your résumé"
          detail="Rendering the same document your PDF will contain."
        />
      );
    }
    return (
      <ResumeCanvas
        html={data?.html ?? ""}
        editable={mode === "edit"}
        onEdit={handleEdit}
      />
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <StudioHeader
        title="Resume"
        mode={mode}
        onMode={setMode}
        backLabel={fromJd ? "Back to Review" : "Back to Builder"}
        onBack={() =>
          router.push(fromJd ? `/studio/${resumeId}/review` : `/studio/${resumeId}`)
        }
        onEditFull={fromJd ? () => router.push(`/studio/${resumeId}`) : undefined}
        onExport={handleExport}
        isExporting={isExporting}
      />
      {exportError && (
        <p
          role="alert"
          className="flex shrink-0 items-center gap-xs border-b border-error/20 bg-error-container px-lg py-sm text-caption text-on-error-container"
        >
          <WarningCircle size={14} weight="fill" />
          Couldn&apos;t export: {exportError}
        </p>
      )}
      <div className="relative flex-1 overflow-y-auto bg-surface-container-low p-xl">
        {/* In the gutter the centred page leaves. Sticky rather than fixed so
            it travels with the document, and hidden below xl where that
            gutter is not there to put it in. */}
        {mode === "edit" && content && (
          <FormatToolbar className="sticky top-0 float-left -ml-xs hidden xl:flex" />
        )}
        {body()}
      </div>
    </div>
  );
}

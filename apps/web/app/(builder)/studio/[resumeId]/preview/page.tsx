"use client";
import { use, useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { useResumeStore } from "@/stores/resume-store";
import { writeField } from "@/lib/field-path";
import { ResumeCanvas } from "@/components/studio/ResumeCanvas";
import { StudioHeader, type StudioMode } from "@/components/studio/StudioHeader";

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
  const content = useResumeStore((s) => s.content);
  const templateId = useResumeStore((s) => s.templateId);
  const updateContent = useResumeStore((s) => s.updateContent);
  const [mode, setMode] = useState<StudioMode>("edit");
  const [isExporting, setIsExporting] = useState(false);

  // Keyed on the content so an inline edit re-renders the document it was
  // made on. The server render is the only source — rendering client-side
  // would reintroduce the template drift this whole design avoids.
  const { data } = useQuery({
    queryKey: ["resumeHtml", resumeId, templateId, content],
    queryFn: () => apiClient.renderResumeHtml(resumeId, { content: content ?? undefined }),
    enabled: !!content,
  });

  const handleEdit = useCallback(
    (path: string, value: string) => {
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
    try {
      await apiClient.generatePdf(resumeId, templateId);
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <StudioHeader
        title="Resume"
        mode={mode}
        onMode={setMode}
        onBack={() => router.push(`/studio/${resumeId}`)}
        onExport={handleExport}
        isExporting={isExporting}
      />
      <div className="flex-1 overflow-y-auto bg-surface-container-low p-xl">
        <ResumeCanvas
          html={data?.html ?? ""}
          editable={mode === "edit"}
          onEdit={handleEdit}
        />
      </div>
    </div>
  );
}

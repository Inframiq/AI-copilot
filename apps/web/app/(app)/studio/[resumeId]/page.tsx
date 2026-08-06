"use client";
import { use, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { EditorPanel } from "@/components/resume/EditorPanel";
import { PreviewPanel } from "@/components/resume/PreviewPanel";
import { useResumeStore } from "@/stores/resume-store";
import { apiClient } from "@/lib/api-client";
import type { Resume } from "@career-copilot/types";

export default function StudioPage({
  params,
}: {
  params: Promise<{ resumeId: string }>;
}) {
  const { resumeId } = use(params);
  const setResume = useResumeStore((s) => s.setResume);

  const { data: resume, isLoading, isError } = useQuery<Resume>({
    queryKey: ["resume", resumeId],
    queryFn: () => apiClient.getResume(resumeId),
    enabled: !!resumeId,
  });

  useEffect(() => {
    if (resume) {
      setResume(resume.id, resume.content, resume.template_id);
    }
  }, [resume, setResume]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin mx-auto mb-md" />
          <p className="text-on-surface-variant text-body-sm">Loading resume…</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center max-w-sm px-lg">
          <p className="text-error text-headline-md font-bold mb-sm">Failed to load resume</p>
          <p className="text-on-surface-variant text-body-sm">
            The resume could not be found or you don&apos;t have access to it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Left Panel: Editor */}
      <div className="w-[420px] flex-shrink-0 border-r border-outline-variant/20 bg-surface-container-lowest overflow-hidden flex flex-col">
        <EditorPanel />
      </div>

      {/* Right Panel: Preview */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <PreviewPanel />
      </div>
    </div>
  );
}

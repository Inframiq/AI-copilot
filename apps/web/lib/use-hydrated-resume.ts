"use client";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useResumeStore } from "@/stores/resume-store";
import type { Resume } from "@career-copilot/types";

/**
 * Make sure resume-store holds this résumé, fetching it if it does not.
 *
 * Every page under /studio reads the store, but only the Builder ever filled
 * it. Open the preview link directly, or refresh on it, and the store was
 * empty — so the page reported there was nothing to preview, and going back
 * to the Builder and forward again "fixed" it. Each route that shows a
 * résumé now hydrates it, and they share this so the two cannot drift.
 */
export function useHydratedResume(resumeId: string) {
  const queryClient = useQueryClient();
  const setResume = useResumeStore((s) => s.setResume);
  const storeResumeId = useResumeStore((s) => s.resumeId);
  const hasContent = useResumeStore((s) => s.content !== null);
  // The right id with no content is still not loaded — the JD path reaches
  // the review before anything has filled the store.
  const loaded = storeResumeId === resumeId && hasContent;

  const { data: resume, isLoading, isError } = useQuery<Resume>({
    queryKey: ["resume", resumeId],
    queryFn: () => apiClient.getResume(resumeId),
    enabled: !!resumeId && !loaded,
    // Serve straight from the list the dashboard and studio index already hold.
    initialData: () =>
      queryClient.getQueryData<Resume[]>(["resumes"])?.find((r) => r.id === resumeId),
    staleTime: 2 * 60 * 1000,
  });

  useEffect(() => {
    // Only when the store holds a different résumé. Re-applying the fetched
    // copy over the one already loaded would discard unsaved edits and the
    // tailoring the review just wrote into it.
    if (resume && resume.id === resumeId && !loaded) {
      setResume(
        resume.id,
        resume.content,
        resume.template_id,
        resume.line_spacing,
        resume.paragraph_spacing,
        resume.font_choice,
        resume.accent_color,
        resume.heading_size_delta,
        resume.body_size_delta,
      );
    }
  }, [resume, resumeId, loaded, setResume]);

  return { resume, isLoading: !loaded && isLoading, isError: !loaded && isError };
}

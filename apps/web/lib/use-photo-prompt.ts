"use client";
import { useEffect, useRef } from "react";
import { useResumeStore } from "@/stores/resume-store";
import { templateRequiresPhoto } from "@/lib/resume-templates";

/**
 * Raise the "this template needs a photo" prompt the moment the résumé lands
 * on a photo template without one.
 *
 * Lived inline in the Builder page, which is the one place the template
 * *cannot* be changed — the gallery is in the Studio header, over the
 * preview. So the switch that most needs the prompt, non-photo → photo, hit
 * a render refusal and showed an error card instead of asking the question.
 * Shared here so both routes behave the same way.
 *
 * The ref starts null so this also fires on first hydration (setResume writes
 * the real template id), not only on later in-editor switches, and resets on
 * navigation between résumés so a second résumé on the same photo template
 * still gets asked.
 */
export function usePhotoPrompt(resumeId: string) {
  const storeResumeId = useResumeStore((s) => s.resumeId);
  const templateId = useResumeStore((s) => s.templateId);
  const content = useResumeStore((s) => s.content);
  const setPhotoModal = useResumeStore((s) => s.setPhotoModal);

  const prevTemplateIdRef = useRef<string | null>(null);

  useEffect(() => {
    prevTemplateIdRef.current = null;
  }, [resumeId]);

  useEffect(() => {
    if (storeResumeId !== resumeId || !content) return;
    const prev = prevTemplateIdRef.current;
    prevTemplateIdRef.current = templateId;
    if (templateId === prev) return;
    if (templateRequiresPhoto(templateId) && !content.contact.photo_url) {
      setPhotoModal(true, prev ?? undefined);
    }
  }, [templateId, storeResumeId, resumeId, content, setPhotoModal]);
}

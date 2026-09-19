"use client";
import { use, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { BuilderShell } from "@/components/builder/BuilderShell";
import { PhotoRequirementModal } from "@/components/resume/PhotoRequirementModal";
import { useResumeStore } from "@/stores/resume-store";
import { useHydratedResume } from "@/lib/use-hydrated-resume";
import { useTailoringStore } from "@/stores/tailoring-store";
import { apiClient } from "@/lib/api-client";
import { templateRequiresPhoto } from "@/lib/resume-templates";
import { getCareerProfile, type CareerProfileInput } from "@/lib/career-profile-client";
import type { Resume } from "@career-copilot/types";

export default function StudioPage({
  params,
}: {
  params: Promise<{ resumeId: string }>;
}) {
  const { resumeId } = use(params);
  const router = useRouter();
  const setPdfSignedUrl = useResumeStore((s) => s.setPdfSignedUrl);
  const pdfSignedUrl = useResumeStore((s) => s.pdfSignedUrl);
  const storeResumeId = useResumeStore((s) => s.resumeId);
  const templateId = useResumeStore((s) => s.templateId);
  const setPreviewOpen = useResumeStore((s) => s.setPreviewOpen);
  const content = useResumeStore((s) => s.content);
  const setPhotoModal = useResumeStore((s) => s.setPhotoModal);
  const jdId = useTailoringStore((s) => s.jdId);

  const { resume, isLoading, isError } = useHydratedResume(resumeId);

  // Shared ["careerProfile"] cache key — the same one profile/page.tsx and
  // <PhotoRequirementModal> ("also save to profile") invalidate.
  const { data: careerProfile } = useQuery({
    queryKey: ["careerProfile"],
    queryFn: getCareerProfile,
    staleTime: 5 * 60 * 1000,
  });

  const profileForUpsert: CareerProfileInput | null = careerProfile
    ? {
        master_resume_id: careerProfile.master_resume_id,
        contact: careerProfile.contact,
        headline: careerProfile.headline,
        experience: careerProfile.experience,
        projects: careerProfile.projects,
        education: careerProfile.education,
        skills: careerProfile.skills,
        certifications: careerProfile.certifications,
        role_status: careerProfile.role_status,
        photo_url: careerProfile.photo_url,
        photo_path: careerProfile.photo_path,
      }
    : null;


  // A saved resume that's already had a PDF generated (e.g. opened via
  // "Open" from a JD's "Generated for This JD" card) should show that PDF
  // immediately, not present "No PDF generated yet" and make the user
  // click Generate for content that's already sitting in storage. Cheap
  // signed-URL lookup, not a re-render — runs once per resume load, right
  // after setResume above resets pdfSignedUrl to null for it.
  useEffect(() => {
    if (!resume || resume.id !== storeResumeId || pdfSignedUrl || !resume.pdf_url) return;
    let cancelled = false;
    apiClient.getLatestResumePdf(resume.id)
      .then(({ signed_url }) => {
        if (cancelled) return;
        setPdfSignedUrl(signed_url);
        // There's already something to show — open the split pane straight
        // to it instead of making the user click "Preview" for content
        // that's already sitting in storage.
        setPreviewOpen(true);
      })
      .catch(() => {}); // 404 (never generated) or a transient failure — Generate PDF still works as a fallback
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume?.id, storeResumeId]);

  // Prompt for a photo the first time the resume lands on a photo template
  // without one. prevTemplateIdRef starts null so this also fires on initial
  // hydration (setResume writes the real template id), not only on later
  // in-editor switches.
  const prevTemplateIdRef = useRef<string | null>(null);
  // Reset the "seen template" ref on client-side navigation between resumes,
  // so a second resume that shares the first's photo template but has no photo
  // still gets prompted (the ref otherwise persists across the route change).
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

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-4 border-primary border-t-transparent animate-spin mx-auto mb-md" />
          <p className="text-on-surface-variant text-body-sm">Loading resume…</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center px-lg" style={{ maxWidth: "24rem" }}>
          <p className="text-error text-headline-md font-bold mb-sm">Failed to load resume</p>
          <p className="text-on-surface-variant text-body-sm">
            The resume could not be found or you don&apos;t have access to it.
          </p>
          <button
            onClick={() => router.push("/dashboard")}
            className="mt-lg px-lg py-md rounded-xl text-label-md text-on-primary bg-primary hover:opacity-90 transition-opacity"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background relative">
      <BuilderShell
        title={resume?.title ?? "Resume"}
        backLabel={jdId ? "Back to Analyzer" : "Back to Resumes"}
        onBack={() => router.push(jdId ? `/jd/${jdId}` : "/studio")}
        onPreview={() => router.push(`/studio/${resumeId}/preview`)}
        onTailor={() => router.push(`/studio/${resumeId}/review`)}
      />

      <PhotoRequirementModal
        profilePhotoUrl={careerProfile === undefined ? undefined : careerProfile?.photo_url ?? null}
        profileForUpsert={profileForUpsert}
        onOpenProfile={() => {
          setPhotoModal(false);
          router.push("/profile");
        }}
      />
    </div>
  );
}

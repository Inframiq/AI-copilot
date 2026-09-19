"use client";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { PhotoRequirementModal } from "@/components/resume/PhotoRequirementModal";
import { useResumeStore } from "@/stores/resume-store";
import { usePhotoPrompt } from "@/lib/use-photo-prompt";
import { getCareerProfile, type CareerProfileInput } from "@/lib/career-profile-client";

/**
 * "This template needs a photo" — the watcher and the dialog as one unit.
 *
 * Both the Builder and the Studio preview need this, and the preview needs it
 * most: the template gallery lives in its header, so it is where a résumé
 * actually moves onto a photo template. Keeping the profile lookup, the
 * watcher and the modal together means mounting it is the whole integration,
 * and the two routes cannot drift apart again.
 */
export function PhotoPrompt({ resumeId }: { resumeId: string }) {
  const router = useRouter();
  const setPhotoModal = useResumeStore((s) => s.setPhotoModal);

  usePhotoPrompt(resumeId);

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

  return (
    <PhotoRequirementModal
      // undefined while the profile is still loading, so the dialog can say
      // so instead of claiming there is no photo.
      profilePhotoUrl={careerProfile === undefined ? undefined : careerProfile?.photo_url ?? null}
      profileForUpsert={profileForUpsert}
      onOpenProfile={() => {
        setPhotoModal(false);
        router.push("/profile");
      }}
    />
  );
}

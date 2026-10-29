"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useResumeStore } from "@/stores/resume-store";
import { uploadResumePhoto, uploadProfilePhoto } from "@/lib/photo-upload";
import { upsertCareerProfile, type CareerProfileInput } from "@/lib/career-profile-client";
import { tidyContactLinks } from "@/lib/social-links";
import { templateRequiresPhoto } from "@/lib/resume-templates";
import { useAvatarSrc } from "@/lib/avatar-url";
import { FOCUS_RING } from "@/lib/focus";
import { Sheet, SheetBody, SheetHeader } from "@/components/ui/Sheet";

interface PhotoRequirementModalProps {
  /** string = profile has a photo (Case A); null = none (Case B); undefined = loading. */
  profilePhotoUrl: string | null | undefined;
  /** Needed only to re-upsert when the user also wants the uploaded image as
   *  their profile photo. null while the profile is still loading. */
  profileForUpsert: CareerProfileInput | null;
  onOpenProfile: () => void;
}

export function PhotoRequirementModal({
  profilePhotoUrl,
  profileForUpsert,
  onOpenProfile,
}: PhotoRequirementModalProps) {
  const open = useResumeStore((s) => s.photoModalOpen);
  const revertTo = useResumeStore((s) => s.photoModalRevertTo);
  const setPhotoModal = useResumeStore((s) => s.setPhotoModal);
  const setTemplateId = useResumeStore((s) => s.setTemplateId);
  const templateId = useResumeStore((s) => s.templateId);
  const content = useResumeStore((s) => s.content);
  const updateContent = useResumeStore((s) => s.updateContent);
  const resumeId = useResumeStore((s) => s.resumeId);
  const profilePhotoSrc = useAvatarSrc(profilePhotoUrl);
  const queryClient = useQueryClient();

  const caseB = profilePhotoUrl === null;
  const [showUpload, setShowUpload] = useState(false);
  const [alsoSaveToProfile, setAlsoSaveToProfile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (revertTo) {
      setTemplateId(revertTo);
    } else if (templateRequiresPhoto(templateId)) {
      // No previous template to fall back to — e.g. the resume was created
      // directly on a photo template, so there's nothing to "go back" to.
      // Land on the one template that never needs a photo instead of
      // leaving the user stuck on one that can't preview or export.
      setTemplateId("ats_clean");
    }
    setShowUpload(false);
    setError(null);
    setBusy(false);
    setPhotoModal(false);
  }

  function beginUpload() {
    setShowUpload(true);
    setAlsoSaveToProfile(caseB); // default on in Case B, off in Case A
    setError(null);
  }

  function useProfilePhoto() {
    if (!content || typeof profilePhotoUrl !== "string") return;
    updateContent({ contact: { ...content.contact, photo_url: profilePhotoUrl } });
    setPhotoModal(false); // deliberate choice — no revert
    setShowUpload(false);
  }

  async function onFile(file: File) {
    if (!content || !resumeId) return;
    setBusy(true);
    setError(null);
    try {
      const url = await uploadResumePhoto(resumeId, file);
      updateContent({ contact: { ...content.contact, photo_url: url } });
      if (alsoSaveToProfile) {
        const { url: pUrl, path } = await uploadProfilePhoto(file);
        // When getCareerProfile() returned null (no row yet) the studio page
        // passes profileForUpsert=null. A checked "also save to my profile"
        // must still write a row — seed a minimal profile from the resume's
        // contact, matching resumeContentToCareerProfileInput's empty shape.
        const baseProfile: CareerProfileInput = profileForUpsert ?? {
          master_resume_id: null,
          // A résumé link that isn't a profile link stays off the new
          // profile: the database would refuse the save over it.
          contact: tidyContactLinks({
            name: content.contact.name ?? "",
            email: content.contact.email ?? "",
            phone: content.contact.phone ?? "",
            location: content.contact.location ?? "",
            linkedin: content.contact.linkedin ?? "",
            github: content.contact.github ?? "",
          }, { dropBad: true }),
          headline: null,
          experience: [],
          projects: [],
          education: [],
          skills: [],
          certifications: [],
          role_status: null,
          photo_url: null,
          photo_path: null,
        };
        await upsertCareerProfile({ ...baseProfile, photo_url: pUrl, photo_path: path });
        queryClient.invalidateQueries({ queryKey: ["careerProfile"] });
      }
      setPhotoModal(false); // success — keep the photo template
      setShowUpload(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Photo upload failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  const secondary = `py-sm px-md rounded-lg border border-outline-variant/50 text-label-md text-on-surface hover:bg-surface-container ${FOCUS_RING}`;
  const primary = `py-sm px-md rounded-lg bg-primary text-on-primary text-label-md font-semibold hover:bg-primary-container ${FOCUS_RING}`;

  // Cancel, the X, Escape or a click outside go back to the previous
  // template (close()); not mid-upload.
  return (
    <Sheet labelledBy="photo-required-title" describedBy="photo-required-help" onClose={close} dismissible={!busy}>
      <SheetBody>
        <SheetHeader eyebrow="Photo template" titleId="photo-required-title" title="This template needs a photo" descriptionId="photo-required-help">
          {profilePhotoUrl === undefined
            ? "Loading your profile…"
            : caseB
              ? "Your profile has no photo yet. Upload one to use this template."
              : "Your profile has a photo. Use it, or upload a different one."}
        </SheetHeader>

        {typeof profilePhotoUrl === "string" && !caseB && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profilePhotoSrc ?? undefined}
            alt="Your profile photo"
            className="w-20 h-20 rounded-full object-cover border border-outline-variant/30"
          />
        )}

        {showUpload && (
          <div className="flex flex-col gap-sm rounded-xl bg-surface-container-low p-md">
            <label htmlFor="prm-file" className={`self-start cursor-pointer ${primary} ${busy ? "opacity-60" : ""}`}>
              {busy ? "Uploading…" : "Choose an image"}
              <input
                id="prm-file"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                  e.target.value = "";
                }}
              />
            </label>
            <label className="flex items-center gap-sm text-body-sm text-on-surface-variant">
              <input
                type="checkbox"
                checked={alsoSaveToProfile}
                onChange={(e) => setAlsoSaveToProfile(e.target.checked)}
                className="w-4 h-4 accent-primary"
              />
              {caseB ? "Also save to my profile" : "Also set this as my profile photo"}
            </label>
          </div>
        )}

        {error && <p role="alert" className="text-caption text-error">{error}</p>}

        <div className="flex flex-wrap gap-sm">
          <button type="button" onClick={close} disabled={busy} className={`flex-1 ${secondary} disabled:opacity-50`}>
            Cancel
          </button>
          {caseB ? (
            <>
              <button type="button" onClick={onOpenProfile} className={`flex-1 ${secondary}`}>
                Open My Profile
              </button>
              {!showUpload && (
                <button type="button" onClick={beginUpload} data-autofocus className={`flex-1 ${primary}`}>
                  Upload Photo
                </button>
              )}
            </>
          ) : (
            !showUpload && (
              <>
                <button type="button" onClick={beginUpload} className={`flex-1 ${secondary}`}>
                  Upload a Different Photo
                </button>
                <button type="button" onClick={useProfilePhoto} data-autofocus className={`flex-1 ${primary}`}>
                  Use Profile Photo
                </button>
              </>
            )
          )}
        </div>
      </SheetBody>
    </Sheet>
  );
}

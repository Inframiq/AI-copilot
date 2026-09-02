"use client";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useResumeStore } from "@/stores/resume-store";
import { uploadResumePhoto, uploadProfilePhoto } from "@/lib/photo-upload";
import { upsertCareerProfile, type CareerProfileInput } from "@/lib/career-profile-client";

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
  const content = useResumeStore((s) => s.content);
  const updateContent = useResumeStore((s) => s.updateContent);
  const resumeId = useResumeStore((s) => s.resumeId);
  const queryClient = useQueryClient();

  const caseB = profilePhotoUrl === null;
  const [showUpload, setShowUpload] = useState(false);
  const [alsoSaveToProfile, setAlsoSaveToProfile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (!next) close();
  }

  function close() {
    if (revertTo) setTemplateId(revertTo);
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
          contact: {
            name: content.contact.name ?? "",
            email: content.contact.email ?? "",
            phone: content.contact.phone ?? "",
            location: content.contact.location ?? "",
            linkedin: content.contact.linkedin ?? "",
            github: content.contact.github ?? "",
          },
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

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-surface p-lg shadow-2xl border border-outline-variant/20 flex flex-col gap-md">
          <Dialog.Title className="text-headline-sm font-bold text-on-surface">
            This template requires a profile photo.
          </Dialog.Title>

          {profilePhotoUrl === undefined ? (
            <Dialog.Description className="text-body-sm text-on-surface-variant">
              Loading your profile…
            </Dialog.Description>
          ) : caseB ? (
            <Dialog.Description className="text-body-sm text-on-surface-variant">
              You don&apos;t have a profile photo yet. Please upload one to continue.
            </Dialog.Description>
          ) : (
            <>
              <Dialog.Description className="text-body-sm text-on-surface-variant">
                We found a photo in your profile. Would you like to use this photo or upload a
                different one?
              </Dialog.Description>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={profilePhotoUrl}
                alt="Your profile photo"
                className="w-20 h-20 rounded-full object-cover border border-outline-variant/30"
              />
            </>
          )}

          {showUpload && (
            <div className="flex flex-col gap-sm rounded-xl border border-outline-variant/30 p-md">
              <label htmlFor="prm-file" className="text-label-sm text-primary cursor-pointer">
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
              <label className="flex items-center gap-sm text-caption text-on-surface-variant">
                <input
                  type="checkbox"
                  checked={alsoSaveToProfile}
                  onChange={(e) => setAlsoSaveToProfile(e.target.checked)}
                />
                {caseB ? "Also save to my profile" : "Also set this as my profile photo"}
              </label>
            </div>
          )}

          {error && <p className="text-label-sm text-error">{error}</p>}

          <div className="flex flex-wrap justify-end gap-sm pt-xs">
            <button
              type="button"
              onClick={close}
              className="px-md py-sm rounded-lg text-label-sm text-on-surface-variant hover:bg-surface-container-low transition-colors"
            >
              Cancel
            </button>

            {caseB ? (
              <>
                <button
                  type="button"
                  onClick={onOpenProfile}
                  className="px-md py-sm rounded-lg text-label-sm border border-outline-variant text-on-surface hover:bg-surface-container-low transition-colors"
                >
                  Open My Profile
                </button>
                {!showUpload && (
                  <button
                    type="button"
                    onClick={beginUpload}
                    className="px-md py-sm rounded-lg text-label-sm bg-primary text-on-primary hover:opacity-90 transition-opacity"
                  >
                    Upload Photo
                  </button>
                )}
              </>
            ) : (
              !showUpload && (
                <>
                  <button
                    type="button"
                    onClick={beginUpload}
                    className="px-md py-sm rounded-lg text-label-sm border border-outline-variant text-on-surface hover:bg-surface-container-low transition-colors"
                  >
                    Upload a Different Photo
                  </button>
                  <button
                    type="button"
                    onClick={useProfilePhoto}
                    className="px-md py-sm rounded-lg text-label-sm bg-primary text-on-primary hover:opacity-90 transition-opacity"
                  >
                    Use Profile Photo
                  </button>
                </>
              )
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

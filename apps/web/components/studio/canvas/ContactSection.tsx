"use client";
import { useResumeStore } from "@/stores/resume-store";
import { templateRequiresPhoto } from "@/lib/resume-templates";
import type { ResumeContent } from "@career-copilot/types";

// Ported from EditorPanel's "Contact Tab" — same store calls, same fields.
const CONTACT_FIELDS: Array<{ key: keyof ResumeContent["contact"]; label: string; type?: string }> = [
  { key: "name", label: "Full Name" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "location", label: "Location" },
  { key: "linkedin", label: "LinkedIn URL" },
  { key: "github", label: "GitHub URL" },
];

export function ContactSection() {
  const content = useResumeStore((s) => s.content);
  const updateContent = useResumeStore((s) => s.updateContent);
  const templateId = useResumeStore((s) => s.templateId);
  const setPhotoModal = useResumeStore((s) => s.setPhotoModal);
  if (!content) return null;

  return (
    <section className="flex flex-col gap-md">
      <h2 className="text-label-caps text-on-surface-variant">Contact</h2>
      <div className="bg-surface-container-lowest p-lg rounded-xl border border-outline-variant/20 flex flex-col gap-md">
        {templateRequiresPhoto(templateId) && (
          <div className="flex flex-col gap-xs">
            <label className="text-label-sm text-on-surface-variant">
              Profile Photo <span className="text-primary">· required by this template</span>
            </label>
            {content.contact.photo_url ? (
              <div className="flex items-center gap-md">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={content.contact.photo_url}
                  alt="Profile"
                  className="w-16 h-16 rounded-lg object-cover border border-outline-variant/30"
                />
                <button
                  type="button"
                  onClick={() => setPhotoModal(true)}
                  className="px-md py-sm rounded-lg border border-outline-variant text-label-sm text-primary hover:bg-surface-container-low transition-colors"
                >
                  Change photo
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateContent({ contact: { ...content.contact, photo_url: undefined } })
                  }
                  className="px-md py-sm rounded-lg text-label-sm text-on-surface-variant hover:text-error transition-colors"
                >
                  Remove photo
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-md">
                <p className="text-caption text-on-surface-variant">
                  This template needs a profile photo. Manage your default in My Profile.
                </p>
                <button
                  type="button"
                  onClick={() => setPhotoModal(true)}
                  className="px-md py-sm rounded-lg bg-primary text-on-primary text-label-sm hover:opacity-90 transition-opacity shrink-0"
                >
                  Choose photo
                </button>
              </div>
            )}
          </div>
        )}

        {CONTACT_FIELDS.map(({ key, label, type }) => (
          <div key={key} className="flex flex-col gap-xs">
            <label className="text-label-sm text-on-surface-variant">{label}</label>
            <input
              type={type ?? "text"}
              value={content.contact[key] ?? ""}
              onChange={(e) =>
                updateContent({
                  contact: { ...content.contact, [key]: e.target.value },
                })
              }
              className="w-full px-md py-sm rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-on-surface text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
            />
          </div>
        ))}
      </div>
    </section>
  );
}

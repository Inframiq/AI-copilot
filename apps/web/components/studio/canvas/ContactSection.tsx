"use client";
import { useResumeStore } from "@/stores/resume-store";
import { templateRequiresPhoto } from "@/lib/resume-templates";
import { useAvatarSrc } from "@/lib/avatar-url";
import type { ResumeContent } from "@career-copilot/types";
import { SOCIAL_HINT, isSocialLinkOk, tidySocialLink } from "@/lib/social-links";
import { tidyPhone } from "@/lib/phone";
import { SuggestInput } from "@/components/ui/SuggestInput";

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
  const photoSrc = useAvatarSrc(content?.contact.photo_url);
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
                  src={photoSrc ?? undefined}
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

        {CONTACT_FIELDS.map(({ key, label, type }) => {
          // LinkedIn and GitHub: a profile link, put in the standard form on
          // leaving the field. One that isn't — an upload can bring one in —
          // stays, flagged.
          const social = key === "linkedin" || key === "github" ? key : null;
          const bad = social !== null && !isSocialLinkOk(social, content.contact[social]);
          const id = `builder-contact-${key}`;
          return (
            <div key={key} className="flex flex-col gap-xs">
              <label htmlFor={id} className="text-label-sm text-on-surface-variant">{label}</label>
              {key === "location" ? (
                <SuggestInput
                  id={id}
                  kind="city"
                  value={content.contact.location ?? ""}
                  onValueChange={(location) => updateContent({ contact: { ...content.contact, location } })}
                  className="w-full px-md py-sm rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-on-surface text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                />
              ) : (
                <input
                  id={id}
                  type={type ?? "text"}
                  value={content.contact[key] ?? ""}
                  onChange={(e) =>
                    updateContent({
                      contact: { ...content.contact, [key]: e.target.value },
                    })
                  }
                  onBlur={
                    social
                      ? (e) => {
                          const tidy = tidySocialLink(social, e.target.value);
                          if (tidy !== null && tidy !== e.target.value) {
                            updateContent({ contact: { ...content.contact, [social]: tidy } });
                          }
                        }
                      : key === "phone"
                        // "(+91)-9966009727" → "+91 99660 09727" (lib/phone).
                        ? (e) => {
                            const tidy = tidyPhone(e.target.value);
                            if (tidy !== e.target.value) updateContent({ contact: { ...content.contact, phone: tidy } });
                          }
                        : undefined
                  }
                  placeholder={social ? `${social}.com/${social === "linkedin" ? "in/your-name" : "your-username"}` : undefined}
                  aria-invalid={bad || undefined}
                  aria-describedby={bad ? `${id}-hint` : undefined}
                  className={`w-full px-md py-sm rounded-lg border bg-surface-container-lowest text-on-surface text-body-md focus:outline-none focus:ring-2 transition-all ${
                    bad ? "border-error focus:ring-error/20" : "border-outline-variant/50 focus:ring-primary/30 focus:border-primary"
                  }`}
                />
              )}
              {bad && (
                <p id={`${id}-hint`} className="text-caption text-error">
                  {SOCIAL_HINT[social]}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

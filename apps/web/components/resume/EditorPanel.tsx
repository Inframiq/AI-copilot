"use client";
import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { useResumeStore } from "@/stores/resume-store";
import { useTailoringStore } from "@/stores/tailoring-store";
import { HumanizeSlider } from "./HumanizeSlider";
import { SkillsDelta } from "./SkillsDelta";
import { uploadResumePhoto } from "@/lib/photo-upload";
import { RESUME_TEMPLATES } from "@/lib/resume-templates";
import { CheckCircle } from "@phosphor-icons/react";
import type { ResumeContent } from "@career-copilot/types";

const CONTACT_FIELDS: Array<{ key: keyof ResumeContent["contact"]; label: string; type?: string }> = [
  { key: "name", label: "Full Name" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "location", label: "Location" },
  { key: "linkedin", label: "LinkedIn URL" },
  { key: "github", label: "GitHub URL" },
];

export function EditorPanel() {
  const content = useResumeStore((s) => s.content);
  const updateContent = useResumeStore((s) => s.updateContent);
  const resumeId = useResumeStore((s) => s.resumeId);
  const templateId = useResumeStore((s) => s.templateId);
  const setTemplateId = useResumeStore((s) => s.setTemplateId);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const { jdText, setJd, companyName, setCompanyName, companyKeywords, runTailoring, isLoading } = useTailoringStore();

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !resumeId || !content) return;
    setIsUploadingPhoto(true);
    setPhotoError(null);
    try {
      const photoUrl = await uploadResumePhoto(resumeId, file);
      updateContent({ contact: { ...content.contact, photo_url: photoUrl } });
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Photo upload failed");
    } finally {
      setIsUploadingPhoto(false);
      e.target.value = "";
    }
  }

  if (!content) {
    return (
      <div className="flex items-center justify-center h-full p-lg">
        <p className="text-on-surface-variant text-body-sm">Loading resume…</p>
      </div>
    );
  }

  // Substantive content — either typed in by hand across the tabs, or
  // already there from an uploaded/parsed resume — not just a blank scaffold.
  const hasResumeContent =
    content.experience.length > 0 || content.education.length > 0 || content.skills.length > 0;

  return (
    <div className="flex flex-col gap-lg h-full overflow-y-auto p-lg">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-headline-md font-bold text-primary">Content Editor</h3>
      </div>

      <Tabs.Root defaultValue="template">
        <Tabs.List className="flex gap-xs mb-lg border-b border-outline-variant/20 pb-sm overflow-x-auto">
          {(["template", "contact", "summary", "experience", "education", "skills", "languages", "certifications"] as const).map((tab) => (
            <Tabs.Trigger
              key={tab}
              value={tab}
              className="px-md py-sm rounded-t-lg text-label-md text-on-surface-variant capitalize whitespace-nowrap
                data-[state=active]:bg-secondary-container data-[state=active]:text-primary transition-colors flex-shrink-0"
            >
              {tab}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* Template Tab */}
        <Tabs.Content value="template" className="flex flex-col gap-md">
          <p className="text-body-sm text-on-surface-variant">
            Choose the layout used for your live preview and PDF export. Switching updates both immediately.
          </p>
          <div className="grid grid-cols-2 gap-md">
            {RESUME_TEMPLATES.map((t) => {
              const isSelected = templateId === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTemplateId(t.id)}
                  className={`text-left rounded-xl border-2 shadow-sm transition-all overflow-hidden flex flex-col ${
                    isSelected
                      ? "border-primary ring-2 ring-primary/30"
                      : "border-outline-variant/30 bg-surface hover:border-primary/40"
                  }`}
                >
                  <div className="relative bg-surface-container-high" style={{ aspectRatio: "834 / 1179" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/resume-templates/${t.id}.png`}
                      alt={`${t.label} template preview`}
                      className="w-full h-full object-cover object-top"
                      loading="lazy"
                    />
                    {isSelected && (
                      <div className="absolute top-xs right-xs w-6 h-6 rounded-full bg-primary flex items-center justify-center shadow-md">
                        <CheckCircle size={16} weight="fill" className="text-on-primary" />
                      </div>
                    )}
                  </div>
                  <div className="p-sm bg-surface">
                    <span className="text-label-sm font-bold text-on-surface block">{t.label}</span>
                    <p className="text-caption text-on-surface-variant leading-tight">{t.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </Tabs.Content>

        {/* Contact Tab */}
        <Tabs.Content value="contact" className="flex flex-col gap-md">
          <div className="bg-surface p-lg rounded-xl border border-outline-variant/20 shadow-sm flex flex-col gap-md">
            <div className="flex flex-col gap-xs">
              <label className="text-label-sm text-on-surface-variant">Profile Photo</label>
              <div className="flex items-center gap-md">
                {content.contact.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={content.contact.photo_url}
                    alt="Profile"
                    className="w-16 h-16 rounded-lg object-cover border border-outline-variant/30"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-surface-container-high border border-dashed border-outline-variant flex items-center justify-center text-label-sm text-on-surface-variant">
                    None
                  </div>
                )}
                <label className="px-md py-sm rounded-lg border border-outline-variant text-label-sm text-primary hover:bg-surface-container-low transition-colors cursor-pointer">
                  {isUploadingPhoto ? "Uploading…" : "Upload Photo"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handlePhotoChange}
                    disabled={isUploadingPhoto}
                    className="hidden"
                  />
                </label>
              </div>
              {photoError && <p className="text-label-sm text-error">{photoError}</p>}
            </div>

            <div className="flex flex-col gap-xs">
              <label className="text-label-sm text-on-surface-variant">Headline / Job Title</label>
              <input
                type="text"
                value={content.headline ?? ""}
                onChange={(e) => updateContent({ headline: e.target.value })}
                placeholder="e.g. Senior Financial Analyst"
                className="w-full px-md py-sm rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-on-surface text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
              />
            </div>

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
                  className="w-full px-md py-sm rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-on-surface text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                />
              </div>
            ))}
          </div>
        </Tabs.Content>

        {/* Summary Tab */}
        <Tabs.Content value="summary" className="flex flex-col gap-md">
          <div className="bg-surface p-lg rounded-xl border border-outline-variant/20 shadow-sm flex flex-col gap-md">
            <div className="flex items-center gap-sm mb-xs">
              <h4 className="text-headline-md font-bold text-on-surface">Professional Summary</h4>
            </div>
            <textarea
              value={content.summary ?? ""}
              onChange={(e) => updateContent({ summary: e.target.value })}
              rows={6}
              placeholder="Write a compelling professional summary…"
              className="w-full px-md py-sm rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-on-surface text-body-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
            />
          </div>
        </Tabs.Content>

        {/* Experience Tab */}
        <Tabs.Content value="experience" className="flex flex-col gap-lg">
          {content.experience.map((job, i) => (
            <div
              key={i}
              className="bg-surface border border-outline-variant/20 rounded-xl p-md flex flex-col gap-sm shadow-sm"
            >
              <div className="flex items-center justify-between mb-xs">
                <span className="text-label-sm text-on-surface-variant font-bold uppercase tracking-wider">
                  Position {i + 1}
                </span>
                <button
                  onClick={() => {
                    const updated = content.experience.filter((_, idx) => idx !== i);
                    updateContent({ experience: updated });
                  }}
                  className="text-label-sm text-error hover:underline"
                >
                  Remove
                </button>
              </div>

              <div className="grid grid-cols-2 gap-sm">
                <div className="flex flex-col gap-xs">
                  <label className="text-label-sm text-on-surface-variant">Company</label>
                  <input
                    type="text"
                    value={job.company}
                    onChange={(e) => {
                      const updated = [...content.experience];
                      updated[i] = { ...updated[i], company: e.target.value };
                      updateContent({ experience: updated });
                    }}
                    placeholder="Company name"
                    className="w-full px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <label className="text-label-sm text-on-surface-variant">Role</label>
                  <input
                    type="text"
                    value={job.title}
                    onChange={(e) => {
                      const updated = [...content.experience];
                      updated[i] = { ...updated[i], title: e.target.value };
                      updateContent({ experience: updated });
                    }}
                    placeholder="Job title"
                    className="w-full px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <label className="text-label-sm text-on-surface-variant">Start</label>
                  <input
                    type="text"
                    value={job.start}
                    onChange={(e) => {
                      const updated = [...content.experience];
                      updated[i] = { ...updated[i], start: e.target.value };
                      updateContent({ experience: updated });
                    }}
                    placeholder="e.g. Jan 2021"
                    className="w-full px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <label className="text-label-sm text-on-surface-variant">End</label>
                  <input
                    type="text"
                    value={job.end ?? ""}
                    onChange={(e) => {
                      const updated = [...content.experience];
                      updated[i] = { ...updated[i], end: e.target.value };
                      updateContent({ experience: updated });
                    }}
                    placeholder="e.g. Present"
                    className="w-full px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-xs">
                <label className="text-label-sm text-on-surface-variant">
                  Bullet Points <span className="font-normal">(one per line)</span>
                </label>
                <textarea
                  value={job.bullets.join("\n")}
                  onChange={(e) => {
                    const updated = [...content.experience];
                    updated[i] = {
                      ...updated[i],
                      bullets: e.target.value.split("\n"),
                    };
                    updateContent({ experience: updated });
                  }}
                  rows={4}
                  placeholder="• Led team of 5 engineers…&#10;• Improved performance by 40%…"
                  className="w-full px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-body-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                />
              </div>
            </div>
          ))}

          <button
            onClick={() =>
              updateContent({
                experience: [
                  ...content.experience,
                  { company: "", title: "", start: "", end: "", bullets: [] },
                ],
              })
            }
            className="flex items-center justify-center gap-sm px-md py-sm rounded-lg border border-dashed border-outline-variant text-primary text-label-md hover:bg-surface-container-low transition-colors"
          >
            + Add Experience
          </button>
        </Tabs.Content>

        {/* Education Tab */}
        <Tabs.Content value="education" className="flex flex-col gap-lg">
          {content.education.map((edu, i) => (
            <div
              key={i}
              className="bg-surface border border-outline-variant/20 rounded-xl p-md flex flex-col gap-sm shadow-sm"
            >
              <div className="flex items-center justify-between mb-xs">
                <span className="text-label-sm text-on-surface-variant font-bold uppercase tracking-wider">
                  Education {i + 1}
                </span>
                <button
                  onClick={() => {
                    const updated = content.education.filter((_, idx) => idx !== i);
                    updateContent({ education: updated });
                  }}
                  className="text-label-sm text-error hover:underline"
                >
                  Remove
                </button>
              </div>

              <div className="flex flex-col gap-xs">
                <label className="text-label-sm text-on-surface-variant">Institution</label>
                <input
                  type="text"
                  value={edu.institution}
                  onChange={(e) => {
                    const updated = [...content.education];
                    updated[i] = { ...updated[i], institution: e.target.value };
                    updateContent({ education: updated });
                  }}
                  placeholder="University name"
                  className="w-full px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                />
              </div>
              <div className="flex flex-col gap-xs">
                <label className="text-label-sm text-on-surface-variant">Degree</label>
                <input
                  type="text"
                  value={edu.degree}
                  onChange={(e) => {
                    const updated = [...content.education];
                    updated[i] = { ...updated[i], degree: e.target.value };
                    updateContent({ education: updated });
                  }}
                  placeholder="e.g. B.S. Computer Science"
                  className="w-full px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                />
              </div>
              <div className="flex flex-col gap-xs">
                <label className="text-label-sm text-on-surface-variant">Year</label>
                <input
                  type="text"
                  value={edu.year}
                  onChange={(e) => {
                    const updated = [...content.education];
                    updated[i] = { ...updated[i], year: e.target.value };
                    updateContent({ education: updated });
                  }}
                  placeholder="e.g. 2020"
                  className="w-full px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                />
              </div>
            </div>
          ))}

          <button
            onClick={() =>
              updateContent({
                education: [
                  ...content.education,
                  { institution: "", degree: "", year: "" },
                ],
              })
            }
            className="flex items-center justify-center gap-sm px-md py-sm rounded-lg border border-dashed border-outline-variant text-primary text-label-md hover:bg-surface-container-low transition-colors"
          >
            + Add Education
          </button>
        </Tabs.Content>

        {/* Skills Tab */}
        <Tabs.Content value="skills" className="flex flex-col gap-md">
          <div className="bg-surface p-lg rounded-xl border border-outline-variant/20 shadow-sm flex flex-col gap-md">
            <h4 className="text-headline-md font-bold text-on-surface">Skills</h4>
            <div className="flex flex-col gap-xs">
              <label className="text-label-sm text-on-surface-variant">
                Skills <span className="font-normal">(comma-separated)</span>
              </label>
              <textarea
                value={content.skills.join(", ")}
                onChange={(e) =>
                  updateContent({
                    skills: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                rows={4}
                placeholder="React, TypeScript, Node.js, Python…"
                className="w-full px-md py-sm rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-on-surface text-body-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              />
            </div>
            {content.skills.length > 0 && (
              <div className="flex flex-wrap gap-xs">
                {content.skills.map((skill) => (
                  <span
                    key={skill}
                    className="px-sm py-xs rounded-full bg-secondary-container text-primary text-label-sm"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            )}
          </div>
        </Tabs.Content>

        {/* Languages Tab */}
        <Tabs.Content value="languages" className="flex flex-col gap-md">
          {(content.languages ?? []).map((lang, i) => (
            <div
              key={i}
              className="bg-surface border border-outline-variant/20 rounded-xl p-md flex items-end gap-sm shadow-sm"
            >
              <div className="flex-1 flex flex-col gap-xs">
                <label className="text-label-sm text-on-surface-variant">Language</label>
                <input
                  type="text"
                  value={lang.name}
                  onChange={(e) => {
                    const updated = [...(content.languages ?? [])];
                    updated[i] = { ...updated[i], name: e.target.value };
                    updateContent({ languages: updated });
                  }}
                  placeholder="e.g. Spanish"
                  className="w-full px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                />
              </div>
              <div className="flex-1 flex flex-col gap-xs">
                <label className="text-label-sm text-on-surface-variant">Proficiency</label>
                <input
                  type="text"
                  value={lang.level}
                  onChange={(e) => {
                    const updated = [...(content.languages ?? [])];
                    updated[i] = { ...updated[i], level: e.target.value };
                    updateContent({ languages: updated });
                  }}
                  placeholder="e.g. Native, B2, Proficient"
                  className="w-full px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                />
              </div>
              <button
                onClick={() => {
                  const updated = (content.languages ?? []).filter((_, idx) => idx !== i);
                  updateContent({ languages: updated });
                }}
                className="text-label-sm text-error hover:underline py-xs"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              updateContent({ languages: [...(content.languages ?? []), { name: "", level: "" }] })
            }
            className="flex items-center justify-center gap-sm px-md py-sm rounded-lg border border-dashed border-outline-variant text-primary text-label-md hover:bg-surface-container-low transition-colors"
          >
            + Add Language
          </button>
        </Tabs.Content>

        {/* Certifications Tab */}
        <Tabs.Content value="certifications" className="flex flex-col gap-lg">
          <div className="bg-surface p-lg rounded-xl border border-outline-variant/20 shadow-sm flex flex-col gap-md">
            <h4 className="text-headline-md font-bold text-on-surface">Certifications</h4>
            <div className="flex flex-col gap-xs">
              <label className="text-label-sm text-on-surface-variant">
                Certifications <span className="font-normal">(one per line)</span>
              </label>
              <textarea
                value={(content.certifications ?? []).join("\n")}
                onChange={(e) =>
                  updateContent({
                    certifications: e.target.value.split("\n").filter(Boolean),
                  })
                }
                rows={3}
                placeholder="AWS Certified Solutions Architect&#10;PMP"
                className="w-full px-md py-sm rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-on-surface text-body-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              />
            </div>
          </div>

          <div className="bg-surface p-lg rounded-xl border border-outline-variant/20 shadow-sm flex flex-col gap-md">
            <h4 className="text-headline-md font-bold text-on-surface">Awards</h4>
            <div className="flex flex-col gap-xs">
              <label className="text-label-sm text-on-surface-variant">
                Awards <span className="font-normal">(one per line)</span>
              </label>
              <textarea
                value={(content.awards ?? []).join("\n")}
                onChange={(e) =>
                  updateContent({
                    awards: e.target.value.split("\n").filter(Boolean),
                  })
                }
                rows={3}
                placeholder="Employee of the Year 2023"
                className="w-full px-md py-sm rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-on-surface text-body-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              />
            </div>
          </div>
        </Tabs.Content>
      </Tabs.Root>

      {/* JD Context + AI Tailoring — only once there's an actual resume to
          tailor (either filled in by hand across the tabs above, or already
          populated by an uploaded/parsed resume), not on a blank scaffold. */}
      {hasResumeContent ? (
      <div className="border-t border-outline-variant/20 pt-lg flex flex-col gap-md">
        <p className="text-label-md text-on-surface-variant uppercase tracking-wider">JD Context</p>

        {/* Company Name — optional, enables company-specific ATS intelligence */}
        <div className="flex flex-col gap-xs">
          <label className="text-label-sm text-on-surface-variant flex items-center gap-xs">
            Target Company
            <span className="text-caption bg-secondary-container text-primary px-xs py-0.5 rounded-full">optional</span>
          </label>
          <input
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="e.g. Google, Stripe, Amazon…"
            maxLength={200}
            className="w-full px-md py-sm rounded-lg border border-outline-variant/50 bg-surface text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
          />
          {companyName.trim() && (
            <p className="text-caption text-on-surface-variant">
              AI will extract {companyName.trim()}'s culture keywords, tech preferences, and ATS filter phrases to further optimise your resume.
            </p>
          )}
        </div>

        <textarea
          value={jdText}
          onChange={(e) => setJd("", e.target.value)}
          placeholder="Paste job description here to tailor your resume with AI…"
          rows={4}
          className="w-full px-md py-md rounded-lg border border-outline-variant/50 bg-surface text-body-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
        />
        <HumanizeSlider />
        <button
          onClick={() => resumeId && runTailoring(resumeId)}
          disabled={isLoading || !jdText || !resumeId}
          className="w-full py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-md hover:shadow-lg hover:scale-[0.98] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? "Tailoring…" : "Tailor to JD"}
        </button>

        {/* Company Keywords panel — shown after tailoring when company_name was used */}
        {companyKeywords.length > 0 && (
          <div className="rounded-xl border border-primary/20 bg-primary-container/20 p-md flex flex-col gap-sm">
            <p className="text-label-sm font-bold text-primary flex items-center gap-xs">
              <span>🏢</span>
              {companyName} ATS Keywords
            </p>
            <p className="text-caption text-on-surface-variant">
              These are company-specific keywords injected into your resume to pass {companyName}'s ATS filters.
            </p>
            <div className="flex flex-wrap gap-xs">
              {companyKeywords.map((kw) => (
                <span
                  key={kw}
                  className="px-sm py-0.5 rounded-full bg-primary/10 text-primary text-caption font-medium border border-primary/20"
                >
                  {kw}
                </span>
              ))}
            </div>
          </div>
        )}

        <SkillsDelta />
      </div>
      ) : (
        <div className="border-t border-outline-variant/20 pt-lg">
          <div className="rounded-xl border border-dashed border-outline-variant/40 p-lg text-center">
            <p className="text-body-sm text-on-surface-variant">
              Fill in your experience, education, or skills above — or upload a resume from Profile —
              to unlock AI tailoring against a job description.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

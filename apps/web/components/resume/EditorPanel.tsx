"use client";
import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { useResumeStore } from "@/stores/resume-store";
import { useTailoringStore } from "@/stores/tailoring-store";
import { HumanizeSlider } from "./HumanizeSlider";
import { BulletReviewPanel } from "./BulletReviewPanel";
import { RESUME_TEMPLATES, templateRequiresPhoto } from "@/lib/resume-templates";
import { sameCompany } from "@/lib/career-profile-client";
import { CaretDown, CaretRight, CheckCircle, FileText, Target, WarningCircle, Sparkle } from "@phosphor-icons/react";
import type { ResumeContent } from "@career-copilot/types";

// Matches resume_spec.py HARD_LIMITS["summary"]["max_words"] — the backend
// from-scratch generator enforces this too (see resume_generator.py's
// _truncate_summary_or_objective); this is the same cap applied where a
// user types or pastes a summary directly.
const SUMMARY_MAX_WORDS = 80;

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
  const setPhotoModal = useResumeStore((s) => s.setPhotoModal);

  const {
    jdText, setJd,
    jdId,
    companyName, setCompanyName,
    atsScore, matchedSkills, missingSkills,
    prioritySkills, togglePrioritySkill,
    runTailoring, isLoading, error: tailoringError,
    pendingContent,
    humanizeLevel, setHumanizeLevel,
  } = useTailoringStore();

  // "JD context mode" = user navigated from JD Analyzer with a saved JD but
  // hasn't run tailoring yet. The tabs collapse so the tailoring form is the
  // clear focus. "Tailoring mode" = AI has run and BulletReviewPanel is shown.
  const hasJdContext = !!jdId && pendingContent === null;
  const isTailoringMode = pendingContent !== null || hasJdContext;
  const [editorOpen, setEditorOpen] = useState(!isTailoringMode);
  // Collapsed by default — reference material, not the primary focus of
  // this screen (the tailoring form / bullet review is).
  const [jdSectionOpen, setJdSectionOpen] = useState(false);

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

  const summaryWordCount = (content.summary ?? "").trim().split(/\s+/).filter(Boolean).length;

  // Merges Position i into the immediately preceding Position — offered
  // only when the two share a company (see sameCompany), which is exactly
  // when the PDF templates already render them grouped under one company
  // header. Resume entries are conventionally most-recent-first, so the
  // preceding entry (i - 1) is treated as the more recent role: its title
  // and end date (e.g. "Present") survive, the older role's start date
  // becomes the merged entry's start, and both roles' bullets are kept —
  // recent role's first, since that's the more relevant position — rather
  // than silently dropping either one's content.
  const mergeExperienceIntoPreviousRole = (i: number) => {
    const recent = content.experience[i - 1];
    const older = content.experience[i];
    const merged = {
      ...recent,
      start: older.start,
      bullets: [...recent.bullets, ...older.bullets],
    };
    const updated = content.experience.filter((_, idx) => idx !== i && idx !== i - 1);
    updated.splice(i - 1, 0, merged);
    updateContent({ experience: updated });
  };

  function handleSummaryChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    const words = value.trim().split(/\s+/).filter(Boolean);
    // Hard cap at the resume spec's summary limit (resume_spec.py
    // HARD_LIMITS["summary"]["max_words"]) — a long, unbounded summary was
    // the other half of the "resume looks artificially padded" complaint
    // (the skills cap was the first half). Trims from the end so text the
    // user already typed at the front is never silently rewritten.
    if (words.length <= SUMMARY_MAX_WORDS) {
      updateContent({ summary: value });
    } else {
      updateContent({ summary: words.slice(0, SUMMARY_MAX_WORDS).join(" ") });
    }
  }

  return (
    <div className="flex flex-col gap-lg h-full overflow-y-auto p-lg">
      {/* Header — collapsible in tailoring mode */}
      <button
        onClick={() => setEditorOpen((o) => !o)}
        className={`flex items-center justify-between w-full text-left ${
          isTailoringMode ? "cursor-pointer group" : "cursor-default"
        }`}
        disabled={!isTailoringMode}
      >
        <h3 className="text-headline-md font-bold text-primary">Content Editor</h3>
        {isTailoringMode && (
          <span className="flex items-center gap-xs text-label-sm text-on-surface-variant group-hover:text-primary transition-colors">
            {editorOpen ? (
              <>
                <CaretDown size={16} />
                Hide
              </>
            ) : (
              <>
                <CaretRight size={16} />
                Expand to edit
              </>
            )}
          </span>
        )}
      </button>

      {/* Content editor tabs — hidden when collapsed in tailoring mode, always visible otherwise */}
      {(!isTailoringMode || editorOpen) && <Tabs.Root defaultValue="template">
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

        {/* Template Tab — a compact dropdown when arriving from JD Analyzer
            (isTailoringMode), since the full visual grid competes for
            attention with the tailoring form that's the actual point of
            landing here. Sidebar-entry Studio usage keeps the full grid. */}
        <Tabs.Content value="template" className="flex flex-col gap-md">
          <p className="text-body-sm text-on-surface-variant">
            Choose the layout used for your live preview and PDF export. Switching updates both immediately.
          </p>
          {isTailoringMode ? (
            <div className="flex items-center gap-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/resume-templates/${templateId}.png`}
                alt="Selected template preview"
                className="w-16 h-auto rounded-lg border border-outline-variant/30 shrink-0"
                style={{ aspectRatio: "834 / 1179" }}
              />
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className="flex-1 px-md py-sm bg-surface-container border border-outline-variant/40 rounded-xl text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              >
                {RESUME_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>{t.label} — {t.description}</option>
                ))}
              </select>
            </div>
          ) : (
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
          )}
        </Tabs.Content>

        {/* Contact Tab */}
        <Tabs.Content value="contact" className="flex flex-col gap-md">
          <div className="bg-surface p-lg rounded-xl border border-outline-variant/20 shadow-sm flex flex-col gap-md">
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
                  className="w-full px-md py-sm rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-on-surface text-body-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                />
              </div>
            ))}
          </div>
        </Tabs.Content>

        {/* Summary Tab */}
        <Tabs.Content value="summary" className="flex flex-col gap-md">
          <div className="bg-surface p-lg rounded-xl border border-outline-variant/20 shadow-sm flex flex-col gap-md">
            <div className="flex items-center justify-between gap-sm mb-xs">
              <h4 className="text-headline-md font-bold text-on-surface">Professional Summary</h4>
              <span
                className={`text-caption ${
                  summaryWordCount >= SUMMARY_MAX_WORDS ? "text-error font-medium" : "text-on-surface-variant"
                }`}
              >
                {summaryWordCount} / {SUMMARY_MAX_WORDS} words
              </span>
            </div>
            <textarea
              value={content.summary ?? ""}
              onChange={handleSummaryChange}
              rows={6}
              placeholder="Write a compelling professional summary…"
              className="w-full px-md py-sm rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-on-surface text-body-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
            />
            {summaryWordCount >= SUMMARY_MAX_WORDS && (
              <p className="text-caption text-error">
                A tight, {SUMMARY_MAX_WORDS}-word summary reads stronger on an ATS resume than a long one — trim before adding more.
              </p>
            )}
          </div>
        </Tabs.Content>

        {/* Experience Tab */}
        <Tabs.Content value="experience" className="flex flex-col gap-lg">
          {content.experience.map((job, i) => (
            <div key={i}>
              {sameCompany(job.company, content.experience[i - 1]?.company) && (
                <div className="flex items-center justify-between gap-sm mb-sm px-md py-sm rounded-lg bg-primary/5 border border-primary/20">
                  <p className="text-caption text-on-surface-variant">
                    Same company as the role above — your resume will already show these grouped
                    under one company header. Prefer a single combined entry instead?
                  </p>
                  <button
                    onClick={() => mergeExperienceIntoPreviousRole(i)}
                    className="shrink-0 text-label-sm text-primary font-semibold hover:underline whitespace-nowrap"
                  >
                    Merge into one entry
                  </button>
                </div>
              )}
              <div
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
      </Tabs.Root>}

      {/* AI Tailoring section */}
      {hasResumeContent || isTailoringMode ? (
        <div className="border-t border-outline-variant/20 pt-lg flex flex-col gap-md">
          {/* JD-analyzer path only — the manual-paste path (jdId unset)
              already has the JD text right there in an editable textarea. */}
          {jdId && jdText && (
            <div className="rounded-xl border border-outline-variant/20 bg-surface-container/40 overflow-hidden">
              <button
                type="button"
                onClick={() => setJdSectionOpen((o) => !o)}
                className="w-full flex items-center justify-between px-md py-sm text-left"
              >
                <span className="flex items-center gap-xs text-label-sm font-bold text-on-surface">
                  <FileText size={16} className="text-primary" />
                  Job Description
                </span>
                {jdSectionOpen ? <CaretDown size={14} /> : <CaretRight size={14} />}
              </button>
              {jdSectionOpen && (
                <div className="px-md pb-md">
                  <p className="text-body-sm text-on-surface-variant whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {jdText}
                  </p>
                </div>
              )}
            </div>
          )}

          {pendingContent ? (
            /* ── Review step: show after tailoring runs ── */
            <BulletReviewPanel />
          ) : hasJdContext ? (
            /* ── JD-context mode: arrived from JD Analyzer, ready to tailor ── */
            <TailoringForm
              jdText={jdText}
              companyName={companyName}
              setCompanyName={setCompanyName}
              atsScore={atsScore}
              matchedSkills={matchedSkills}
              missingSkills={missingSkills}
              prioritySkills={prioritySkills}
              togglePrioritySkill={togglePrioritySkill}
              isLoading={isLoading}
              error={tailoringError}
              onTailor={() => resumeId && runTailoring(resumeId)}
              resumeId={resumeId}
              humanizeLevel={humanizeLevel}
              setHumanizeLevel={setHumanizeLevel}
            />
          ) : (
            /* ── Manual mode: user pastes JD directly in the studio ── */
            <>
              <p className="text-label-md text-on-surface-variant uppercase tracking-wider">
                Tailor to Job Description
              </p>

              <div className="flex flex-col gap-xs">
                <label className="text-label-sm text-on-surface-variant flex items-center gap-xs">
                  Target Company
                  <span className="text-caption bg-secondary-container text-primary px-xs py-0.5 rounded-full">
                    optional
                  </span>
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
                    AI will extract {companyName.trim()}&apos;s culture keywords, tech preferences, and ATS
                    filter phrases to further optimise your resume.
                  </p>
                )}
              </div>

              <textarea
                value={jdText}
                onChange={(e) => setJd("", e.target.value)}
                placeholder="Paste the job description here — AI will rewrite your bullets to match it…"
                rows={5}
                className="w-full px-md py-md rounded-lg border border-outline-variant/50 bg-surface text-body-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              />

              <HumanizeSlider value={humanizeLevel} onChange={setHumanizeLevel} />

              <button
                onClick={() => resumeId && runTailoring(resumeId)}
                disabled={isLoading || !jdText.trim() || !resumeId}
                className="w-full py-md rounded-xl text-label-md text-on-primary bg-primary shadow-md hover:shadow-lg hover:scale-[0.98] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? "Tailoring your resume…" : "Tailor Resume"}
              </button>

              {isLoading && (
                <p className="text-caption text-on-surface-variant text-center">
                  AI is rewriting your bullets — this can take up to a couple of minutes…
                </p>
              )}
              {!isLoading && tailoringError && (
                <p className="text-caption text-error text-center">{tailoringError}</p>
              )}
            </>
          )}
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

// ── TailoringForm ─────────────────────────────────────────────────────────────
// Shown when the user arrives from JD Analyzer (jdId is set). Pre-fills all
// the JD context from the store and lets the user configure then run tailoring.
function TailoringForm({
  jdText,
  companyName,
  setCompanyName,
  atsScore,
  matchedSkills,
  missingSkills,
  prioritySkills,
  togglePrioritySkill,
  isLoading,
  error,
  onTailor,
  resumeId,
  humanizeLevel,
  setHumanizeLevel,
}: {
  jdText: string;
  companyName: string;
  setCompanyName: (v: string) => void;
  atsScore: number | null;
  matchedSkills: string[];
  missingSkills: string[];
  prioritySkills: string[];
  togglePrioritySkill: (skill: string) => void;
  isLoading: boolean;
  error: string | null;
  onTailor: () => void;
  resumeId: string | null;
  humanizeLevel: number;
  setHumanizeLevel: (n: number) => void;
}) {
  const prioritySet = new Set(prioritySkills.map((s) => s.toLowerCase()));

  return (
    <div className="flex flex-col gap-md">
      {/* Header */}
      <div className="flex items-center gap-sm">
        <Sparkle size={18} className="text-primary" />
        <p className="text-label-md font-bold text-on-surface">Tailor Resume to this JD</p>
      </div>

      {/* ATS context badge — only if analysis was run */}
      {atsScore !== null && (
        <div className="rounded-xl border border-outline-variant/20 bg-surface-container/50 p-md flex items-center gap-md">
          <div className="flex-shrink-0 text-center">
            <div
              className={`text-headline-md font-bold ${
                atsScore >= 80 ? "text-success" : atsScore >= 60 ? "text-primary" : "text-error"
              }`}
            >
              {atsScore}%
            </div>
            <p className="text-caption text-on-surface-variant">ATS Match</p>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap gap-xs">
              {matchedSkills.slice(0, 5).map((s) => (
                <span
                  key={s}
                  className="flex items-center gap-xs px-xs py-0.5 bg-success/10 text-caption text-on-surface rounded-md border border-success/25"
                >
                  <CheckCircle size={10} weight="fill" className="text-success shrink-0" />
                  {s}
                </span>
              ))}
              {matchedSkills.length > 5 && (
                <span className="text-caption text-on-surface-variant">+{matchedSkills.length - 5} more</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Priority skills — missing keywords the user can flag for the AI */}
      {missingSkills.length > 0 && (
        <div className="rounded-xl border border-outline-variant/20 bg-surface p-md flex flex-col gap-sm">
          <div className="flex items-center gap-xs">
            <Target size={15} className="text-primary shrink-0" />
            <p className="text-label-sm font-bold text-on-surface">Keywords to Prioritize</p>
          </div>
          <p className="text-caption text-on-surface-variant -mt-xs">
            Click any gap keyword to tell the AI to weave it into your bullets.
          </p>
          <div className="flex flex-wrap gap-xs">
            {missingSkills.map((skill) => {
              const selected = prioritySet.has(skill.toLowerCase());
              return (
                <button
                  key={skill}
                  type="button"
                  onClick={() => togglePrioritySkill(skill)}
                  className={`flex items-center gap-xs px-sm py-0.5 text-caption font-medium rounded-md border transition-all ${
                    selected
                      ? "bg-primary text-on-primary border-primary"
                      : "bg-error-container/30 text-on-error-container border-error/25 hover:border-primary hover:text-primary"
                  }`}
                >
                  {selected ? (
                    <CheckCircle size={11} weight="fill" className="shrink-0" />
                  ) : (
                    <WarningCircle size={11} weight="fill" className="text-error shrink-0" />
                  )}
                  {skill}
                </button>
              );
            })}
          </div>
          {prioritySkills.length > 0 && (
            <p className="text-caption text-primary font-medium">
              {prioritySkills.length} keyword{prioritySkills.length !== 1 ? "s" : ""} flagged — AI will focus on these.
            </p>
          )}
        </div>
      )}

      {/* Target Company */}
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
      </div>

      {/* Humanize slider */}
      <HumanizeSlider value={humanizeLevel} onChange={setHumanizeLevel} />

      {/* Run tailoring */}
      <button
        onClick={onTailor}
        disabled={isLoading || !resumeId}
        className="w-full py-md rounded-xl text-label-md text-on-primary bg-primary shadow-md hover:shadow-lg hover:scale-[0.98] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-sm"
      >
        <Sparkle size={18} />
        {isLoading ? "Tailoring your resume…" : "Tailor Resume"}
      </button>

      {isLoading && (
        <p className="text-caption text-on-surface-variant text-center">
          AI is rewriting your bullets — this can take up to a couple of minutes…
        </p>
      )}
      {!isLoading && error && (
        <p className="text-caption text-error text-center">{error}</p>
      )}
    </div>
  );
}

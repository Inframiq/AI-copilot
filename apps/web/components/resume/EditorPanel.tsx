"use client";
import * as Tabs from "@radix-ui/react-tabs";
import { useResumeStore } from "@/stores/resume-store";
import { useTailoringStore } from "@/stores/tailoring-store";
import { HumanizeSlider } from "./HumanizeSlider";
import { SkillsDelta } from "./SkillsDelta";
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

  const { jdText, setJd, runTailoring, isLoading } = useTailoringStore();

  if (!content) {
    return (
      <div className="flex items-center justify-center h-full p-lg">
        <p className="text-on-surface-variant text-body-sm">Loading resume…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-lg h-full overflow-y-auto p-lg">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-headline-md font-bold text-primary">Content Editor</h3>
      </div>

      <Tabs.Root defaultValue="contact">
        <Tabs.List className="flex gap-xs mb-lg border-b border-outline-variant/20 pb-sm overflow-x-auto">
          {(["contact", "summary", "experience", "education", "skills"] as const).map((tab) => (
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

        {/* Contact Tab */}
        <Tabs.Content value="contact" className="flex flex-col gap-md">
          <div className="bg-surface p-lg rounded-xl border border-outline-variant/20 shadow-sm flex flex-col gap-md">
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
      </Tabs.Root>

      {/* JD Context + AI Tailoring */}
      <div className="border-t border-outline-variant/20 pt-lg flex flex-col gap-md">
        <p className="text-label-md text-on-surface-variant uppercase tracking-wider">JD Context</p>
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
        <SkillsDelta />
      </div>
    </div>
  );
}

"use client";
import { useState, useEffect } from "react";
import { DownloadSimple } from "@phosphor-icons/react";
import { useResumeStore } from "@/stores/resume-store";
import type { Profile, ProfileInput } from "@/lib/networking-client";
import type { CareerProfile } from "@/lib/career-profile-client";

interface Props {
  initial: Profile | null;
  careerProfile?: CareerProfile | null;
  onSave: (input: ProfileInput) => Promise<void>;
  isSaving: boolean;
  error: string | null;
}

const AVAILABLE_FOR_OPTIONS = [
  { value: "full-time", label: "Full-time" },
  { value: "contract", label: "Contract" },
  { value: "mentoring", label: "Mentoring" },
];

const EMPTY: ProfileInput = {
  display_name: "",
  headline: null,
  bio: null,
  location: null,
  skills: [],
  open_to_work: false,
  available_for: [],
  linkedin_url: null,
  github_url: null,
};

function parseSkills(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function ProfileForm({ initial, careerProfile, onSave, isSaving, error }: Props) {
  const resumeContent = useResumeStore((s) => s.content);
  const [form, setForm] = useState<ProfileInput>(
    initial ? { ...EMPTY, ...initial } : EMPTY
  );
  const [skillsText, setSkillsText] = useState(
    (initial?.skills ?? []).join(", ")
  );
  const [charCount, setCharCount] = useState((initial?.bio ?? "").length);

  useEffect(() => {
    if (initial) {
      setForm({ ...EMPTY, ...initial });
      setSkillsText(initial.skills.join(", "));
      setCharCount((initial.bio ?? "").length);
    }
  }, [initial]);

  function handleImportFromResume() {
    if (!resumeContent) return;
    const name = resumeContent.contact?.name ?? "";
    const skills = Array.isArray(resumeContent.skills)
      ? (resumeContent.skills as string[])
      : [];
    setForm((f) => ({
      ...f,
      display_name: name || f.display_name,
      skills,
    }));
    setSkillsText(skills.join(", "));
  }

  function handleImportFromCareerProfile() {
    if (!careerProfile) return;
    const skills = careerProfile.skills ?? [];
    setForm((f) => ({
      ...f,
      display_name: careerProfile.contact?.name || f.display_name,
      headline: careerProfile.headline || f.headline,
      location: careerProfile.contact?.location || f.location,
      linkedin_url: careerProfile.contact?.linkedin || f.linkedin_url,
      github_url: careerProfile.contact?.github || f.github_url,
      skills,
    }));
    setSkillsText(skills.join(", "));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSave({ ...form, skills: parseSkills(skillsText) });
  }

  const chips = parseSkills(skillsText);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-md">
      {/* Import from existing profile data */}
      {(careerProfile || resumeContent) && (
        <div className="flex flex-wrap gap-sm">
          {careerProfile && (
            <button
              type="button"
              onClick={handleImportFromCareerProfile}
              className="flex items-center gap-sm self-start px-md py-sm rounded-xl border border-outline-variant/40 text-label-sm text-primary hover:bg-surface-container transition-all"
            >
              <DownloadSimple size={16} />
              Import from Career Profile
            </button>
          )}
          {resumeContent && (
            <button
              type="button"
              onClick={handleImportFromResume}
              className="flex items-center gap-sm self-start px-md py-sm rounded-xl border border-outline-variant/40 text-label-sm text-primary hover:bg-surface-container transition-all"
            >
              <DownloadSimple size={16} />
              Import name &amp; skills from Resume
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
        {/* Display Name */}
        <div className="flex flex-col gap-xs">
          <label className="text-label-sm text-on-surface-variant">
            Display Name <span className="text-error">*</span>
          </label>
          <input
            type="text"
            value={form.display_name}
            onChange={(e) =>
              setForm((f) => ({ ...f, display_name: e.target.value }))
            }
            placeholder="Your full name"
            required
            className="w-full px-md py-sm bg-surface-container border border-outline-variant/40 rounded-xl text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary focus:border-primary placeholder:text-on-surface-variant/50 transition-all"
          />
        </div>

        {/* Headline */}
        <div className="flex flex-col gap-xs">
          <label className="text-label-sm text-on-surface-variant">
            Headline
          </label>
          <input
            type="text"
            value={form.headline ?? ""}
            onChange={(e) =>
              setForm((f) => ({ ...f, headline: e.target.value || null }))
            }
            placeholder="Senior SWE at Google"
            className="w-full px-md py-sm bg-surface-container border border-outline-variant/40 rounded-xl text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary focus:border-primary placeholder:text-on-surface-variant/50 transition-all"
          />
        </div>

        {/* Location */}
        <div className="flex flex-col gap-xs">
          <label className="text-label-sm text-on-surface-variant">
            Location
          </label>
          <input
            type="text"
            value={form.location ?? ""}
            onChange={(e) =>
              setForm((f) => ({ ...f, location: e.target.value || null }))
            }
            placeholder="San Francisco, CA"
            className="w-full px-md py-sm bg-surface-container border border-outline-variant/40 rounded-xl text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary focus:border-primary placeholder:text-on-surface-variant/50 transition-all"
          />
        </div>

        {/* LinkedIn */}
        <div className="flex flex-col gap-xs">
          <label className="text-label-sm text-on-surface-variant">
            LinkedIn URL
          </label>
          <input
            type="url"
            value={form.linkedin_url ?? ""}
            onChange={(e) =>
              setForm((f) => ({ ...f, linkedin_url: e.target.value || null }))
            }
            placeholder="https://linkedin.com/in/you"
            className="w-full px-md py-sm bg-surface-container border border-outline-variant/40 rounded-xl text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary focus:border-primary placeholder:text-on-surface-variant/50 transition-all"
          />
        </div>

        {/* GitHub */}
        <div className="flex flex-col gap-xs">
          <label className="text-label-sm text-on-surface-variant">
            GitHub URL
          </label>
          <input
            type="url"
            value={form.github_url ?? ""}
            onChange={(e) =>
              setForm((f) => ({ ...f, github_url: e.target.value || null }))
            }
            placeholder="https://github.com/you"
            className="w-full px-md py-sm bg-surface-container border border-outline-variant/40 rounded-xl text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary focus:border-primary placeholder:text-on-surface-variant/50 transition-all"
          />
        </div>
      </div>

      {/* Bio */}
      <div className="flex flex-col gap-xs">
        <label className="text-label-sm text-on-surface-variant flex justify-between">
          <span>Bio</span>
          <span
            className={
              charCount > 280
                ? "text-error"
                : "text-on-surface-variant/60"
            }
          >
            {charCount}/300
          </span>
        </label>
        <textarea
          value={form.bio ?? ""}
          onChange={(e) => {
            setForm((f) => ({ ...f, bio: e.target.value || null }));
            setCharCount(e.target.value.length);
          }}
          maxLength={300}
          rows={3}
          placeholder="Tell people about yourself…"
          className="w-full px-md py-sm bg-surface-container border border-outline-variant/40 rounded-xl text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary focus:border-primary placeholder:text-on-surface-variant/50 resize-none transition-all"
        />
      </div>

      {/* Skills */}
      <div className="flex flex-col gap-xs">
        <label className="text-label-sm text-on-surface-variant">
          Skills <span className="font-normal">(comma-separated)</span>
        </label>
        <input
          value={skillsText}
          onChange={(e) => setSkillsText(e.target.value)}
          placeholder="React, TypeScript, Python…"
          className="w-full px-md py-sm bg-surface-container border border-outline-variant/40 rounded-xl text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary focus:border-primary placeholder:text-on-surface-variant/50 transition-all"
        />
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-xs mt-xs">
            {chips.map((s) => (
              <span
                key={s}
                className="px-sm py-xs rounded-full bg-secondary-container text-primary text-caption"
              >
                {s}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Open to Work toggle */}
      <label className="flex items-center gap-md cursor-pointer select-none">
        <div
          role="switch"
          aria-checked={form.open_to_work}
          onClick={() =>
            setForm((f) => ({ ...f, open_to_work: !f.open_to_work }))
          }
          className={`w-10 h-6 rounded-full transition-colors duration-200 flex items-center px-xs cursor-pointer ${
            form.open_to_work ? "bg-primary" : "bg-surface-variant"
          }`}
        >
          <div
            className={`w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
              form.open_to_work ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </div>
        <span className="text-label-md text-on-surface">Open to Work</span>
      </label>

      {/* Available For */}
      <div className="flex flex-col gap-xs">
        <span className="text-label-sm text-on-surface-variant">
          Available For
        </span>
        <div className="flex gap-sm flex-wrap">
          {AVAILABLE_FOR_OPTIONS.map(({ value, label }) => {
            const checked = form.available_for.includes(value);
            return (
              <button
                key={value}
                type="button"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    available_for: checked
                      ? f.available_for.filter((v) => v !== value)
                      : [...f.available_for, value],
                  }))
                }
                className={`px-md py-sm rounded-xl text-label-sm transition-all border ${
                  checked
                    ? "bg-secondary-container text-primary border-primary/20 font-bold"
                    : "border-outline-variant/40 text-on-surface-variant hover:bg-surface-container"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {error && <p className="text-body-sm text-error">{error}</p>}

      <button
        type="submit"
        disabled={isSaving || !form.display_name.trim()}
        className="w-full py-md rounded-xl text-label-md text-on-primary bg-primary shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
      >
        {isSaving ? "Saving…" : "Save Profile"}
      </button>
    </form>
  );
}

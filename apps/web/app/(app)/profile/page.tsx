"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  User,
  Briefcase,
  GraduationCap,
  Certificate,
  Wrench,
  UploadSimple,
  Plus,
  CaretDown,
  X,
  FloppyDisk,
  FilePdf,
  FileDoc,
  CheckCircle,
  Spinner,
  LinkedinLogo,
  GithubLogo,
  Globe,
  Phone,
  EnvelopeSimple,
  MapPin,
} from "@phosphor-icons/react";
import {
  getCareerProfile,
  upsertCareerProfile,
  setProfileMasterResume,
  type CareerProfile,
  type ContactInfo,
  type ExperienceEntry,
  type EducationEntry,
  type CertEntry,
  type ExpType,
  type RoleStatus,
} from "@/lib/career-profile-client";
import { apiClient } from "@/lib/api-client";

// ── helpers ───────────────────────────────────────────────────────────────────
const newId = () => crypto.randomUUID();

const emptyContact = (): ContactInfo => ({
  name: "", email: "", phone: "", location: "", linkedin: "", github: "", website: "",
});

const emptyExp = (): ExperienceEntry => ({
  id: newId(), type: "full-time", company: "", title: "",
  start: "", end: "", current: false,
  responsibilities: "", achievements: "", projects: "", impact: "",
});

const emptyEdu = (): EducationEntry => ({
  id: newId(), institution: "", degree: "", field: "", year: "", gpa: "", honors: "",
});

const emptyCert = (): CertEntry => ({ id: newId(), name: "", issuer: "", year: "" });

// ── Section header ─────────────────────────────────────────────────────────────
function SectionHeader({ icon: Icon, title, onAdd, addLabel }: {
  icon: React.ElementType; title: string; onAdd?: () => void; addLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between mb-md">
      <h2 className="text-headline-md text-on-surface font-semibold flex items-center gap-sm">
        <Icon size={22} className="text-primary" />
        {title}
      </h2>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-xs px-md py-sm rounded-xl text-label-sm text-primary border border-primary/30 hover:bg-primary/5 transition-all"
        >
          <Plus size={14} weight="bold" /> {addLabel ?? "Add"}
        </button>
      )}
    </div>
  );
}

// ── Input / Textarea helpers ───────────────────────────────────────────────────
const inputCls = "w-full px-md py-sm bg-surface-container border border-outline-variant/40 rounded-xl text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary focus:border-primary placeholder:text-on-surface-variant/50 transition-all";
const textareaCls = `${inputCls} resize-none`;

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // ── form state ─────────────────────────────────────────────────────────────
  const [contact, setContact] = useState<ContactInfo>(emptyContact());
  const [roleStatus, setRoleStatus] = useState<RoleStatus | "">("");
  const [headline, setHeadline] = useState("");
  const [skills, setSkills] = useState("");
  const [experiences, setExperiences] = useState<ExperienceEntry[]>([]);
  const [education, setEducation] = useState<EducationEntry[]>([]);
  const [certifications, setCertifications] = useState<CertEntry[]>([]);
  const [masterResumeId, setMasterResumeId] = useState<string | null>(null);
  const [masterResumeTitle, setMasterResumeTitle] = useState<string | null>(null);

  // collapsed state per entry
  const [collapsedExp, setCollapsedExp] = useState<Record<string, boolean>>({});
  const [collapsedEdu, setCollapsedEdu] = useState<Record<string, boolean>>({});
  const [collapsedCert, setCollapsedCert] = useState<Record<string, boolean>>({});

  // ── load profile on mount ──────────────────────────────────────────────────
  useEffect(() => {
    getCareerProfile().then(profile => {
      if (profile) hydrate(profile);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  function hydrate(profile: CareerProfile) {
    setContact({ ...emptyContact(), ...profile.contact });
    setRoleStatus(profile.role_status ?? "");
    setHeadline(profile.headline ?? "");
    setSkills(profile.skills.join(", "));
    setExperiences(profile.experience);
    setEducation(profile.education);
    setCertifications(profile.certifications);
    setMasterResumeId(profile.master_resume_id);
  }

  // ── load master resume title ───────────────────────────────────────────────
  useEffect(() => {
    if (!masterResumeId) { setMasterResumeTitle(null); return; }
    apiClient.getResume(masterResumeId).then(r => setMasterResumeTitle(r.title)).catch(() => setMasterResumeTitle(null));
  }, [masterResumeId]);

  // ── save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true); setError(null); setSaveOk(false);
    try {
      const skillArr = skills.split(",").map(s => s.trim()).filter(Boolean);
      await upsertCareerProfile({
        master_resume_id: masterResumeId,
        contact,
        headline: headline || null,
        experience: experiences,
        education,
        skills: skillArr,
        certifications,
        role_status: roleStatus || null,
      });
      // Invalidate resumes cache so Resume Builder sees the latest, and
      // careerProfile so JD Analyzer / Networking pick up the change too
      // instead of showing stale data until a hard refresh.
      await queryClient.invalidateQueries({ queryKey: ["resumes"] });
      await queryClient.invalidateQueries({ queryKey: ["careerProfile"] });
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // ── resume upload ──────────────────────────────────────────────────────────
  const acceptFile = useCallback((f: File) => {
    if (!f.name.match(/\.(pdf|docx|doc)$/i)) {
      setError("Only PDF or DOCX files are supported."); return;
    }
    if (f.size > 10 * 1024 * 1024) { setError("File must be under 10 MB."); return; }
    handleUpload(f);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUpload(file: File) {
    setUploading(true); setError(null);
    try {
      const resume = await apiClient.parseResumeFile(file, "ats_clean");
      // Populate form from parsed resume content
      const c = resume.content;
      setContact(prev => ({
        ...prev,
        name: (c.contact?.name as string) || prev.name,
        email: (c.contact?.email as string) || prev.email,
        phone: (c.contact?.phone as string) || prev.phone || "",
        location: (c.contact?.location as string) || prev.location || "",
        linkedin: (c.contact?.linkedin as string) || prev.linkedin || "",
        github: (c.contact?.github as string) || prev.github || "",
      }));
      if (c.headline) setHeadline(c.headline as string);
      if (Array.isArray(c.skills) && c.skills.length) setSkills((c.skills as string[]).join(", "));
      if (Array.isArray(c.experience) && c.experience.length) {
        setExperiences((c.experience as Array<{company:string;title:string;start:string;end?:string;bullets?:string[]}>).map(e => ({
          id: newId(), type: "full-time" as ExpType,
          company: e.company, title: e.title,
          start: e.start, end: e.end || "Present",
          current: !e.end || e.end === "Present",
          responsibilities: (e.bullets ?? []).join("; "),
          achievements: "", projects: "", impact: "",
        })));
      }
      if (Array.isArray(c.education) && c.education.length) {
        setEducation((c.education as Array<{institution:string;degree:string;year:string}>).map(e => ({
          id: newId(), institution: e.institution, degree: e.degree,
          field: "", year: e.year, gpa: "", honors: "",
        })));
      }
      if (Array.isArray(c.certifications) && c.certifications.length) {
        setCertifications((c.certifications as string[]).map(name => ({
          id: newId(), name, issuer: "", year: "",
        })));
      }
      setMasterResumeId(resume.id);
      await setProfileMasterResume(resume.id);
      await queryClient.invalidateQueries({ queryKey: ["resumes"] });
      await queryClient.invalidateQueries({ queryKey: ["careerProfile"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // ── experience helpers ─────────────────────────────────────────────────────
  const updateExp = (id: string, field: keyof ExperienceEntry, value: string | ExpType | boolean) =>
    setExperiences(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  const removeExp = (id: string) => setExperiences(prev => prev.filter(e => e.id !== id));
  const addExp = () => {
    const e = emptyExp();
    setExperiences(prev => [...prev, e]);
    setCollapsedExp(prev => ({ ...prev, [e.id]: false }));
  };

  // ── education helpers ──────────────────────────────────────────────────────
  const updateEdu = (id: string, field: keyof EducationEntry, value: string) =>
    setEducation(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  const removeEdu = (id: string) => setEducation(prev => prev.filter(e => e.id !== id));
  const addEdu = () => {
    const e = emptyEdu();
    setEducation(prev => [...prev, e]);
    setCollapsedEdu(prev => ({ ...prev, [e.id]: false }));
  };

  // ── cert helpers ───────────────────────────────────────────────────────────
  const updateCert = (id: string, field: keyof CertEntry, value: string) =>
    setCertifications(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
  const removeCert = (id: string) => setCertifications(prev => prev.filter(c => c.id !== id));
  const addCert = () => {
    const c = emptyCert();
    setCertifications(prev => [...prev, c]);
    setCollapsedCert(prev => ({ ...prev, [c.id]: false }));
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  const skillChips = skills.split(",").map(s => s.trim()).filter(Boolean);

  return (
    <div className="max-w-3xl mx-auto p-gutter pb-xxl flex flex-col gap-xl">
      {/* Page header */}
      <div className="flex items-center justify-between pt-xl">
        <div>
          <h1 className="text-headline-xl text-on-surface font-bold" style={{ letterSpacing: "-0.02em" }}>
            My Profile
          </h1>
          <p className="text-body-md text-on-surface-variant mt-xs">
            Source of truth for your career — used by JD Analyzer, Resume Builder, and Networking.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-sm px-xl py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
        >
          {saving ? <Spinner size={18} className="animate-spin" /> : saveOk ? <CheckCircle size={18} weight="fill" /> : <FloppyDisk size={18} />}
          {saving ? "Saving…" : saveOk ? "Saved!" : "Save Profile"}
        </button>
      </div>

      {error && (
        <div className="bg-error-container/30 border border-error/30 rounded-xl px-lg py-md text-body-sm text-error">
          {error}
        </div>
      )}

      {/* ── Resume upload ─────────────────────────────────────────────────── */}
      <section className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
        <SectionHeader icon={UploadSimple} title="Resume" />
        <input ref={fileRef} type="file" accept=".pdf,.docx,.doc" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) acceptFile(f); }} />

        {masterResumeId && masterResumeTitle ? (
          <div className="flex items-center gap-md p-md rounded-xl bg-primary/5 border border-primary/20 mb-md">
            <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
              <FileDoc size={20} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-label-md text-on-surface font-semibold truncate">{masterResumeTitle}</p>
              <p className="text-caption text-on-surface-variant">Active resume · fields auto-populated from this file</p>
            </div>
            <button onClick={() => fileRef.current?.click()}
              className="shrink-0 text-label-sm text-primary hover:underline">
              Replace
            </button>
          </div>
        ) : null}

        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) acceptFile(f); }}
          onClick={() => fileRef.current?.click()}
          className={`rounded-xl border-2 border-dashed p-lg flex items-center gap-lg cursor-pointer transition-all ${
            dragging ? "border-primary bg-primary/5" : "border-outline-variant/40 hover:border-primary/40 hover:bg-surface-container/30"
          }`}
        >
          {uploading ? (
            <Spinner size={28} className="text-primary animate-spin" />
          ) : (
            <UploadSimple size={28} className={dragging ? "text-primary" : "text-on-surface-variant/50"} />
          )}
          <div className="flex-1">
            <p className="text-label-md text-on-surface font-semibold">
              {uploading ? "Parsing resume…" : dragging ? "Release to upload" : masterResumeId ? "Upload a new resume" : "Upload your resume"}
            </p>
            <p className="text-caption text-on-surface-variant mt-xs">
              PDF or DOCX · AI extracts contact, experience, education, and skills automatically
            </p>
          </div>
          <span className="shrink-0 text-label-sm text-primary border border-primary/30 rounded-lg px-md py-sm hover:bg-primary/5 transition-all">
            Browse
          </span>
        </div>
      </section>

      {/* ── Contact information ───────────────────────────────────────────── */}
      <section className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
        <SectionHeader icon={User} title="Contact Information" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
          <div className="flex flex-col gap-xs">
            <label className="text-label-sm text-on-surface-variant flex items-center gap-xs"><User size={14} /> Full Name</label>
            <input value={contact.name} onChange={e => setContact(p => ({ ...p, name: e.target.value }))}
              placeholder="Jane Smith" className={inputCls} />
          </div>
          <div className="flex flex-col gap-xs">
            <label className="text-label-sm text-on-surface-variant flex items-center gap-xs"><EnvelopeSimple size={14} /> Email</label>
            <input type="email" value={contact.email} onChange={e => setContact(p => ({ ...p, email: e.target.value }))}
              placeholder="jane@example.com" className={inputCls} />
          </div>
          <div className="flex flex-col gap-xs">
            <label className="text-label-sm text-on-surface-variant flex items-center gap-xs"><Phone size={14} /> Phone</label>
            <input value={contact.phone ?? ""} onChange={e => setContact(p => ({ ...p, phone: e.target.value }))}
              placeholder="+1 (555) 000-0000" className={inputCls} />
          </div>
          <div className="flex flex-col gap-xs">
            <label className="text-label-sm text-on-surface-variant flex items-center gap-xs"><MapPin size={14} /> Location</label>
            <input value={contact.location ?? ""} onChange={e => setContact(p => ({ ...p, location: e.target.value }))}
              placeholder="San Francisco, CA" className={inputCls} />
          </div>
          <div className="flex flex-col gap-xs">
            <label className="text-label-sm text-on-surface-variant flex items-center gap-xs"><Briefcase size={14} /> Job Role</label>
            <select value={roleStatus} onChange={e => setRoleStatus(e.target.value as RoleStatus | "")}
              className={inputCls}>
              <option value="">Select…</option>
              <option value="working">Working Professional</option>
              <option value="student">Student</option>
            </select>
          </div>
          <div className="flex flex-col gap-xs md:col-span-2">
            <label className="text-label-sm text-on-surface-variant">Headline / Title</label>
            <input value={headline} onChange={e => setHeadline(e.target.value)}
              placeholder="Senior Software Engineer · Open to Work" className={inputCls} />
          </div>
          <div className="flex flex-col gap-xs">
            <label className="text-label-sm text-on-surface-variant flex items-center gap-xs"><LinkedinLogo size={14} /> LinkedIn</label>
            <input type="url" value={contact.linkedin ?? ""} onChange={e => setContact(p => ({ ...p, linkedin: e.target.value }))}
              placeholder="https://linkedin.com/in/you" className={inputCls} />
          </div>
          <div className="flex flex-col gap-xs">
            <label className="text-label-sm text-on-surface-variant flex items-center gap-xs"><GithubLogo size={14} /> GitHub</label>
            <input type="url" value={contact.github ?? ""} onChange={e => setContact(p => ({ ...p, github: e.target.value }))}
              placeholder="https://github.com/you" className={inputCls} />
          </div>
          <div className="flex flex-col gap-xs md:col-span-2">
            <label className="text-label-sm text-on-surface-variant flex items-center gap-xs"><Globe size={14} /> Website / Portfolio</label>
            <input type="url" value={contact.website ?? ""} onChange={e => setContact(p => ({ ...p, website: e.target.value }))}
              placeholder="https://yoursite.com" className={inputCls} />
          </div>
        </div>
      </section>

      {/* ── Skills ──────────────────────────────────────────────────────────── */}
      <section className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
        <SectionHeader icon={Wrench} title="Skills" />
        <div className="flex flex-col gap-sm">
          <input value={skills} onChange={e => setSkills(e.target.value)}
            placeholder="React, TypeScript, Python, AWS, Docker, Figma…"
            className={inputCls} />
          {skillChips.length > 0 && (
            <div className="flex flex-wrap gap-xs">
              {skillChips.map(s => (
                <span key={s} className="px-sm py-xs bg-secondary-container text-primary text-caption rounded-full font-medium">
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Experience ─────────────────────────────────────────────────────── */}
      <section className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
        <SectionHeader icon={Briefcase} title="Experience" onAdd={addExp} addLabel="Add Experience" />
        {experiences.length === 0 ? (
          <button type="button" onClick={addExp}
            className="w-full py-xl flex flex-col items-center gap-sm rounded-xl border-2 border-dashed border-outline-variant/40 hover:border-primary/40 hover:bg-surface-container/30 transition-all text-on-surface-variant/60 hover:text-primary">
            <Plus size={24} weight="bold" />
            <span className="text-label-sm">Add your first experience</span>
          </button>
        ) : (
          <div className="flex flex-col gap-sm">
            {experiences.map((exp, idx) => {
              const collapsed = collapsedExp[exp.id] ?? false;
              return (
                <div key={exp.id} className="rounded-xl border border-outline-variant/30 overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center gap-sm px-md py-sm bg-surface-container">
                    <div className="flex rounded-lg overflow-hidden border border-outline-variant/30 shrink-0 text-caption">
                      {(["full-time", "internship"] as const).map(t => (
                        <button key={t} type="button" onClick={() => updateExp(exp.id, "type", t)}
                          className={`px-sm py-xs font-medium transition-colors ${
                            exp.type === t
                              ? t === "internship" ? "bg-secondary-container text-primary" : "bg-primary text-on-primary"
                              : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high"
                          }`}>
                          {t === "full-time" ? "Full-time" : "Internship"}
                        </button>
                      ))}
                    </div>
                    <span className="text-caption text-on-surface-variant shrink-0">#{idx + 1}</span>
                    {exp.company && <span className="text-label-sm text-on-surface font-semibold truncate flex-1">{exp.company}{exp.title ? ` · ${exp.title}` : ""}</span>}
                    <div className="flex items-center gap-xs ml-auto shrink-0">
                      <button type="button" onClick={() => setCollapsedExp(p => ({ ...p, [exp.id]: !collapsed }))}
                        className="p-xs rounded text-on-surface-variant hover:text-primary transition-colors">
                        <CaretDown size={14} className={`transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`} />
                      </button>
                      <button type="button" onClick={() => removeExp(exp.id)}
                        className="p-xs rounded text-on-surface-variant hover:text-error transition-colors">
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  {/* Fields */}
                  {!collapsed && (
                    <div className="p-md flex flex-col gap-sm bg-surface-container-lowest">
                      <div className="grid grid-cols-2 gap-sm">
                        <div className="flex flex-col gap-xs">
                          <label className="text-caption text-on-surface-variant">Company *</label>
                          <input value={exp.company} onChange={e => updateExp(exp.id, "company", e.target.value)}
                            placeholder="Google" className={inputCls} />
                        </div>
                        <div className="flex flex-col gap-xs">
                          <label className="text-caption text-on-surface-variant">Role / Title *</label>
                          <input value={exp.title} onChange={e => updateExp(exp.id, "title", e.target.value)}
                            placeholder="Software Engineer" className={inputCls} />
                        </div>
                        <div className="flex flex-col gap-xs">
                          <div className="flex items-center h-[18px]">
                            <label className="text-caption text-on-surface-variant">Start</label>
                          </div>
                          <input value={exp.start} onChange={e => updateExp(exp.id, "start", e.target.value)}
                            placeholder="Jan 2022" className={inputCls} />
                        </div>
                        <div className="flex flex-col gap-xs">
                          <div className="flex items-center gap-sm h-[18px]">
                            <label className="text-caption text-on-surface-variant">End</label>
                            {/* Currently working toggle — sits right after the label */}
                            <div
                              role="switch"
                              aria-checked={exp.current}
                              onClick={() => {
                                updateExp(exp.id, "current", !exp.current);
                                if (!exp.current) updateExp(exp.id, "end", "Present");
                              }}
                              className={`w-8 h-[18px] rounded-full flex items-center px-[3px] cursor-pointer transition-colors duration-200 shrink-0 ${exp.current ? "bg-primary" : "bg-surface-variant"}`}
                            >
                              <div className={`w-3 h-3 rounded-full bg-white shadow transition-transform duration-200 ${exp.current ? "translate-x-[14px]" : "translate-x-0"}`} />
                            </div>
                            <span className="text-caption text-on-surface-variant">Current</span>
                          </div>
                          <input
                            value={exp.current ? "Present" : exp.end}
                            onChange={e => updateExp(exp.id, "end", e.target.value)}
                            disabled={exp.current}
                            placeholder="Dec 2023"
                            className={`${inputCls} ${exp.current ? "opacity-40 cursor-not-allowed bg-surface-container-high" : ""}`}
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-xs">
                        <label className="text-caption text-on-surface-variant">Responsibilities & Roles</label>
                        <textarea value={exp.responsibilities} onChange={e => updateExp(exp.id, "responsibilities", e.target.value)}
                          rows={2} placeholder="Led backend API development, mentored junior engineers…" className={textareaCls} />
                      </div>
                      <div className="flex flex-col gap-xs">
                        <label className="text-caption text-on-surface-variant">Achievements</label>
                        <textarea value={exp.achievements} onChange={e => updateExp(exp.id, "achievements", e.target.value)}
                          rows={2} placeholder="Reduced API latency by 40%, shipped 3 major features…" className={textareaCls} />
                      </div>
                      <div className="grid grid-cols-2 gap-sm">
                        <div className="flex flex-col gap-xs">
                          <label className="text-caption text-on-surface-variant">Projects completed</label>
                          <textarea value={exp.projects} onChange={e => updateExp(exp.id, "projects", e.target.value)}
                            rows={2} placeholder="Payment gateway v2, Search re-index…" className={textareaCls} />
                        </div>
                        <div className="flex flex-col gap-xs">
                          <label className="text-caption text-on-surface-variant">Impact</label>
                          <textarea value={exp.impact} onChange={e => updateExp(exp.id, "impact", e.target.value)}
                            rows={2} placeholder="Saved $200k/yr, improved NPS by 15pts…" className={textareaCls} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Education ──────────────────────────────────────────────────────── */}
      <section className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
        <SectionHeader icon={GraduationCap} title="Education" onAdd={addEdu} addLabel="Add Education" />
        {education.length === 0 ? (
          <button type="button" onClick={addEdu}
            className="w-full py-xl flex flex-col items-center gap-sm rounded-xl border-2 border-dashed border-outline-variant/40 hover:border-primary/40 hover:bg-surface-container/30 transition-all text-on-surface-variant/60 hover:text-primary">
            <Plus size={24} weight="bold" />
            <span className="text-label-sm">Add education history</span>
          </button>
        ) : (
          <div className="flex flex-col gap-sm">
            {education.map((edu, idx) => {
              const collapsed = collapsedEdu[edu.id] ?? false;
              return (
                <div key={edu.id} className="rounded-xl border border-outline-variant/30 overflow-hidden">
                  <div className="flex items-center gap-sm px-md py-sm bg-surface-container">
                    <span className="text-caption text-on-surface-variant shrink-0">#{idx + 1}</span>
                    {edu.institution && (
                      <span className="text-label-sm text-on-surface font-semibold truncate flex-1">
                        {edu.institution}{edu.degree ? ` · ${edu.degree}` : ""}
                      </span>
                    )}
                    <div className="flex items-center gap-xs ml-auto shrink-0">
                      <button type="button" onClick={() => setCollapsedEdu(p => ({ ...p, [edu.id]: !collapsed }))}
                        className="p-xs rounded text-on-surface-variant hover:text-primary transition-colors">
                        <CaretDown size={14} className={`transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`} />
                      </button>
                      <button type="button" onClick={() => removeEdu(edu.id)}
                        className="p-xs rounded text-on-surface-variant hover:text-error transition-colors">
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  {!collapsed && (
                    <div className="p-md grid grid-cols-2 gap-sm bg-surface-container-lowest">
                      <div className="flex flex-col gap-xs col-span-2">
                        <label className="text-caption text-on-surface-variant">Institution *</label>
                        <input value={edu.institution} onChange={e => updateEdu(edu.id, "institution", e.target.value)}
                          placeholder="Stanford University" className={inputCls} />
                      </div>
                      <div className="flex flex-col gap-xs">
                        <label className="text-caption text-on-surface-variant">Degree</label>
                        <input value={edu.degree} onChange={e => updateEdu(edu.id, "degree", e.target.value)}
                          placeholder="B.S. / M.S. / Ph.D." className={inputCls} />
                      </div>
                      <div className="flex flex-col gap-xs">
                        <label className="text-caption text-on-surface-variant">Field of Study</label>
                        <input value={edu.field} onChange={e => updateEdu(edu.id, "field", e.target.value)}
                          placeholder="Computer Science" className={inputCls} />
                      </div>
                      <div className="flex flex-col gap-xs">
                        <label className="text-caption text-on-surface-variant">Graduation Year</label>
                        <input value={edu.year} onChange={e => updateEdu(edu.id, "year", e.target.value)}
                          placeholder="2020" className={inputCls} />
                      </div>
                      <div className="flex flex-col gap-xs">
                        <label className="text-caption text-on-surface-variant">GPA (optional)</label>
                        <input value={edu.gpa ?? ""} onChange={e => updateEdu(edu.id, "gpa", e.target.value)}
                          placeholder="3.8 / 4.0" className={inputCls} />
                      </div>
                      <div className="flex flex-col gap-xs col-span-2">
                        <label className="text-caption text-on-surface-variant">Honors / Activities (optional)</label>
                        <input value={edu.honors ?? ""} onChange={e => updateEdu(edu.id, "honors", e.target.value)}
                          placeholder="Magna Cum Laude, Dean's List, Hackathon winner…" className={inputCls} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Certifications ─────────────────────────────────────────────────── */}
      <section className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
        <SectionHeader icon={Certificate} title="Certifications" onAdd={addCert} addLabel="Add Certification" />
        {certifications.length === 0 ? (
          <button type="button" onClick={addCert}
            className="w-full py-xl flex flex-col items-center gap-sm rounded-xl border-2 border-dashed border-outline-variant/40 hover:border-primary/40 hover:bg-surface-container/30 transition-all text-on-surface-variant/60 hover:text-primary">
            <Plus size={24} weight="bold" />
            <span className="text-label-sm">Add a certification</span>
          </button>
        ) : (
          <div className="flex flex-col gap-sm">
            {certifications.map((cert, idx) => {
              const collapsed = collapsedCert[cert.id] ?? false;
              return (
                <div key={cert.id} className="rounded-xl border border-outline-variant/30 overflow-hidden">
                  <div className="flex items-center gap-sm px-md py-sm bg-surface-container">
                    <span className="text-caption text-on-surface-variant shrink-0">#{idx + 1}</span>
                    {cert.name && <span className="text-label-sm text-on-surface font-semibold truncate flex-1">{cert.name}{cert.issuer ? ` · ${cert.issuer}` : ""}</span>}
                    <div className="flex items-center gap-xs ml-auto shrink-0">
                      <button type="button" onClick={() => setCollapsedCert(p => ({ ...p, [cert.id]: !collapsed }))}
                        className="p-xs rounded text-on-surface-variant hover:text-primary transition-colors">
                        <CaretDown size={14} className={`transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`} />
                      </button>
                      <button type="button" onClick={() => removeCert(cert.id)}
                        className="p-xs rounded text-on-surface-variant hover:text-error transition-colors">
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  {!collapsed && (
                    <div className="p-md grid grid-cols-3 gap-sm bg-surface-container-lowest">
                      <div className="flex flex-col gap-xs col-span-3 md:col-span-1">
                        <label className="text-caption text-on-surface-variant">Certification Name *</label>
                        <input value={cert.name} onChange={e => updateCert(cert.id, "name", e.target.value)}
                          placeholder="AWS Solutions Architect" className={inputCls} />
                      </div>
                      <div className="flex flex-col gap-xs col-span-2 md:col-span-1">
                        <label className="text-caption text-on-surface-variant">Issuing Organisation</label>
                        <input value={cert.issuer} onChange={e => updateCert(cert.id, "issuer", e.target.value)}
                          placeholder="Amazon Web Services" className={inputCls} />
                      </div>
                      <div className="flex flex-col gap-xs col-span-1">
                        <label className="text-caption text-on-surface-variant">Year</label>
                        <input value={cert.year} onChange={e => updateCert(cert.id, "year", e.target.value)}
                          placeholder="2023" className={inputCls} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Floating save */}
      <div className="fixed bottom-xl right-gutter z-50">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-sm px-xl py-md rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-xl shadow-primary/30 hover:shadow-2xl hover:scale-[0.98] active:scale-95 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
        >
          {saving ? <Spinner size={18} className="animate-spin" /> : saveOk ? <CheckCircle size={18} weight="fill" /> : <FloppyDisk size={18} />}
          {saving ? "Saving…" : saveOk ? "Saved!" : "Save Profile"}
        </button>
      </div>
    </div>
  );
}

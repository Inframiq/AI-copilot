"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  User,
  Briefcase,
  UploadSimple,
  Plus,
  CaretDown,
  ArrowUp,
  ArrowDown,
  X,
  FloppyDisk,
  FilePdf,
  CheckCircle,
  Spinner,
  LinkedinLogo,
  GithubLogo,
  Globe,
  Phone,
  EnvelopeSimple,
  MapPin,
  Eye,
  ArrowSquareOut,
  Buildings,
  MagnifyingGlass,
  Code,
  Certificate,
  PencilSimple,
  Trash,
  Link as LinkIcon,
} from "@phosphor-icons/react";
import {
  getCareerProfile,
  upsertCareerProfile,
  inferExpType,
  sameCompany,
  formatRoleDuration,
  formatCompanyTotalDuration,
  blankExperienceEntry,
  insertRoleAfter,
  moveExperience,
  type CareerProfile,
  type CareerProfileInput,
  type ContactInfo,
  type ExperienceEntry,
  type ProjectEntry,
  type EducationEntry,
  type CertEntry,
  type ExpType,
  type RoleStatus,
} from "@/lib/career-profile-client";
import { apiClient, ApiError } from "@/lib/api-client";
import { useRouter } from "next/navigation";
import { ResumePreviewModal } from "@/components/resume/ResumePreviewModal";
import { ProfilePhotoCard } from "@/components/profile/ProfilePhotoCard";
import { uploadProfilePhoto } from "@/lib/photo-upload";

// ── helpers ───────────────────────────────────────────────────────────────────
const newId = () => crypto.randomUUID();

const emptyContact = (): ContactInfo => ({
  name: "", email: "", phone: "", location: "", linkedin: "", github: "", website: "",
});

const emptyExp = (): ExperienceEntry => blankExperienceEntry();

const emptyEdu = (): EducationEntry => ({
  id: newId(), institution: "", degree: "", field: "", year: "", gpa: "", honors: "",
});

const emptyCert = (): CertEntry => ({ id: newId(), name: "", issuer: "", year: "" });

const emptyProject = (): ProjectEntry => ({
  id: newId(), name: "", techStack: "", link: "", start: "", end: "", description: "",
});

// ── Section header ─────────────────────────────────────────────────────────────
function SectionHeader({ title, onAdd, addLabel }: {
  title: string; onAdd?: () => void; addLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between mb-lg">
      <h2 className="text-headline-md text-on-surface font-bold tracking-tight">
        {title}
      </h2>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-xs px-md py-xs rounded-full text-label-sm font-semibold text-primary bg-primary/5 hover:bg-primary/10 transition-all"
        >
          <Plus size={14} weight="bold" /> {addLabel ?? "Add"}
        </button>
      )}
    </div>
  );
}

// ── Card shell ────────────────────────────────────────────────────────────────
const cardCls = "bg-surface-container-lowest/80 backdrop-blur-xl rounded-2xl p-lg border border-outline-variant/30 shadow-lg shadow-primary/5";

// ── Input / Textarea helpers ───────────────────────────────────────────────────
const inputCls = "w-full px-md py-sm bg-surface-container-lowest/80 border border-outline-variant/40 rounded-xl text-body-sm text-on-surface outline-none transition-all placeholder:text-on-surface-variant/50 hover:border-outline-variant focus:border-primary focus:ring-2 focus:ring-primary/15 focus:bg-surface-container-lowest";
const textareaCls = `${inputCls} resize-none`;
const fieldLabelCls = "text-label-sm text-on-surface-variant/90 flex items-center gap-xs font-semibold tracking-wide";

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const queryClient = useQueryClient();
  const router = useRouter();
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
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [skills, setSkills] = useState<string[]>([]);
  const [skillDraft, setSkillDraft] = useState("");
  const [experiences, setExperiences] = useState<ExperienceEntry[]>([]);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [education, setEducation] = useState<EducationEntry[]>([]);
  const [certifications, setCertifications] = useState<CertEntry[]>([]);
  const [masterResumeId, setMasterResumeId] = useState<string | null>(null);
  const [masterResumeTitle, setMasterResumeTitle] = useState<string | null>(null);
  const [masterResumeTemplateId, setMasterResumeTemplateId] = useState<string>("ats_clean");
  // True when master_resume_id points at a resume that's since been deleted
  // (e.g. via the Resume Builder's delete button) — distinct from simply
  // never having uploaded one, so the UI can say what actually happened
  // instead of silently reverting to the same empty upload prompt.
  const [masterResumeDeleted, setMasterResumeDeleted] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // collapsed state per entry
  const [collapsedExp, setCollapsedExp] = useState<Record<string, boolean>>({});
  const [collapsedProj, setCollapsedProj] = useState<Record<string, boolean>>({});
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
    setSkills(profile.skills);
    setExperiences(profile.experience);
    setProjects(profile.projects ?? []);
    setEducation(profile.education);
    setCertifications(profile.certifications);
    setMasterResumeId(profile.master_resume_id);
    setPhotoUrl(profile.photo_url ?? null);
    setPhotoPath(profile.photo_path ?? null);
  }

  // ── load master resume title ───────────────────────────────────────────────
  useEffect(() => {
    if (!masterResumeId) { setMasterResumeTitle(null); setMasterResumeDeleted(false); return; }
    setMasterResumeDeleted(false);
    apiClient.getResume(masterResumeId)
      .then(r => { setMasterResumeTitle(r.title); setMasterResumeTemplateId(r.template_id); })
      .catch(err => {
        setMasterResumeTitle(null);
        // A 404 means the resume this profile pointed at was deleted —
        // surface that distinctly rather than looking like "never uploaded."
        setMasterResumeDeleted(err instanceof ApiError && err.status === 404);
      });
  }, [masterResumeId]);

  // ── save-on-leave ────────────────────────────────────────────────────────
  // A resume upload fills the form but no longer auto-saves (see handleUpload)
  // so the user can review AI-extracted fields before they're persisted. If
  // they navigate away without hitting "Save Profile" explicitly, save for
  // them anyway — but only when the form is in a valid state, so leaving
  // mid-edit with e.g. no name entered doesn't silently persist junk.
  // Refs (not the effect's dependency array) carry the latest state into the
  // unmount cleanup, since that effect only runs once on mount.
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;
  const isValidRef = useRef(false);
  isValidRef.current = contact.name.trim().length > 0;

  useEffect(() => {
    return () => {
      if (isValidRef.current) handleSaveRef.current();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── save ───────────────────────────────────────────────────────────────────
  async function handleSave(): Promise<boolean> {
    setSaving(true); setError(null); setSaveOk(false);
    try {
      const profileInput: CareerProfileInput = {
        master_resume_id: masterResumeId,
        contact,
        headline: headline || null,
        experience: experiences,
        projects,
        education,
        skills,
        certifications,
        role_status: roleStatus || null,
        photo_url: photoUrl,
        photo_path: photoPath,
      };
      await upsertCareerProfile(profileInput);
      // Deliberately NOT syncing this back into the resume's stored content:
      // profileToResumeContent reconstructs bullets from the profile form's
      // split Responsibilities/Achievements/Projects/Impact fields, which
      // mangles the resume's real bullets into labeled text blobs. The
      // resume (resume.content, edited in Studio) and the career profile
      // (this page, used by JD Analyzer/tailoring) are intentionally
      // separate — Preview/Open must show the resume exactly as stored.
      // Invalidate resumes cache so Resume Builder sees the latest, and
      // careerProfile so JD Analyzer / Networking pick up the change too
      // instead of showing stale data until a hard refresh.
      await queryClient.invalidateQueries({ queryKey: ["resumes"] });
      await queryClient.invalidateQueries({ queryKey: ["careerProfile"] });
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 3000);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      return false;
    } finally {
      setSaving(false);
    }
  }

  // ── resume upload ──────────────────────────────────────────────────────────
  const acceptFile = useCallback((f: File) => {
    if (!f.name.match(/\.pdf$/i)) {
      setError("Only PDF files are supported. Convert your resume to PDF and re-upload."); return;
    }
    if (f.size > 10 * 1024 * 1024) { setError("File must be under 10 MB."); return; }
    handleUpload(f);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUpload(file: File) {
    setUploading(true); setError(null);
    try {
      // Replacing an existing resume overwrites that same row in place
      // (instead of creating a new, orphaned one the rest of the app might
      // still be pointing at).
      const resume = await apiClient.parseResumeFile(file, "ats_clean", masterResumeId ?? undefined);
      // Fully replace the form with the newly parsed resume — a "Replace"
      // that only fills in fields the new file happens to have, and leaves
      // old values sitting in everything else, isn't a replace.
      const c = resume.content;
      const newContact: ContactInfo = {
        ...emptyContact(),
        name: (c.contact?.name as string) ?? "",
        email: (c.contact?.email as string) ?? "",
        phone: (c.contact?.phone as string) ?? "",
        location: (c.contact?.location as string) ?? "",
        linkedin: (c.contact?.linkedin as string) ?? "",
        github: (c.contact?.github as string) ?? "",
      };
      const newHeadline = (c.headline as string) ?? "";
      const newSkills = Array.isArray(c.skills) ? (c.skills as string[]) : [];
      const newExperiences: ExperienceEntry[] = Array.isArray(c.experience)
        ? (c.experience as Array<{company:string;title:string;start:string;end?:string;bullets?:string[]}>).map(e => ({
            id: newId(), type: inferExpType(e.title, e.company),
            company: e.company, title: e.title,
            start: e.start, end: e.end || "Present",
            current: !e.end || e.end === "Present",
            responsibilities: (e.bullets ?? []).join("; "),
            achievements: "", projects: "", impact: "",
          }))
        : [];
      const newProjects: ProjectEntry[] = Array.isArray(c.projects)
        ? (c.projects as Array<{name:string;tech_stack?:string;link?:string;start?:string;end?:string;bullets?:string[]}>).map(p => ({
            id: newId(), name: p.name, techStack: p.tech_stack ?? "", link: p.link ?? "",
            start: p.start ?? "", end: p.end ?? "",
            description: (p.bullets ?? []).join("; "),
          }))
        : [];
      const newEducation: EducationEntry[] = Array.isArray(c.education)
        ? (c.education as Array<{institution:string;degree:string;year:string}>).map(e => ({
            id: newId(), institution: e.institution, degree: e.degree,
            field: "", year: e.year, gpa: "", honors: "",
          }))
        : [];
      const newCertifications: CertEntry[] = Array.isArray(c.certifications)
        ? (c.certifications as string[]).map(name => ({ id: newId(), name, issuer: "", year: "" }))
        : [];

      // Fill the form only — deliberately NOT persisted yet. The uploaded
      // file is the user's master copy; auto-filling parsed fields is a
      // convenience, but overwriting their saved career profile before they
      // can review what the AI extracted is not. This gets saved either by
      // the "Save Profile" button or automatically on leaving this page
      // (see the save-on-leave effect below), same as any other edit here.
      setContact(newContact);
      setHeadline(newHeadline);
      setSkills(newSkills);
      setExperiences(newExperiences);
      setProjects(newProjects);
      setEducation(newEducation);
      setCertifications(newCertifications);
      setMasterResumeId(resume.id);
      setMasterResumeTitle(resume.title);
      setMasterResumeTemplateId(resume.template_id);

      await queryClient.invalidateQueries({ queryKey: ["resumes"] });
      await queryClient.invalidateQueries({ queryKey: ["resume", resume.id] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // ── profile photo ──────────────────────────────────────────────────────────
  async function handleProfilePhoto(file: File) {
    setPhotoUploading(true);
    setPhotoError(null);
    try {
      const { url, path } = await uploadProfilePhoto(file);
      setPhotoUrl(url);
      setPhotoPath(path);
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : "Photo upload failed");
    } finally {
      setPhotoUploading(false);
    }
  }

  function removeProfilePhoto() {
    // Leaves the storage object in place (it is overwritten on the next
    // upload) — only the profile's pointer to it is cleared, persisted on Save.
    setPhotoUrl(null);
    setPhotoPath(null);
    setPhotoError(null);
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
  // Insert a second role at the same company directly below `idx` so the two
  // sit adjacent — the arrangement the "Multiple roles at {company}" grouping
  // (and the PDF / résumé generator) recognise. New entry defaults to expanded
  // via `collapsedExp[id] ?? false`.
  const addRoleAtCompany = (idx: number) =>
    setExperiences(prev => insertRoleAfter(prev, idx));
  const moveExp = (idx: number, dir: "up" | "down") =>
    setExperiences(prev => moveExperience(prev, idx, dir));

  // ── project helpers ────────────────────────────────────────────────────────
  const updateProj = (id: string, field: keyof ProjectEntry, value: string) =>
    setProjects(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p));
  const removeProj = (id: string) => setProjects(prev => prev.filter(p => p.id !== id));
  const addProj = () => {
    const p = emptyProject();
    setProjects(prev => [...prev, p]);
    setCollapsedProj(prev => ({ ...prev, [p.id]: false }));
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

  // ── skill add/remove ─────────────────────────────────────────────────────────
  function addSkill() {
    const trimmed = skillDraft.trim();
    if (!trimmed) return;
    if (!skills.some(s => s.toLowerCase() === trimmed.toLowerCase())) {
      setSkills(prev => [...prev, trimmed]);
    }
    setSkillDraft("");
  }
  const removeSkill = (skill: string) => setSkills(prev => prev.filter(s => s !== skill));

  return (
    <div className="max-w-4xl mx-auto p-gutter pb-xxl flex flex-col gap-xl">
      {/* Page header */}
      <div className="pt-xl flex flex-col gap-xs">
        <h1 className="text-headline-xl text-on-surface font-extrabold" style={{ letterSpacing: "-0.02em" }}>
          My Profile
        </h1>
        <p className="text-body-md text-on-surface-variant max-w-2xl leading-relaxed">
          Source of truth for your career — used by JD Analyzer and Resume Builder.
        </p>
      </div>

      {error && (
        <div className="bg-error-container/30 border border-error/30 rounded-xl px-lg py-md text-body-sm text-error">
          {error}
        </div>
      )}

      {/* ── Resume upload ─────────────────────────────────────────────────── */}
      <section className={cardCls}>
        <SectionHeader title="Resume" />
        <input ref={fileRef} type="file" accept=".pdf" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) acceptFile(f); }} />

        {masterResumeDeleted && (
          <div className="flex items-start gap-md p-md rounded-xl bg-tertiary-container/20 border border-tertiary/30 mb-md">
            <FilePdf size={20} className="text-tertiary shrink-0 mt-xs" />
            <div>
              <p className="text-label-md text-on-surface font-semibold">Your uploaded resume was deleted</p>
              <p className="text-caption text-on-surface-variant mt-xs">
                The resume file linked to your profile no longer exists — it was likely removed from Resume Builder.
                Your profile details below are unaffected; upload a new resume to link one again.
              </p>
            </div>
          </div>
        )}

        {masterResumeId && masterResumeTitle ? (
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-md p-md rounded-xl bg-surface-container-lowest/60 border border-outline-variant/40 mb-md transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5">
            <div className="flex items-start gap-md">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-error-container to-error-container/60 text-error flex items-center justify-center shrink-0 border border-error-container/50">
                <FilePdf size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-label-md text-on-surface font-semibold truncate">{masterResumeTitle}</p>
                <p className="text-caption text-on-surface-variant mt-xs">Active resume · fields auto-populated from this file</p>
              </div>
            </div>
            <div className="flex items-center gap-sm shrink-0">
              <button
                onClick={() => setShowPreview(true)}
                className="flex items-center gap-xs text-label-sm font-semibold text-on-surface bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-md py-sm hover:border-primary/50 hover:text-primary transition-all">
                <Eye size={14} /> Preview
              </button>
              <button onClick={() => router.push(`/studio/${masterResumeId}`)}
                className="flex items-center gap-xs text-label-sm font-semibold text-on-surface bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-md py-sm hover:border-primary/50 hover:text-primary transition-all">
                <ArrowSquareOut size={14} /> Open
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-xs text-label-sm font-semibold text-on-surface bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-md py-sm hover:border-primary/50 hover:text-primary transition-all disabled:opacity-50">
                {uploading && <Spinner size={14} className="animate-spin" />}
                {uploading ? "Replacing…" : "Replace"}
              </button>
            </div>
          </div>
        ) : (
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) acceptFile(f); }}
            onClick={() => fileRef.current?.click()}
            className={`group rounded-xl border-2 border-dashed p-xl flex flex-col items-center text-center gap-sm cursor-pointer transition-all ${
              dragging ? "border-primary bg-primary/5" : "border-outline-variant/50 hover:border-primary/60 hover:bg-primary/5"
            }`}
          >
            <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-xs shadow-sm transition-all ${
              dragging ? "bg-primary text-white" : "bg-surface-variant/50 text-on-surface-variant group-hover:bg-primary group-hover:text-white"
            }`}>
              {uploading ? <Spinner size={26} className="animate-spin" /> : <UploadSimple size={26} />}
            </div>
            <p className="text-label-md text-on-surface font-semibold">
              {uploading ? "Parsing resume…" : dragging ? "Release to upload" : "Drag & drop your new resume here"}
            </p>
            <p className="text-caption text-on-surface-variant">
              PDF only · AI extracts contact, experience, education, and skills automatically
            </p>
          </div>
        )}
      </section>

      {/* ── Profile photo ────────────────────────────────────────────────── */}
      <ProfilePhotoCard
        photoUrl={photoUrl}
        uploading={photoUploading}
        error={photoError}
        onFileSelected={handleProfilePhoto}
        onRemove={removeProfilePhoto}
      />

      {/* ── Contact information ───────────────────────────────────────────── */}
      <section className={cardCls}>
        <SectionHeader title="Contact Information" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-lg gap-y-md">
          <div className="flex flex-col gap-xs">
            <label className={fieldLabelCls}><User size={14} className="text-primary/70" /> Full Name</label>
            <input value={contact.name ?? ""} onChange={e => setContact(p => ({ ...p, name: e.target.value }))}
              placeholder="Jane Smith" className={inputCls} />
          </div>
          <div className="flex flex-col gap-xs">
            <label className={fieldLabelCls}><Briefcase size={14} className="text-primary/70" /> Job Role</label>
            <select value={roleStatus} onChange={e => setRoleStatus(e.target.value as RoleStatus | "")}
              className={inputCls}>
              <option value="">Select…</option>
              <option value="working">Working Professional</option>
              <option value="student">Student</option>
            </select>
          </div>
          <div className="flex flex-col gap-xs md:col-span-2">
            <label className={fieldLabelCls}>Professional Headline</label>
            <input value={headline} onChange={e => setHeadline(e.target.value)}
              placeholder="Senior Software Engineer · Open to Work" className={inputCls} />
          </div>
          <div className="flex flex-col gap-xs">
            <label className={fieldLabelCls}><EnvelopeSimple size={14} className="text-primary/70" /> Email Address</label>
            <input type="email" value={contact.email ?? ""} onChange={e => setContact(p => ({ ...p, email: e.target.value }))}
              placeholder="jane@example.com" className={inputCls} />
          </div>
          <div className="flex flex-col gap-xs">
            <label className={fieldLabelCls}><Phone size={14} className="text-primary/70" /> Phone Number</label>
            <input value={contact.phone ?? ""} onChange={e => setContact(p => ({ ...p, phone: e.target.value }))}
              placeholder="+1 (555) 000-0000" className={inputCls} />
          </div>
          <div className="flex flex-col gap-xs md:col-span-2">
            <label className={fieldLabelCls}><MapPin size={14} className="text-primary/70" /> Location</label>
            <input value={contact.location ?? ""} onChange={e => setContact(p => ({ ...p, location: e.target.value }))}
              placeholder="San Francisco, CA" className={inputCls} />
          </div>
          <div className="flex flex-col gap-sm md:col-span-2 mt-xs">
            <label className={fieldLabelCls}><LinkIcon size={14} className="text-primary/70" /> Social Links</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
              <div className="relative">
                <LinkedinLogo size={18} className="absolute left-md top-1/2 -translate-y-1/2 text-on-surface-variant/60" />
                <input type="url" value={contact.linkedin ?? ""} onChange={e => setContact(p => ({ ...p, linkedin: e.target.value }))}
                  placeholder="linkedin.com/in/you" className={`${inputCls} pl-[2.75rem]`} />
              </div>
              <div className="relative">
                <GithubLogo size={18} className="absolute left-md top-1/2 -translate-y-1/2 text-on-surface-variant/60" />
                <input type="url" value={contact.github ?? ""} onChange={e => setContact(p => ({ ...p, github: e.target.value }))}
                  placeholder="github.com/you" className={`${inputCls} pl-[2.75rem]`} />
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-xs md:col-span-2">
            <label className={fieldLabelCls}><Globe size={14} className="text-primary/70" /> Website / Portfolio</label>
            <input type="url" value={contact.website ?? ""} onChange={e => setContact(p => ({ ...p, website: e.target.value }))}
              placeholder="https://yoursite.com" className={inputCls} />
          </div>
        </div>
      </section>

      {/* ── Skills ──────────────────────────────────────────────────────────── */}
      <section className={cardCls}>
        <SectionHeader title="Skills" />
        <div className="flex flex-col gap-sm">
          <div className="flex gap-xs">
            <div className="relative flex-1">
              <MagnifyingGlass size={18} className="absolute left-md top-1/2 -translate-y-1/2 text-on-surface-variant/60" />
              <input value={skillDraft} onChange={e => setSkillDraft(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addSkill(); } }}
                placeholder="Add a skill — e.g. React, AWS, Figma…"
                className={`${inputCls} pl-[2.75rem]`} />
            </div>
            <button type="button" onClick={addSkill} disabled={!skillDraft.trim()}
              className="shrink-0 w-10 h-10 rounded-xl bg-primary text-on-primary flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed">
              <Plus size={16} weight="bold" />
            </button>
          </div>
          {skills.length > 0 && (
            <div className="flex flex-wrap gap-sm">
              {skills.map(s => (
                <span key={s} className="flex items-center gap-xs pl-sm pr-xs py-xs bg-surface-container-lowest border border-outline-variant/40 shadow-sm text-on-surface text-caption rounded-full font-semibold hover:border-primary/50 hover:shadow-md transition-all">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/70" />
                  {s}
                  <button type="button" onClick={() => removeSkill(s)} aria-label={`Remove ${s}`}
                    className="rounded-full p-0.5 hover:bg-primary/15 hover:text-error transition-colors">
                    <X size={11} weight="bold" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Experience ─────────────────────────────────────────────────────── */}
      <section className={cardCls}>
        <SectionHeader title="Experience" onAdd={addExp} addLabel="Add Experience" />
        {experiences.length === 0 ? (
          <button type="button" onClick={addExp}
            className="w-full py-xl flex flex-col items-center gap-sm rounded-xl border-2 border-dashed border-outline-variant/40 hover:border-primary/40 hover:bg-surface-container/30 transition-all text-on-surface-variant/60 hover:text-primary">
            <Plus size={24} weight="bold" />
            <span className="text-label-sm">Add your first experience</span>
          </button>
        ) : (
          <div className="relative pl-lg md:pl-xl flex flex-col gap-md before:content-[''] before:absolute before:left-[7px] md:before:left-[11px] before:top-2 before:bottom-2 before:w-0.5 before:bg-outline-variant/30">
            {experiences.map((exp, idx) => {
              const collapsed = collapsedExp[exp.id] ?? false;
              const roleDuration = formatRoleDuration(exp.start, exp.current ? undefined : exp.end, exp.current);
              // A role belongs to a "company group" when it's adjacent to
              // another entry with the same company — same rule the Resume
              // Builder (EditorPanel's merge offer) and the PDF templates
              // (pdf.py's _group_experience_by_company) already use, so all
              // three screens agree on which roles "belong together." The
              // group total is only shown once, on the group's first (most
              // recent) entry, not repeated on every role in it.
              const isContinuationOfPrevious = sameCompany(exp.company, experiences[idx - 1]?.company);
              const isStartOfMultiRoleGroup = !isContinuationOfPrevious
                && sameCompany(exp.company, experiences[idx + 1]?.company);
              let companyTotalDuration: string | null = null;
              if (isStartOfMultiRoleGroup) {
                const groupRoles = [exp];
                for (let j = idx + 1; j < experiences.length && sameCompany(experiences[j].company, exp.company); j++) {
                  groupRoles.push(experiences[j]);
                }
                companyTotalDuration = formatCompanyTotalDuration(
                  groupRoles.map(r => ({ start: r.start, end: r.current ? undefined : r.end, current: r.current }))
                );
              }
              return (
                <div key={exp.id} className="relative">
                  <div className={`absolute -left-[27px] md:-left-[31px] top-5 w-4 h-4 rounded-full ring-4 ring-surface-container-low ${collapsed ? "bg-outline-variant" : "bg-primary"}`} />
                  {isStartOfMultiRoleGroup && (
                    <p className="text-caption text-primary/80 font-medium mb-xs flex items-center gap-xs">
                      <Buildings size={11} />
                      Multiple roles at {exp.company}{companyTotalDuration ? ` · ${companyTotalDuration} total` : ""}
                    </p>
                  )}
                  <div className="rounded-2xl border border-outline-variant/30 overflow-hidden bg-surface-container-lowest/60 hover:border-primary/30 transition-all">
                  {/* Header */}
                  <div className="flex items-center gap-sm px-lg py-md bg-surface-container/60">
                    <div className="flex rounded-lg overflow-hidden border border-outline-variant/30 shrink-0 text-caption">
                      {(["full-time", "internship"] as const).map(t => (
                        <button key={t} type="button" onClick={() => updateExp(exp.id, "type", t)}
                          className={`px-sm py-xs font-medium transition-colors ${
                            exp.type === t
                              ? t === "internship" ? "bg-secondary-container text-on-secondary-container" : "bg-primary text-on-primary"
                              : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high"
                          }`}>
                          {t === "full-time" ? "Full-time" : "Internship"}
                        </button>
                      ))}
                    </div>
                    <div className="flex-1 min-w-0">
                      {exp.company || exp.title ? (
                        <>
                          <p className="text-label-md text-on-surface font-bold truncate">{exp.title || "Untitled Role"}</p>
                          <p className="text-caption text-on-surface-variant flex items-center gap-xs mt-0.5">
                            <Buildings size={12} className="text-primary/60" />
                            {exp.company}{(exp.start || exp.end) ? ` · ${exp.start}${exp.current ? " - Present" : exp.end ? ` - ${exp.end}` : ""}` : ""}
                            {roleDuration ? ` · ${roleDuration}` : ""}
                          </p>
                        </>
                      ) : (
                        <span className="text-caption text-on-surface-variant">#{idx + 1} — new entry</span>
                      )}
                    </div>
                    <div className="flex items-center gap-xs ml-auto shrink-0">
                      <button type="button" onClick={() => moveExp(idx, "up")} disabled={idx === 0}
                        title="Move up"
                        className="w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-primary/10 hover:text-primary transition-colors disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-on-surface-variant">
                        <ArrowUp size={13} />
                      </button>
                      <button type="button" onClick={() => moveExp(idx, "down")} disabled={idx === experiences.length - 1}
                        title="Move down"
                        className="w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-primary/10 hover:text-primary transition-colors disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-on-surface-variant">
                        <ArrowDown size={13} />
                      </button>
                      <button type="button" onClick={() => setCollapsedExp(p => ({ ...p, [exp.id]: !collapsed }))}
                        className="w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-primary/10 hover:text-primary transition-colors">
                        <CaretDown size={14} className={`transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`} />
                      </button>
                      <button type="button" onClick={() => removeExp(exp.id)}
                        className="w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-error/10 hover:text-error transition-colors">
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  {/* Fields */}
                  {!collapsed && (
                    <div className="p-lg flex flex-col gap-sm bg-surface-container-lowest">
                      <div className="grid grid-cols-2 gap-sm">
                        <div className="flex flex-col gap-xs">
                          <label className="text-caption text-on-surface-variant">Company *</label>
                          <input value={exp.company ?? ""} onChange={e => updateExp(exp.id, "company", e.target.value)}
                            placeholder="Google" className={inputCls} />
                        </div>
                        <div className="flex flex-col gap-xs">
                          <label className="text-caption text-on-surface-variant">Role / Title *</label>
                          <input value={exp.title ?? ""} onChange={e => updateExp(exp.id, "title", e.target.value)}
                            placeholder="Software Engineer" className={inputCls} />
                        </div>
                        <div className="flex flex-col gap-xs">
                          <div className="flex items-center h-[18px]">
                            <label className="text-caption text-on-surface-variant">Start</label>
                          </div>
                          <input value={exp.start ?? ""} onChange={e => updateExp(exp.id, "start", e.target.value)}
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
                            value={exp.current ? "Present" : exp.end ?? ""}
                            onChange={e => updateExp(exp.id, "end", e.target.value)}
                            disabled={exp.current}
                            placeholder="Dec 2023"
                            className={`${inputCls} ${exp.current ? "opacity-40 cursor-not-allowed bg-surface-container-high" : ""}`}
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-xs">
                        <label className="text-caption text-on-surface-variant">Responsibilities & Roles</label>
                        <textarea value={exp.responsibilities ?? ""} onChange={e => updateExp(exp.id, "responsibilities", e.target.value)}
                          rows={2} placeholder="Led backend API development, mentored junior engineers…" className={textareaCls} />
                      </div>
                      <div className="flex flex-col gap-xs">
                        <label className="text-caption text-on-surface-variant">Achievements</label>
                        <textarea value={exp.achievements ?? ""} onChange={e => updateExp(exp.id, "achievements", e.target.value)}
                          rows={2} placeholder="Reduced API latency by 40%, shipped 3 major features…" className={textareaCls} />
                      </div>
                      <div className="grid grid-cols-2 gap-sm">
                        <div className="flex flex-col gap-xs">
                          <label className="text-caption text-on-surface-variant">Projects completed</label>
                          <textarea value={exp.projects ?? ""} onChange={e => updateExp(exp.id, "projects", e.target.value)}
                            rows={2} placeholder="Payment gateway v2, Search re-index…" className={textareaCls} />
                        </div>
                        <div className="flex flex-col gap-xs">
                          <label className="text-caption text-on-surface-variant">Impact</label>
                          <textarea value={exp.impact ?? ""} onChange={e => updateExp(exp.id, "impact", e.target.value)}
                            rows={2} placeholder="Saved $200k/yr, improved NPS by 15pts…" className={textareaCls} />
                        </div>
                      </div>
                    </div>
                  )}
                  </div>
                  {exp.company.trim() && (
                    <button type="button" onClick={() => addRoleAtCompany(idx)}
                      className="mt-xs ml-md flex items-center gap-xs text-caption text-primary/80 hover:text-primary transition-colors">
                      <Plus size={11} weight="bold" />
                      Add another role at {exp.company.trim()}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Projects ───────────────────────────────────────────────────────── */}
      <section className={cardCls}>
        <SectionHeader title="Projects" onAdd={addProj} addLabel="Add Project" />
        <p className="text-caption text-on-surface-variant -mt-sm mb-md">
          {roleStatus === "student"
            ? "Since you may not have work experience yet, this is often the most important section on your resume."
            : "Personal, open-source, or side projects worth showing alongside your work experience."}
        </p>
        {projects.length === 0 ? (
          <button type="button" onClick={addProj}
            className="w-full py-xl flex flex-col items-center gap-sm rounded-xl border-2 border-dashed border-outline-variant/40 hover:border-primary/40 hover:bg-surface-container/30 transition-all text-on-surface-variant/60 hover:text-primary">
            <Plus size={24} weight="bold" />
            <span className="text-label-sm">Add your first project</span>
          </button>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
            {projects.map((proj, idx) => {
              const collapsed = collapsedProj[proj.id] ?? false;
              const tint = idx % 2 === 0 ? "primary" : "secondary";
              return (
                <div key={proj.id} className={`rounded-2xl border border-outline-variant/30 overflow-hidden bg-surface-container-lowest/60 hover:border-primary/30 transition-all ${collapsed ? "" : "md:col-span-2"}`}>
                  {collapsed ? (
                    <div onClick={() => setCollapsedProj(p => ({ ...p, [proj.id]: false }))}
                      className="p-lg flex flex-col h-full cursor-pointer group">
                      <div className="flex items-start justify-between mb-md">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform ${
                          tint === "primary" ? "bg-primary/10 text-primary" : "bg-secondary/10 text-secondary"
                        }`}>
                          <Code size={22} />
                        </div>
                        <div className="flex items-center gap-xs opacity-0 group-hover:opacity-100 transition-opacity">
                          <button type="button" onClick={e => { e.stopPropagation(); setCollapsedProj(p => ({ ...p, [proj.id]: false })); }}
                            className="w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-primary/10 hover:text-primary transition-colors">
                            <PencilSimple size={14} />
                          </button>
                          <button type="button" onClick={e => { e.stopPropagation(); removeProj(proj.id); }}
                            className="w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-error/10 hover:text-error transition-colors">
                            <Trash size={14} />
                          </button>
                        </div>
                      </div>
                      <h3 className="text-label-md text-on-surface font-bold mb-xs truncate">{proj.name || `Untitled Project #${idx + 1}`}</h3>
                      <p className="text-caption text-on-surface-variant line-clamp-2 flex-1">
                        {proj.description || proj.techStack || "No description yet — click to edit"}
                      </p>
                      {proj.link && (
                        <a href={proj.link} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                          className={`mt-md w-fit flex items-center gap-xs text-label-sm font-semibold rounded-lg px-md py-xs transition-all ${
                            tint === "primary" ? "text-primary bg-primary/5 hover:bg-primary/10" : "text-secondary bg-secondary/5 hover:bg-secondary/10"
                          }`}>
                          View Project <ArrowSquareOut size={12} />
                        </a>
                      )}
                    </div>
                  ) : (
                    <>
                      {/* Header */}
                      <div className="flex items-center gap-sm px-lg py-md bg-surface-container/60">
                        <span className="text-caption text-on-surface-variant shrink-0">#{idx + 1}</span>
                        {proj.name && <span className="text-label-sm text-on-surface font-semibold truncate flex-1">{proj.name}{proj.techStack ? ` · ${proj.techStack}` : ""}</span>}
                        <div className="flex items-center gap-xs ml-auto shrink-0">
                          <button type="button" onClick={() => setCollapsedProj(p => ({ ...p, [proj.id]: !collapsed }))}
                            className="w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-primary/10 hover:text-primary transition-colors">
                            <CaretDown size={14} className={`transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`} />
                          </button>
                          <button type="button" onClick={() => removeProj(proj.id)}
                            className="w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-error/10 hover:text-error transition-colors">
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                      {/* Fields */}
                      <div className="p-lg flex flex-col gap-sm bg-surface-container-lowest">
                        <div className="grid grid-cols-2 gap-sm">
                          <div className="flex flex-col gap-xs">
                            <label className="text-caption text-on-surface-variant">Project Name *</label>
                            <input value={proj.name ?? ""} onChange={e => updateProj(proj.id, "name", e.target.value)}
                              placeholder="Campus Marketplace" className={inputCls} />
                          </div>
                          <div className="flex flex-col gap-xs">
                            <label className="text-caption text-on-surface-variant">Tech Stack</label>
                            <input value={proj.techStack ?? ""} onChange={e => updateProj(proj.id, "techStack", e.target.value)}
                              placeholder="React, Node.js, PostgreSQL" className={inputCls} />
                          </div>
                          <div className="flex flex-col gap-xs">
                            <label className="text-caption text-on-surface-variant">Start</label>
                            <input value={proj.start ?? ""} onChange={e => updateProj(proj.id, "start", e.target.value)}
                              placeholder="Jan 2024" className={inputCls} />
                          </div>
                          <div className="flex flex-col gap-xs">
                            <label className="text-caption text-on-surface-variant">End</label>
                            <input value={proj.end ?? ""} onChange={e => updateProj(proj.id, "end", e.target.value)}
                              placeholder="May 2024 or Present" className={inputCls} />
                          </div>
                          <div className="flex flex-col gap-xs col-span-2">
                            <label className="text-caption text-on-surface-variant flex items-center gap-xs"><LinkIcon size={12} /> Link (optional)</label>
                            <input type="url" value={proj.link ?? ""} onChange={e => updateProj(proj.id, "link", e.target.value)}
                              placeholder="https://github.com/you/project" className={inputCls} />
                          </div>
                        </div>
                        <div className="flex flex-col gap-xs">
                          <label className="text-caption text-on-surface-variant">What did you build / achieve?</label>
                          <textarea value={proj.description ?? ""} onChange={e => updateProj(proj.id, "description", e.target.value)}
                            rows={3} placeholder="Built a full-stack listings app used by 200+ students; Implemented real-time chat with WebSockets…" className={textareaCls} />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Education ──────────────────────────────────────────────────────── */}
      <section className={cardCls}>
        <SectionHeader title="Education" onAdd={addEdu} addLabel="Add Education" />
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
                <div key={edu.id} className="rounded-2xl border border-outline-variant/30 overflow-hidden bg-surface-container-lowest/60 hover:border-primary/30 transition-all">
                  <div className="flex items-center gap-sm px-md py-sm bg-surface-container/60">
                    <span className="text-caption text-on-surface-variant shrink-0">#{idx + 1}</span>
                    {edu.institution && (
                      <span className="text-label-sm text-on-surface font-semibold truncate flex-1">
                        {edu.institution}{edu.degree ? ` · ${edu.degree}` : ""}
                      </span>
                    )}
                    <div className="flex items-center gap-xs ml-auto shrink-0">
                      <button type="button" onClick={() => setCollapsedEdu(p => ({ ...p, [edu.id]: !collapsed }))}
                        className="w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-primary/10 hover:text-primary transition-colors">
                        <CaretDown size={14} className={`transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`} />
                      </button>
                      <button type="button" onClick={() => removeEdu(edu.id)}
                        className="w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-error/10 hover:text-error transition-colors">
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  {!collapsed && (
                    <div className="p-md grid grid-cols-2 gap-sm bg-surface-container-lowest">
                      <div className="flex flex-col gap-xs col-span-2">
                        <label className="text-caption text-on-surface-variant">Institution *</label>
                        <input value={edu.institution ?? ""} onChange={e => updateEdu(edu.id, "institution", e.target.value)}
                          placeholder="Stanford University" className={inputCls} />
                      </div>
                      <div className="flex flex-col gap-xs">
                        <label className="text-caption text-on-surface-variant">Degree</label>
                        <input value={edu.degree ?? ""} onChange={e => updateEdu(edu.id, "degree", e.target.value)}
                          placeholder="B.S. / M.S. / Ph.D." className={inputCls} />
                      </div>
                      <div className="flex flex-col gap-xs">
                        <label className="text-caption text-on-surface-variant">Field of Study</label>
                        <input value={edu.field ?? ""} onChange={e => updateEdu(edu.id, "field", e.target.value)}
                          placeholder="Computer Science" className={inputCls} />
                      </div>
                      <div className="flex flex-col gap-xs">
                        <label className="text-caption text-on-surface-variant">Graduation Year</label>
                        <input value={edu.year ?? ""} onChange={e => updateEdu(edu.id, "year", e.target.value)}
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
      <section className={cardCls}>
        <SectionHeader title="Certifications" onAdd={addCert} addLabel="Add Certification" />
        {certifications.length === 0 ? (
          <button type="button" onClick={addCert}
            className="w-full py-xl flex flex-col items-center gap-sm rounded-xl border-2 border-dashed border-outline-variant/40 hover:border-primary/40 hover:bg-surface-container/30 transition-all text-on-surface-variant/60 hover:text-primary">
            <Plus size={24} weight="bold" />
            <span className="text-label-sm">Add a certification</span>
          </button>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
            {certifications.map((cert, idx) => {
              const collapsed = collapsedCert[cert.id] ?? false;
              const tint = idx % 2 === 0 ? "primary" : "secondary";
              return (
                <div key={cert.id} className={`rounded-2xl border border-outline-variant/30 overflow-hidden bg-surface-container-lowest/60 hover:border-primary/30 transition-all ${collapsed ? "" : "md:col-span-2"}`}>
                  {collapsed ? (
                    <div onClick={() => setCollapsedCert(p => ({ ...p, [cert.id]: false }))}
                      className="p-lg flex flex-col h-full cursor-pointer group">
                      <div className="flex items-start justify-between mb-md">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform ${
                          tint === "primary" ? "bg-primary/10 text-primary" : "bg-secondary/10 text-secondary"
                        }`}>
                          <Certificate size={22} />
                        </div>
                        <div className="flex items-center gap-xs opacity-0 group-hover:opacity-100 transition-opacity">
                          <button type="button" onClick={e => { e.stopPropagation(); setCollapsedCert(p => ({ ...p, [cert.id]: false })); }}
                            className="w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-primary/10 hover:text-primary transition-colors">
                            <PencilSimple size={14} />
                          </button>
                          <button type="button" onClick={e => { e.stopPropagation(); removeCert(cert.id); }}
                            className="w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-error/10 hover:text-error transition-colors">
                            <Trash size={14} />
                          </button>
                        </div>
                      </div>
                      <h3 className="text-label-md text-on-surface font-bold mb-xs truncate">{cert.name || `Untitled Certification #${idx + 1}`}</h3>
                      {cert.issuer && (
                        <p className={`text-caption font-semibold flex items-center gap-xs mb-xs ${tint === "primary" ? "text-primary" : "text-secondary"}`}>
                          <Buildings size={12} /> {cert.issuer}
                        </p>
                      )}
                      {cert.year && <p className="text-caption text-on-surface-variant">Issued: {cert.year}</p>}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-sm px-lg py-md bg-surface-container/60">
                        <span className="text-caption text-on-surface-variant shrink-0">#{idx + 1}</span>
                        {cert.name && <span className="text-label-sm text-on-surface font-semibold truncate flex-1">{cert.name}{cert.issuer ? ` · ${cert.issuer}` : ""}</span>}
                        <div className="flex items-center gap-xs ml-auto shrink-0">
                          <button type="button" onClick={() => setCollapsedCert(p => ({ ...p, [cert.id]: !collapsed }))}
                            className="w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-primary/10 hover:text-primary transition-colors">
                            <CaretDown size={14} className={`transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`} />
                          </button>
                          <button type="button" onClick={() => removeCert(cert.id)}
                            className="w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-error/10 hover:text-error transition-colors">
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="p-lg grid grid-cols-3 gap-sm bg-surface-container-lowest">
                        <div className="flex flex-col gap-xs col-span-3 md:col-span-1">
                          <label className="text-caption text-on-surface-variant">Certification Name *</label>
                          <input value={cert.name ?? ""} onChange={e => updateCert(cert.id, "name", e.target.value)}
                            placeholder="AWS Solutions Architect" className={inputCls} />
                        </div>
                        <div className="flex flex-col gap-xs col-span-2 md:col-span-1">
                          <label className="text-caption text-on-surface-variant">Issuing Organisation</label>
                          <input value={cert.issuer ?? ""} onChange={e => updateCert(cert.id, "issuer", e.target.value)}
                            placeholder="Amazon Web Services" className={inputCls} />
                        </div>
                        <div className="flex flex-col gap-xs col-span-1">
                          <label className="text-caption text-on-surface-variant">Year</label>
                          <input value={cert.year ?? ""} onChange={e => updateCert(cert.id, "year", e.target.value)}
                            placeholder="2023" className={inputCls} />
                        </div>
                      </div>
                    </>
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
          className="flex items-center gap-sm px-xl py-md rounded-full text-label-md text-on-primary bg-primary shadow-xl shadow-primary/30 hover:-translate-y-0.5 hover:shadow-2xl active:scale-95 active:translate-y-0 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0"
        >
          {saving ? <Spinner size={18} className="animate-spin" /> : saveOk ? <CheckCircle size={18} weight="fill" /> : <FloppyDisk size={18} />}
          {saving ? "Saving…" : saveOk ? "Saved!" : "Save Profile"}
        </button>
      </div>

      {showPreview && masterResumeId && (
        <ResumePreviewModal
          resumeId={masterResumeId}
          templateId={masterResumeTemplateId}
          title={masterResumeTitle ?? "Resume"}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
}

"use client";
import { isResumeLimitCancelled } from "@/stores/resume-limit-store";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { safeHref } from "@/lib/safe-url";
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
  DownloadSimple,
  ArrowsClockwise,
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
  withWorkProjects,
  resumeProjectToWork,
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
import type { WorkProject } from "@career-copilot/types";
import { useRouter } from "next/navigation";
import { ResumePreviewModal } from "@/components/resume/ResumePreviewModal";
import { ProfilePhotoCard } from "@/components/profile/ProfilePhotoCard";
import { MiscellaneousPoints } from "@/components/profile/MiscellaneousPoints";
import { AddSectionButton, ExtraSectionCard, SummaryCard } from "@/components/profile/ProfileSections";
import {
  EXTRA_SECTIONS,
  emptyProfileSections,
  fitProfileSections,
  resumeSectionsToProfile,
  sectionHasContent,
  type ExtraSection,
  type ProfileSections,
} from "@/lib/profile-sections";
import {
  SectionHeader, cardCls, inputCls, textareaCls, iconInputCls, fieldLabelCls,
} from "@/components/profile/ProfileFormParts";
import { uploadProfilePhoto } from "@/lib/photo-upload";
import { lockedEmail, mergeParsedContact, useAccountEmail } from "@/lib/contact-lock";
import { useLeaveWarning } from "@/lib/use-leave-warning";
import { SuggestInput } from "@/components/ui/SuggestInput";
import { MonthYearField } from "@/components/ui/MonthYearPicker";
import { WorkProjects } from "@/components/profile/WorkProjects";
import { endsBeforeStart, isPresent, tidyDate } from "@/lib/month-year";
import { canonicalFor, findRepeat } from "@/lib/suggest/client";
import { repeatedAt } from "@/lib/duplicates";
import { SOCIAL_HINT, isSocialLinkOk, tidySocialLink } from "@/lib/social-links";

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
  id: newId(), name: "", techStack: "", link: "", liveLink: "", start: "", end: "", description: "",
});

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [reparsing, setReparsing] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // ── form state ─────────────────────────────────────────────────────────────
  const [contact, setContact] = useState<ContactInfo>(emptyContact());
  // The email is the sign-in email: shown and saved as that, never edited.
  const accountEmail = useAccountEmail();
  // Read at upload time: handleUpload is reached through a callback made
  // once (acceptFile), so a plain value here would be the first render's.
  const accountEmailRef = useRef(accountEmail);
  accountEmailRef.current = accountEmail;
  const [roleStatus, setRoleStatus] = useState<RoleStatus | "">("");
  const [headline, setHeadline] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [skills, setSkills] = useState<string[]>([]);
  const [skillDraft, setSkillDraft] = useState("");
  // Says why a skill wasn't added (it's already there); cleared on typing.
  const [skillNote, setSkillNote] = useState<string | null>(null);
  const [experiences, setExperiences] = useState<ExperienceEntry[]>([]);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [education, setEducation] = useState<EducationEntry[]>([]);
  const [certifications, setCertifications] = useState<CertEntry[]>([]);
  const [masterResumeId, setMasterResumeId] = useState<string | null>(null);
  // Summary, Objective, Languages, Awards… (lib/profile-sections.ts). The
  // optional ones are shown when they hold something or were just added.
  const [sections, setSections] = useState<ProfileSections>(emptyProfileSections());
  const [shownSections, setShownSections] = useState<ExtraSection[]>([]);
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const savedLinks = useRef({ linkedin: "", github: "" });
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

  // ── unsaved-changes tracking ───────────────────────────────────────────────
  // A serialized snapshot of every persisted field. `savedSnapshotRef` holds
  // the last value that matches what's in the DB (set after the initial load
  // and after each successful save); the form is "dirty" whenever the live
  // snapshot has drifted from it. Drives both the beforeunload prompt and the
  // in-app navigation confirm below.
  const formSnapshot = useMemo(
    () => JSON.stringify({
      contact, roleStatus, headline, skills,
      experiences, projects, education, certifications,
      masterResumeId, photoUrl, photoPath, sections,
    }),
    [contact, roleStatus, headline, skills, experiences, projects, education, certifications, masterResumeId, photoUrl, photoPath, sections],
  );
  const savedSnapshotRef = useRef<string | null>(null);
  const isDirty = savedSnapshotRef.current !== null && savedSnapshotRef.current !== formSnapshot;

  // ── load profile on mount ──────────────────────────────────────────────────
  useEffect(() => {
    getCareerProfile().then(profile => {
      if (profile) hydrate(profile);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  // Once the initial load has settled, take the first snapshot as the
  // "saved" baseline — anything the user changes after this counts as dirty.
  useEffect(() => {
    if (!loading && savedSnapshotRef.current === null) {
      savedSnapshotRef.current = formSnapshot;
    }
  }, [loading, formSnapshot]);

  function hydrate(profile: CareerProfile) {
    setContact({ ...emptyContact(), ...profile.contact });
    setRoleStatus(profile.role_status ?? "");
    setHeadline(profile.headline ?? "");
    setSkills(profile.skills);
    // Dates typed before the month-year picker read in its form ("January
    // 2022" → "Jan 2022"), and are saved that way with the next Save.
    // The old Projects box moves into the role's first project card.
    setExperiences(profile.experience.map(withWorkProjects).map(e => ({
      ...e, start: tidyDate(e.start), end: tidyDate(e.end),
      workProjects: (e.workProjects ?? []).map(p => ({ ...p, start: tidyDate(p.start), end: tidyDate(p.end) })),
    })));
    setProjects((profile.projects ?? []).map(p => ({ ...p, start: tidyDate(p.start), end: tidyDate(p.end) })));
    setEducation(profile.education);
    setCertifications(profile.certifications);
    setMasterResumeId(profile.master_resume_id);
    setPhotoUrl(profile.photo_url ?? null);
    setPhotoPath(profile.photo_path ?? null);
    showSections(fitProfileSections(profile));
    rememberSavedLinks(profile.contact);
  }

  /** The links as saved, so one left unchanged isn't refused (see handleSave). */
  function rememberSavedLinks(c: Partial<ContactInfo>) {
    savedLinks.current = { linkedin: (c.linkedin ?? "").trim(), github: (c.github ?? "").trim() };
  }

  /** Fill the sections, showing each optional one that holds something. */
  function showSections(next: ProfileSections) {
    setSections(next);
    setShownSections(EXTRA_SECTIONS.filter((k) => sectionHasContent(next, k)));
  }

  const updateSections = (patch: Partial<ProfileSections>) => setSections((prev) => ({ ...prev, ...patch }));

  function addSection(section: ExtraSection) {
    setShownSections((prev) => [...prev, section]);
    // A list opens with a line to type in.
    if (section !== "objective" && sections[section].length === 0) {
      updateSections(section === "languages" ? { languages: [{ name: "", level: "" }] } : { [section]: [""] });
    }
    requestAnimationFrame(() => {
      const card = document.getElementById(`profile-section-${section}`);
      card?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      card?.querySelector<HTMLElement>("input, textarea")?.focus({ preventScroll: true });
    });
  }

  function removeSection(section: ExtraSection) {
    setShownSections((prev) => prev.filter((s) => s !== section));
    updateSections({ [section]: emptyProfileSections()[section] });
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

  // ── warn before leaving with unsaved changes ─────────────────────────────
  // Nothing is persisted until "Save Profile" is clicked (there is no
  // silent auto-save). While the form is dirty every way out asks: refresh,
  // closing the tab, any in-app link (sidebar, nav) and the browser's Back —
  // which used to leave without asking.
  useLeaveWarning(isDirty, "You have unsaved changes. Leave without saving?");

  // ── save ───────────────────────────────────────────────────────────────────
  async function handleSave(): Promise<boolean> {
    setError(null); setSaveOk(false);
    // A LinkedIn or GitHub link typed or uploaded here has to be a profile
    // link. One saved before the rule, left as it is, still saves (the
    // database allows it too) — it's shown as needing a fix.
    for (const [field, name] of [["linkedin", "LinkedIn"], ["github", "GitHub"]] as const) {
      const raw = (contact[field] ?? "").trim();
      if (!isSocialLinkOk(field, raw) && raw !== savedLinks.current[field]) {
        setError(`Fix the ${name} link before saving. ${SOCIAL_HINT[field]}.`);
        return false;
      }
    }
    // The picker won't take an end before its start, but a start moved later
    // can leave one behind.
    const backwards =
      experiences.find(e => !e.current && endsBeforeStart(e.start, e.end))?.title ||
      experiences.flatMap(e => (e.workProjects ?? []).filter(p => endsBeforeStart(p.start, p.end))
        .map(p => p.client || p.name || e.company))[0] ||
      projects.find(p => endsBeforeStart(p.start, p.end))?.name;
    if (backwards !== undefined) {
      setError(`An end date comes before its start${backwards ? ` (${backwards})` : ""}. Fix it before saving.`);
      return false;
    }
    setSaving(true);
    try {
      const profileInput: CareerProfileInput = {
        master_resume_id: masterResumeId,
        contact: { ...contact, email: lockedEmail(contact.email, accountEmail) },
        headline: headline || null,
        experience: experiences,
        projects,
        education,
        skills,
        certifications,
        role_status: roleStatus || null,
        photo_url: photoUrl,
        photo_path: photoPath,
        ...sections,
      };
      await upsertCareerProfile(profileInput);
      // Everything in the form now matches the DB — clear the dirty flag so
      // the unsaved-changes guards stand down.
      savedSnapshotRef.current = formSnapshot;
      rememberSavedLinks(contact);
      // Deliberately NOT syncing this back into the resume's stored content:
      // profileToResumeContent reconstructs bullets from the profile form's
      // split Responsibilities/Achievements/Projects/Impact fields, which
      // mangles the resume's real bullets into labeled text blobs. The
      // resume (resume.content, edited in Studio) and the career profile
      // (this page, used by JD Analyzer/tailoring) are intentionally
      // separate — Preview/Open must show the resume exactly as stored.
      // Invalidate resumes cache so Resume Builder sees the latest, and
      // careerProfile so JD Analyzer picks up the change too
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

  async function handleUpload(file: File, templateId: string = "ats_clean") {
    setUploading(true); setError(null);
    try {
      // Replacing an existing resume overwrites that same row in place
      // (instead of creating a new, orphaned one the rest of the app might
      // still be pointing at).
      const resume = await apiClient.parseResumeFile(file, templateId, masterResumeId ?? undefined);
      // Reading the PDF is a model call: it costs a credit.
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
      // Fully replace the form with the newly parsed resume — a "Replace"
      // that only fills in fields the new file happens to have, and leaves
      // old values sitting in everything else, isn't a replace.
      const c = resume.content;
      // Contact details are the user's own, not the résumé's: a parsed value
      // only fills a field that is still empty, and the email stays the
      // sign-in email (lib/contact-lock.ts). Everything else is replaced.
      const parsedContact = c.contact as Partial<ContactInfo> | undefined;
      const newHeadline = (c.headline as string) ?? "";
      const newSkills = Array.isArray(c.skills) ? (c.skills as string[]) : [];
      const newExperiences: ExperienceEntry[] = Array.isArray(c.experience)
        ? (c.experience as Array<{company:string;title:string;location?:string;start:string;end?:string;bullets?:string[];projects?:WorkProject[]}>).map(e => ({
            id: newId(), type: inferExpType(e.title, e.company),
            company: e.company, title: e.title,
            location: e.location ?? "",
            start: tidyDate(e.start), end: tidyDate(e.end) || "Present",
            current: !e.end || isPresent(e.end),
            responsibilities: (e.bullets ?? []).join("; "),
            achievements: "", projects: "", impact: "",
            workProjects: (e.projects ?? []).map(resumeProjectToWork),
          }))
        : [];
      const newProjects: ProjectEntry[] = Array.isArray(c.projects)
        ? (c.projects as Array<{name:string;tech_stack?:string;link?:string;link_label?:string;live_link?:string;live_link_label?:string;start?:string;end?:string;bullets?:string[]}>).map(p => ({
            id: newId(), name: p.name, techStack: p.tech_stack ?? "", link: p.link ?? "",
            linkLabel: p.link_label ?? "", liveLink: p.live_link ?? "", liveLinkLabel: p.live_link_label ?? "",
            start: tidyDate(p.start), end: tidyDate(p.end),
            description: (p.bullets ?? []).join("; "),
          }))
        : [];
      const newEducation: EducationEntry[] = Array.isArray(c.education)
        ? (c.education as Array<{institution:string;degree:string;year:string;gpa?:string;honors?:string}>).map(e => ({
            id: newId(), institution: e.institution, degree: e.degree,
            field: "", year: e.year, gpa: e.gpa ?? "", honors: e.honors ?? "",
          }))
        : [];
      const newCertifications: CertEntry[] = Array.isArray(c.certifications)
        ? (c.certifications as string[]).map(name => ({ id: newId(), name, issuer: "", year: "" }))
        : [];

      // Fill the form only — deliberately NOT persisted yet. The uploaded
      // file is the user's master copy; auto-filling parsed fields is a
      // convenience, but overwriting their saved career profile before they
      // can review what the AI extracted is not. It persists when they click
      // "Save Profile" — leaving with these changes unsaved triggers the
      // unsaved-changes prompt, same as any other edit here.
      // Merged against the contact as it is now, not as this handler's
      // closure saw it on first render (that read empty, and the parsed
      // résumé then replaced everything).
      setContact((prev) => ({
        ...emptyContact(),
        ...mergeParsedContact(prev, parsedContact, accountEmailRef.current),
      }));
      setHeadline(newHeadline);
      setSkills(newSkills);
      setExperiences(newExperiences);
      setProjects(newProjects);
      setEducation(newEducation);
      setCertifications(newCertifications);
      setMasterResumeId(resume.id);
      setMasterResumeTitle(resume.title);
      setMasterResumeTemplateId(resume.template_id);
      // Summary, Objective, Languages, Awards… fill their own sections,
      // replaced like everything else here.
      showSections(resumeSectionsToProfile(c));

      await queryClient.invalidateQueries({ queryKey: ["resumes"] });
      await queryClient.invalidateQueries({ queryKey: ["resume", resume.id] });
    } catch (e) {
      if (!isResumeLimitCancelled(e)) setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // ── download original resume ───────────────────────────────────────────────
  // Pulls the untouched PDF the user uploaded (stored in Supabase Storage at
  // resumes/{user}/{resume}/original.pdf) via a short-lived signed URL, then
  // saves it locally. Fetched as a blob rather than linked directly because a
  // plain <a download> pointing at the cross-origin storage URL opens the PDF
  // instead of downloading it.
  async function handleDownloadResume() {
    if (!masterResumeId) return;
    setDownloading(true);
    setError(null);
    try {
      const { signed_url, file_name } = await apiClient.getOriginalResumeFile(masterResumeId);
      const res = await fetch(signed_url);
      if (!res.ok) throw new Error("Could not fetch the resume file.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file_name || `${masterResumeTitle ?? "resume"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 404
          ? "This resume has no uploaded file to download."
          : e instanceof Error ? e.message : "Download failed"
      );
    } finally {
      setDownloading(false);
    }
  }

  // ── re-parse the stored resume ─────────────────────────────────────────────
  // Re-runs AI extraction on the original PDF already in storage — no
  // re-upload needed. Fills the form with the fresh parse (same in-place
  // "replace" semantics as an upload), which the user then reviews and saves.
  async function handleReparse() {
    if (!masterResumeId) return;
    setReparsing(true);
    setError(null);
    try {
      const { signed_url, file_name } = await apiClient.getOriginalResumeFile(masterResumeId);
      const res = await fetch(signed_url);
      if (!res.ok) throw new Error("Could not fetch the stored resume file.");
      const blob = await res.blob();
      const file = new File([blob], file_name || "resume.pdf", { type: "application/pdf" });
      await handleUpload(file, masterResumeTemplateId);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 404
          ? "This resume has no stored file to re-parse."
          : e instanceof Error ? e.message : "Re-parse failed"
      );
    } finally {
      setReparsing(false);
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
  /** Adds what's typed, or a suggestion picked from the list. Typed text
   * that is exactly a known skill or its alias ("js") goes in under the
   * list's name ("JavaScript"). */
  async function addSkill(picked?: string) {
    const typed = (picked ?? skillDraft).trim();
    if (!typed) return;
    const trimmed = picked ?? (await canonicalFor("skill", typed).catch(() => null)) ?? typed;
    // Never twice — "js" when JavaScript is there, "node js" for Node.js.
    const already = await findRepeat("skill", trimmed, skills);
    if (already) setSkillNote(`${already} is already in your skills.`);
    else setSkills(prev => [...prev, trimmed]);
    setSkillDraft("");
  }
  const removeSkill = (skill: string) => setSkills(prev => prev.filter(s => s !== skill));
  // A certification named twice is flagged, not removed: a renewal is real.
  const repeatedCerts = repeatedAt(certifications.map(c => c.name));

  return (
    <div className="w-full min-w-0 max-w-4xl mx-auto p-gutter pb-[calc(var(--spacing-xxl)+64px)] md:pb-xxl flex flex-col gap-section">
      {/* Page header */}
      <div className="pt-xs sm:pt-lg flex flex-col gap-xs">
        <h1 className="text-headline-xl text-on-surface font-extrabold" style={{ letterSpacing: "-0.02em" }}>
          My Profile
        </h1>
        <p className="hidden sm:block text-body-md text-on-surface-variant max-w-2xl leading-relaxed">
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
        <SectionHeader
          title="Resume"
          info="This is your master copy — uploading or re-parsing fills in the profile fields below for you to review, but doesn't touch resumes you've built or tailored in Resume Builder."
        />
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
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-sm sm:gap-md p-sm sm:p-md rounded-xl bg-surface-container-lowest/60 border border-outline-variant/40 mb-md transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5">
            <div className="flex items-start gap-md min-w-0 md:flex-1">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-error-container to-error-container/60 text-error flex items-center justify-center shrink-0 border border-error-container/50">
                <FilePdf size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-label-md text-on-surface font-semibold truncate">{masterResumeTitle}</p>
                <p className="text-caption text-on-surface-variant mt-xs"><span className="sm:hidden">Active resume</span><span className="hidden sm:inline">Active resume · fields auto-populated from this file</span></p>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-xs sm:flex sm:items-center sm:gap-sm sm:flex-wrap md:justify-end">
              <button
                onClick={() => setShowPreview(true)}
                className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-xs text-[11px] sm:text-label-sm font-semibold text-on-surface bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-xs sm:px-md py-sm hover:border-primary/50 hover:text-primary transition-all">
                <Eye size={14} /> View
              </button>
              <button
                onClick={handleDownloadResume}
                disabled={downloading}
                className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-xs text-[11px] sm:text-label-sm font-semibold text-on-surface bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-xs sm:px-md py-sm hover:border-primary/50 hover:text-primary transition-all disabled:opacity-50">
                {downloading ? <Spinner size={14} className="animate-spin" /> : <DownloadSimple size={14} />}
                {downloading ? "Saving…" : "Download"}
              </button>
              <button onClick={() => router.push(`/studio/${masterResumeId}`)}
                className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-xs text-[11px] sm:text-label-sm font-semibold text-on-surface bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-xs sm:px-md py-sm hover:border-primary/50 hover:text-primary transition-all">
                <ArrowSquareOut size={14} /> Open
              </button>
              <button
                onClick={handleReparse}
                disabled={uploading || reparsing}
                title="Re-run AI extraction on the stored file"
                className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-xs text-[11px] sm:text-label-sm font-semibold text-on-surface bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-xs sm:px-md py-sm hover:border-primary/50 hover:text-primary transition-all disabled:opacity-50">
                <ArrowsClockwise size={14} className={reparsing ? "animate-spin" : ""} />
                {reparsing ? "Parsing…" : "Re-parse"}
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading || reparsing}
                className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-xs text-[11px] sm:text-label-sm font-semibold text-on-surface bg-surface-container-lowest border border-outline-variant/40 rounded-lg px-xs sm:px-md py-sm hover:border-primary/50 hover:text-primary transition-all disabled:opacity-50">
                {uploading && !reparsing && <Spinner size={14} className="animate-spin" />}
                {uploading && !reparsing ? "Replacing…" : "Replace"}
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
        <div className="grid grid-cols-2 gap-x-sm sm:gap-x-lg gap-y-sm sm:gap-y-md">
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
          <div className="flex flex-col gap-xs col-span-2">
            <label className={fieldLabelCls}>Professional Headline</label>
            <input value={headline} onChange={e => setHeadline(e.target.value)}
              placeholder="Senior Software Engineer · Open to Work" className={inputCls} />
          </div>
          <div className="flex flex-col gap-xs">
            <label htmlFor="profile-email" className={fieldLabelCls}><EnvelopeSimple size={14} className="text-primary/70" /> Email Address</label>
            <input id="profile-email" type="email" value={lockedEmail(contact.email, accountEmail)} readOnly
              aria-describedby="profile-email-note"
              className={`${inputCls} bg-surface-container-high! text-on-surface-variant cursor-default`} />
            <p id="profile-email-note" className="text-caption text-on-surface-variant">
              The sign-in email for this account. It cannot be changed.
            </p>
          </div>
          <div className="flex flex-col gap-xs">
            <label className={fieldLabelCls}><Phone size={14} className="text-primary/70" /> Phone Number</label>
            <input value={contact.phone ?? ""} onChange={e => setContact(p => ({ ...p, phone: e.target.value }))}
              placeholder="+1 (555) 000-0000" className={inputCls} />
          </div>
          <div className="flex flex-col gap-xs col-span-2">
            <label className={fieldLabelCls}><MapPin size={14} className="text-primary/70" /> Location</label>
            <SuggestInput kind="city" value={contact.location ?? ""} onValueChange={v => setContact(p => ({ ...p, location: v }))}
              placeholder="San Francisco, CA" className={inputCls} />
          </div>
          <div className="flex flex-col gap-sm col-span-2 mt-xs">
            <label className={fieldLabelCls}><LinkIcon size={14} className="text-primary/70" /> Social Links</label>
            <div className="grid grid-cols-2 gap-sm sm:gap-md items-start">
              {([
                ["linkedin", LinkedinLogo, "LinkedIn", "linkedin.com/in/you"],
                ["github", GithubLogo, "GitHub", "github.com/you"],
              ] as const).map(([field, Logo, name, placeholder]) => {
                const bad = !isSocialLinkOk(field, contact[field]);
                return (
                  <div key={field} className="flex flex-col gap-xs min-w-0">
                    <div className="relative">
                      <Logo size={18} className="absolute left-md top-1/2 -translate-y-1/2 text-on-surface-variant/60" />
                      <input type="url" inputMode="url" aria-label={`${name} profile link`}
                        value={contact[field] ?? ""}
                        onChange={e => setContact(p => ({ ...p, [field]: e.target.value }))}
                        // Put in the standard form on leaving the field.
                        onBlur={e => {
                          const tidy = tidySocialLink(field, e.target.value);
                          if (tidy !== null && tidy !== e.target.value) setContact(p => ({ ...p, [field]: tidy }));
                        }}
                        aria-invalid={bad || undefined}
                        aria-describedby={bad ? `profile-${field}-hint` : undefined}
                        placeholder={placeholder}
                        className={`${iconInputCls} ${bad ? "border-error! focus:ring-error/15!" : ""}`} />
                    </div>
                    {bad && (
                      <p id={`profile-${field}-hint`} className="text-caption text-error">
                        {contact[field]?.trim() === savedLinks.current[field] ? "Needs a fix. " : ""}
                        {SOCIAL_HINT[field]}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col gap-xs col-span-2">
            <label className={fieldLabelCls}><Globe size={14} className="text-primary/70" /> Website / Portfolio</label>
            <input type="url" value={contact.website ?? ""} onChange={e => setContact(p => ({ ...p, website: e.target.value }))}
              placeholder="https://yoursite.com" className={inputCls} />
          </div>
        </div>
      </section>

      {/* ── Summary — always shown ────────────────────────────────────────── */}
      <SummaryCard value={sections.summary ?? ""} onChange={(summary) => updateSections({ summary })} />

      {/* ── Skills ──────────────────────────────────────────────────────────── */}
      <section className={cardCls}>
        <SectionHeader title="Skills" />
        <div className="flex flex-col gap-sm">
          <div className="flex gap-xs">
            <div className="relative flex-1">
              <MagnifyingGlass size={18} className="absolute left-md top-1/2 -translate-y-1/2 text-on-surface-variant/60" />
              <SuggestInput kind="skill" value={skillDraft} onValueChange={v => { setSkillDraft(v); setSkillNote(null); }} onPick={addSkill}
                exclude={skills}
                aria-label="Add a skill" aria-describedby={skillNote ? "profile-skill-note" : undefined}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addSkill(); } }}
                placeholder="Add a skill — e.g. React, AWS, Figma…"
                className={iconInputCls} />
            </div>
            <button type="button" onClick={() => addSkill()} disabled={!skillDraft.trim()}
              className="shrink-0 w-10 h-10 rounded-xl bg-primary text-on-primary flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed">
              <Plus size={16} weight="bold" />
            </button>
          </div>
          <p id="profile-skill-note" role="status" className="text-caption text-on-surface-variant empty:hidden">{skillNote}</p>
          {skills.length > 0 && (
            <div className="flex flex-wrap gap-sm">
              {skills.map(s => (
                <span key={s} className="flex items-center gap-xs pl-sm pr-xs py-xs bg-surface-container-lowest border border-outline-variant/40 shadow-sm text-on-surface text-caption rounded-full font-semibold hover:border-primary/50 hover:shadow-md transition-all">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/70" />
                  {s}
                  <button type="button" onClick={() => removeSkill(s)} aria-label={`Remove ${s}`}
                    className="relative rounded-full p-0.5 before:absolute before:-inset-1.5 before:content-[''] hover:bg-primary/15 hover:text-error transition-colors">
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
        <SectionHeader
          title="Experience"
          info="Add roles in any order. If you add a second role at the same company, they're grouped together automatically and their combined time there is totaled."
          onAdd={addExp}
          addLabel="Add Experience"
        />
        {experiences.length === 0 ? (
          <button type="button" onClick={addExp}
            className="w-full py-xl flex flex-col items-center gap-sm rounded-xl border-2 border-dashed border-outline-variant/40 hover:border-primary/40 hover:bg-surface-container/30 transition-all text-on-surface-variant/60 hover:text-primary">
            <Plus size={24} weight="bold" />
            <span className="text-label-sm">Add your first experience</span>
          </button>
        ) : (
          <div className="relative [--rail:24px] md:[--rail:32px] pl-[var(--rail)] flex flex-col gap-md">
            {/* The timeline: one width, --rail, places both the line and the
                dots, so they stay centred on each other at every size (they
                were set with separate numbers and drifted 3-13px apart). Each
                entry draws the line from its own dot down to the next one's,
                so it starts and ends on a dot. */}
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
                  {idx < experiences.length - 1 && (
                    <div
                      aria-hidden
                      className="absolute left-[calc(var(--rail)_/_-2_-_1px)] top-7 h-[calc(100%_+_var(--spacing-md))] w-0.5 bg-outline-variant/30"
                    />
                  )}
                  <div
                    aria-hidden
                    className={`absolute left-[calc(var(--rail)_/_-2_-_8px)] top-5 w-4 h-4 rounded-full ring-4 ring-surface-container-low ${collapsed ? "bg-outline-variant" : "bg-primary"}`}
                  />
                  {isStartOfMultiRoleGroup && (
                    <p className="text-caption text-primary/80 font-medium mb-xs flex items-center gap-xs">
                      <Buildings size={11} />
                      Multiple roles at {exp.company}{companyTotalDuration ? ` · ${companyTotalDuration} total` : ""}
                    </p>
                  )}
                  <div className="rounded-2xl border border-outline-variant/30 overflow-hidden bg-surface-container-lowest/60 hover:border-primary/30 transition-all">
                  {/* Header */}
                  <div className="flex items-center gap-xs sm:gap-sm px-sm sm:px-lg py-sm sm:py-md bg-surface-container/60">
                    <div className="flex flex-col sm:flex-row rounded-lg overflow-hidden border border-outline-variant/30 shrink-0 text-caption">
                      {(["full-time", "internship"] as const).map(t => (
                        <button key={t} type="button" onClick={() => updateExp(exp.id, "type", t)}
                          className={`px-xs sm:px-sm py-xs font-medium transition-colors ${
                            exp.type === t
                              ? t === "internship" ? "bg-secondary-container text-on-secondary-container" : "bg-primary text-on-primary"
                              : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high"
                          }`}>
                          {t === "full-time" ? "Full-time" : <><span className="sm:hidden">Intern</span><span className="hidden sm:inline">Internship</span></>}
                        </button>
                      ))}
                    </div>
                    <div className="flex-1 min-w-0">
                      {exp.company || exp.title ? (
                        <>
                          <p className="text-label-md text-on-surface font-bold truncate">{exp.title || "Untitled Role"}</p>
                          <p className="text-caption text-on-surface-variant mt-0.5 truncate">
                            <Buildings size={12} className="inline -mt-0.5 mr-xs text-primary/60" />
                            {exp.company}{(exp.start || exp.end) ? ` · ${exp.start}${exp.current ? " - Present" : exp.end ? ` - ${exp.end}` : ""}` : ""}
                            {roleDuration ? ` · ${roleDuration}` : ""}
                          </p>
                        </>
                      ) : (
                        <span className="text-caption text-on-surface-variant">#{idx + 1} — new entry</span>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 sm:gap-xs ml-auto shrink-0">
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
                    <div className="p-sm sm:p-lg flex flex-col gap-sm bg-surface-container-lowest">
                      <div className="grid grid-cols-2 gap-sm">
                        <div className="flex flex-col gap-xs">
                          <label className="text-caption text-on-surface-variant">Company *</label>
                          <input value={exp.company ?? ""} onChange={e => updateExp(exp.id, "company", e.target.value)}
                            placeholder="Google" className={inputCls} />
                        </div>
                        <div className="flex flex-col gap-xs">
                          <label className="text-caption text-on-surface-variant">Role / Title *</label>
                          <SuggestInput kind="jobTitle" value={exp.title ?? ""} onValueChange={v => updateExp(exp.id, "title", v)}
                            placeholder="Software Engineer" className={inputCls} />
                        </div>
                        <div className="flex flex-col gap-xs col-span-2">
                          <label className="text-caption text-on-surface-variant">Location</label>
                          <SuggestInput kind="city" value={exp.location ?? ""} onValueChange={v => updateExp(exp.id, "location", v)}
                            placeholder="London, UK or Remote" className={inputCls} />
                        </div>
                        {/* Start and End side by side, with one plain checkbox
                            under them for a role that hasn't ended. Ticking it
                            leaves the typed end date alone, so unticking brings
                            it back instead of leaving "Present" in the box. */}
                        <div className="flex flex-col gap-xs">
                          <label htmlFor={`exp-start-${exp.id}`} className="text-caption text-on-surface-variant">Start</label>
                          <MonthYearField id={`exp-start-${exp.id}`} label="Start" value={exp.start ?? ""}
                            onChange={v => updateExp(exp.id, "start", v)} placeholder="Jan 2022" className={inputCls} />
                        </div>
                        <div className="flex flex-col gap-xs">
                          <label htmlFor={`exp-end-${exp.id}`} className="text-caption text-on-surface-variant">End</label>
                          {exp.current ? (
                            <input id={`exp-end-${exp.id}`} value="Present" readOnly tabIndex={-1}
                              className={`${inputCls} bg-surface-container-high! focus:bg-surface-container-high! hover:border-outline-variant/40 text-on-surface-variant cursor-default`} />
                          ) : (
                            <MonthYearField id={`exp-end-${exp.id}`} label="End" value={exp.end === "Present" ? "" : exp.end ?? ""}
                              start={exp.start} onChange={v => updateExp(exp.id, "end", v)}
                              placeholder="Dec 2023" className={inputCls} />
                          )}
                        </div>
                        <label className="col-span-2 -mt-xs flex items-center gap-sm self-start min-h-8 pr-sm cursor-pointer text-body-sm text-on-surface">
                          <input type="checkbox" checked={exp.current}
                            onChange={e => updateExp(exp.id, "current", e.target.checked)}
                            className="w-4 h-4 shrink-0 accent-primary cursor-pointer" />
                          I work here now
                        </label>
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
                      <div className="flex flex-col gap-xs">
                        <label className="text-caption text-on-surface-variant">Impact</label>
                        <textarea value={exp.impact ?? ""} onChange={e => updateExp(exp.id, "impact", e.target.value)}
                          rows={2} placeholder="Saved $200k/yr, improved NPS by 15pts…" className={textareaCls} />
                      </div>
                      {/* The role's projects — the old free-text Projects box
                          became the first card (withWorkProjects). */}
                      <WorkProjects
                        entryId={exp.id}
                        projects={exp.workProjects ?? []}
                        onChange={workProjects => setExperiences(prev => prev.map(e => e.id === exp.id ? { ...e, workProjects } : e))}
                      />
                    </div>
                  )}
                  </div>
                  {exp.company.trim() && (
                    <button type="button" onClick={() => addRoleAtCompany(idx)}
                      className="-mt-xs -mb-sm py-sm ml-md flex items-center gap-xs text-caption text-primary/80 hover:text-primary transition-colors">
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
        <p className="hidden sm:block text-caption text-on-surface-variant -mt-sm mb-md">
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
          <div className="grid grid-cols-2 gap-sm sm:gap-md">
            {projects.map((proj, idx) => {
              const collapsed = collapsedProj[proj.id] ?? false;
              const tint = idx % 2 === 0 ? "primary" : "secondary";
              return (
                <div key={proj.id} className={`rounded-2xl border border-outline-variant/30 overflow-hidden bg-surface-container-lowest/60 hover:border-primary/30 transition-all ${collapsed ? "min-w-0" : "col-span-2"}`}>
                  {collapsed ? (
                    <div onClick={() => setCollapsedProj(p => ({ ...p, [proj.id]: false }))}
                      className="p-md sm:p-lg flex flex-col h-full cursor-pointer group">
                      <div className="flex items-start justify-between mb-sm sm:mb-md">
                        <div className={`w-9 h-9 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform ${
                          tint === "primary" ? "bg-primary/10 text-primary" : "bg-secondary/10 text-secondary"
                        }`}>
                          <Code size={22} />
                        </div>
                        <div className="flex items-center gap-xs [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
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
                      {safeHref(proj.liveLink || proj.link) && (
                        <a href={safeHref(proj.liveLink || proj.link)!} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
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
                      <div className="flex items-center gap-sm px-sm sm:px-lg py-sm sm:py-md bg-surface-container/60">
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
                      <div className="p-sm sm:p-lg flex flex-col gap-sm bg-surface-container-lowest">
                        <div className="grid grid-cols-2 gap-sm">
                          <div className="flex flex-col gap-xs">
                            <label className="text-caption text-on-surface-variant">Project Name *</label>
                            <input value={proj.name ?? ""} onChange={e => updateProj(proj.id, "name", e.target.value)}
                              placeholder="Campus Marketplace" className={inputCls} />
                          </div>
                          <div className="flex flex-col gap-xs">
                            <label className="text-caption text-on-surface-variant">Tech Stack</label>
                            <SuggestInput kind="skill" list value={proj.techStack ?? ""} onValueChange={v => updateProj(proj.id, "techStack", v)}
                              placeholder="React, Node.js, PostgreSQL" className={inputCls} />
                          </div>
                          <div className="flex flex-col gap-xs">
                            <label htmlFor={`proj-start-${proj.id}`} className="text-caption text-on-surface-variant">Start</label>
                            <MonthYearField id={`proj-start-${proj.id}`} label="Start" value={proj.start ?? ""}
                              onChange={v => updateProj(proj.id, "start", v)} placeholder="Jan 2024" className={inputCls} />
                          </div>
                          <div className="flex flex-col gap-xs">
                            <label htmlFor={`proj-end-${proj.id}`} className="text-caption text-on-surface-variant">End</label>
                            <MonthYearField id={`proj-end-${proj.id}`} label="End" value={proj.end ?? ""} start={proj.start} allowPresent
                              onChange={v => updateProj(proj.id, "end", v)} placeholder="May 2024 or Present" className={inputCls} />
                          </div>
                          <div className="flex flex-col gap-xs">
                            <label className="text-caption text-on-surface-variant flex items-center gap-xs"><LinkIcon size={12} /> Code link (optional)</label>
                            <input type="url" value={proj.link ?? ""} onChange={e => updateProj(proj.id, "link", e.target.value)}
                              placeholder="https://github.com/you/project" className={inputCls} />
                          </div>
                          <div className="flex flex-col gap-xs">
                            <label className="text-caption text-on-surface-variant flex items-center gap-xs"><LinkIcon size={12} /> Live link (optional)</label>
                            <input type="url" value={proj.liveLink ?? ""} onChange={e => updateProj(proj.id, "liveLink", e.target.value)}
                              placeholder="https://project.vercel.app" className={inputCls} />
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
                    <div className="p-sm sm:p-md grid grid-cols-2 gap-sm bg-surface-container-lowest">
                      <div className="flex flex-col gap-xs col-span-2">
                        <label className="text-caption text-on-surface-variant">Institution *</label>
                        <SuggestInput kind="college" value={edu.institution ?? ""} onValueChange={v => updateEdu(edu.id, "institution", v)}
                          placeholder="Stanford University" className={inputCls} />
                      </div>
                      <div className="flex flex-col gap-xs">
                        <label className="text-caption text-on-surface-variant">Degree</label>
                        <SuggestInput kind="degree" value={edu.degree ?? ""} onValueChange={v => updateEdu(edu.id, "degree", v)}
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
                        <label className="text-caption text-on-surface-variant">GPA / CGPA (optional)</label>
                        <input value={edu.gpa ?? ""} onChange={e => updateEdu(edu.id, "gpa", e.target.value)}
                          placeholder="e.g. 3.8/4.0 or 8.5/10" className={inputCls} />
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
          <div className="grid grid-cols-2 gap-sm sm:gap-md">
            {certifications.map((cert, idx) => {
              const collapsed = collapsedCert[cert.id] ?? false;
              const tint = idx % 2 === 0 ? "primary" : "secondary";
              return (
                <div key={cert.id} className={`rounded-2xl border border-outline-variant/30 overflow-hidden bg-surface-container-lowest/60 hover:border-primary/30 transition-all ${collapsed ? "min-w-0" : "col-span-2"}`}>
                  {collapsed ? (
                    <div onClick={() => setCollapsedCert(p => ({ ...p, [cert.id]: false }))}
                      className="p-md sm:p-lg flex flex-col h-full cursor-pointer group">
                      <div className="flex items-start justify-between mb-sm sm:mb-md">
                        <div className={`w-9 h-9 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform ${
                          tint === "primary" ? "bg-primary/10 text-primary" : "bg-secondary/10 text-secondary"
                        }`}>
                          <Certificate size={22} />
                        </div>
                        <div className="flex items-center gap-xs [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
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
                      <div className="flex items-center gap-sm px-sm sm:px-lg py-sm sm:py-md bg-surface-container/60">
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
                      <div className="p-sm sm:p-lg grid grid-cols-3 gap-sm bg-surface-container-lowest">
                        <div className="flex flex-col gap-xs col-span-3 md:col-span-1">
                          <label className="text-caption text-on-surface-variant">Certification Name *</label>
                          <SuggestInput kind="certification" value={cert.name ?? ""} onValueChange={v => updateCert(cert.id, "name", v)}
                            exclude={certifications.filter(c => c.id !== cert.id).map(c => c.name)}
                            aria-invalid={repeatedCerts.has(certifications.indexOf(cert)) || undefined}
                            placeholder="AWS Solutions Architect"
                            className={`${inputCls} ${repeatedCerts.has(certifications.indexOf(cert)) ? "border-error!" : ""}`} />
                          {repeatedCerts.has(certifications.indexOf(cert)) && (
                            <p className="text-caption text-error">Already listed. A renewal can stay; otherwise remove one.</p>
                          )}
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

      {/* ── Objective, Languages, Awards… — added from the sheet ───────────── */}
      {EXTRA_SECTIONS.filter((s) => shownSections.includes(s)).map((s) => (
        <ExtraSectionCard
          key={s}
          section={s}
          sections={sections}
          onChange={updateSections}
          onRemove={() => removeSection(s)}
        />
      ))}
      <AddSectionButton
        hidden={shownSections}
        onPick={addSection}
        open={addSectionOpen}
        setOpen={setAddSectionOpen}
      />

      {/* ── Miscellaneous ── */}
      <section id="miscellaneous" className={cardCls}>
        <SectionHeader
          title="Miscellaneous"
          info="Things you saved from the notes box while analysing a job or tailoring a résumé. Each is offered in every tailoring review, off until you add it. Changes here save straight away."
        />
        <MiscellaneousPoints />
      </section>

      {/* Floating save — above the phone's bottom tab bar, which otherwise
          covered it and left the profile with no way to save. */}
      <div className="fixed bottom-[calc(76px+env(safe-area-inset-bottom))] md:bottom-xl right-gutter z-50">
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

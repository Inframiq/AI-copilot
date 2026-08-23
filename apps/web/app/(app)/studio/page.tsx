"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, UploadSimple, FilePdf, FileDoc, Spinner, Trash } from "@phosphor-icons/react";
import Image from "next/image";
import { apiClient } from "@/lib/api-client";
import { RESUME_TEMPLATES } from "@/lib/resume-templates";
import { getCareerProfile, profileToResumeContent } from "@/lib/career-profile-client";
import type { Resume } from "@career-copilot/types";

const PICKER_TEMPLATES = RESUME_TEMPLATES.filter((t) =>
  ["ats_clean", "ats_modern", "ats_professional", "ats_minimal"].includes(t.id)
);

type Mode = "blank" | "upload";

export default function StudioIndexPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("ats_clean");
  const [mode, setMode] = useState<Mode>("blank");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When resumes exist, show a prompt instead of silently redirecting
  const [existingResumes, setExistingResumes] = useState<Resume[]>([]);
  const [showPrompt, setShowPrompt] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: resumes = [], isLoading } = useQuery<Resume[]>({
    queryKey: ["resumes"],
    queryFn: () => apiClient.getResumes(),
    staleTime: 2 * 60 * 1000,
  });

  // Single source of truth: always re-derive from the "resumes" query data,
  // for both the initial load AND any later mutation (delete, etc.) that
  // updates that cache. Previously this only handled the "has resumes"
  // case, so deleting down to zero left the effect doing nothing while a
  // separate manual state update in handleDeleteResume raced it and lost.
  useEffect(() => {
    if (isLoading) return;
    const sorted = [...resumes].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
    setExistingResumes(sorted);
    setShowPrompt(resumes.length > 0);
  }, [resumes, isLoading]);

  async function handleDeleteResume(id: string) {
    if (deleteConfirm !== id) {
      setDeleteConfirm(id);
      return;
    }
    setDeleteConfirm(null);
    try {
      await apiClient.deleteResume(id);
      queryClient.setQueryData<Resume[]>(["resumes"], (list) =>
        list?.filter((r) => r.id !== id)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete resume");
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) acceptFile(dropped);
  }, []);

  function acceptFile(f: File) {
    const ok = f.name.endsWith(".pdf");
    if (!ok) { setError("Only PDF files are supported. Convert your resume to PDF and re-upload."); return; }
    if (f.size > 10 * 1024 * 1024) { setError("File must be smaller than 10 MB."); return; }
    setError(null);
    setFile(f);
    setMode("upload");
  }

  async function handleCreate() {
    setError(null);
    setIsWorking(true);
    try {
      let resume: Resume;
      if (mode === "upload" && file) {
        resume = await apiClient.parseResumeFile(file, selected);
      } else {
        // Pre-fill from the career profile (Profile page) so a new resume
        // starts with what's already known about the user instead of a
        // blank slate. getCareerProfile() itself already returns null (no
        // throw) for the ordinary "no profile yet" case — anything that
        // reaches this catch is a real failure (network/auth/DB), not a new
        // user, so it's logged rather than silently treated the same way.
        const profile = await getCareerProfile().catch((err) => {
          console.error("Failed to load career profile for new-resume prefill:", err);
          return null;
        });
        const content = profile
          ? profileToResumeContent(profile)
          : { contact: { name: "", email: "" }, experience: [], education: [], skills: [] };
        resume = await apiClient.createResume({
          title: "Untitled Resume",
          template_id: selected,
          content,
        });
      }
      router.push(`/studio/${resume.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setIsWorking(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  // Prompt: user has existing resumes — let them choose
  if (showPrompt && existingResumes.length > 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-xl p-gutter max-w-[32rem] mx-auto w-full">
        <div className="text-center">
          <h2 className="text-headline-md text-on-surface font-semibold mb-sm">
            You have saved resumes
          </h2>
          <p className="text-body-md text-on-surface-variant">
            Continue editing an existing resume or start fresh with a new one.
          </p>
        </div>

        {error && <p className="text-body-sm text-error text-center">{error}</p>}

        <button
          onClick={() => setShowPrompt(false)}
          className="w-full py-md rounded-xl text-label-md text-on-primary bg-primary shadow-md hover:shadow-lg hover:scale-[0.98] active:scale-95 transition-all"
        >
          Create a new resume
        </button>

        <div className="flex items-center gap-md w-full">
          <div className="flex-1 h-px bg-outline-variant/30" />
          <span className="text-caption text-on-surface-variant">or</span>
          <div className="flex-1 h-px bg-outline-variant/30" />
        </div>

        {/* Existing resumes list */}
        <div className="w-full flex flex-col gap-sm">
          {existingResumes.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-md p-md rounded-2xl border border-outline-variant/20 bg-surface-container-lowest hover:border-primary/40 hover:shadow-md transition-all"
            >
              <button
                onClick={() => router.push(`/studio/${r.id}`)}
                className="flex items-center gap-md flex-1 min-w-0 text-left"
              >
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <CheckCircle size={20} weight="fill" className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-label-md text-on-surface font-semibold truncate">{r.title}</p>
                  <p className="text-caption text-on-surface-variant">
                    Last edited {new Date(r.updated_at).toLocaleDateString()}
                  </p>
                </div>
              </button>
              <div className="flex flex-col items-end gap-xs shrink-0">
                <button
                  onClick={() => handleDeleteResume(r.id)}
                  aria-label="Delete resume"
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                    deleteConfirm === r.id
                      ? "bg-error text-on-primary"
                      : "bg-surface-container hover:bg-error-container/50 text-on-surface-variant hover:text-error"
                  }`}
                >
                  <Trash size={16} />
                </button>
                {deleteConfirm === r.id && (
                  <span className="text-caption text-error whitespace-nowrap">Click again to confirm</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const fileIcon = file?.name.endsWith(".pdf") ? (
    <FilePdf size={32} className="text-error" />
  ) : (
    <FileDoc size={32} className="text-primary" />
  );

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-xl p-gutter max-w-4xl mx-auto w-full">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-headline-md text-on-surface font-semibold mb-sm">
          Resume Builder
        </h2>
        <p className="text-body-md text-on-surface-variant">
          Start from scratch or upload your existing resume — all templates are ATS-optimised.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="flex items-center gap-xs bg-surface-container rounded-xl p-xs">
        {(["blank", "upload"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-lg py-sm rounded-lg text-label-sm font-medium transition-all ${
              mode === m
                ? "bg-surface-container-lowest text-primary shadow-sm"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {m === "blank" ? "Start Blank" : "Upload Resume"}
          </button>
        ))}
      </div>

      {/* Upload zone — only in upload mode */}
      {mode === "upload" && (
        <div className="w-full">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) acceptFile(f); }}
          />

          {file ? (
            /* ── File selected state ── */
            <div className="w-full rounded-2xl border border-primary/30 bg-primary/5 p-lg flex items-center gap-lg">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                {fileIcon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-label-md text-on-surface font-semibold truncate">{file.name}</p>
                <p className="text-caption text-on-surface-variant mt-xs">
                  {(file.size / 1024).toFixed(0)} KB · AI will extract all sections automatically
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFile(null)}
                className="shrink-0 text-caption text-on-surface-variant hover:text-error transition-colors px-md py-sm rounded-lg hover:bg-error-container/20"
              >
                Remove
              </button>
            </div>
          ) : (
            /* ── Drop zone ── */
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`w-full rounded-2xl border-2 border-dashed transition-all duration-200 ${
                isDragging ? "border-primary bg-primary/5" : "border-outline-variant/40 bg-surface-container/30"
              }`}
            >
              <div className="flex items-center gap-xl p-lg">
                {/* Icon */}
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shrink-0 transition-colors ${
                  isDragging ? "bg-primary/15" : "bg-surface-container"
                }`}>
                  <UploadSimple size={32} className={isDragging ? "text-primary" : "text-on-surface-variant/60"} />
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <p className="text-label-lg text-on-surface font-semibold">
                    {isDragging ? "Release to upload" : "Drop your resume here"}
                  </p>
                  <p className="text-body-sm text-on-surface-variant mt-xs">
                    PDF up to 10 MB · AI parses every section automatically
                  </p>
                </div>

                {/* Browse button */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="shrink-0 px-lg py-sm rounded-xl text-label-sm text-primary border border-primary/30 hover:bg-primary/5 hover:border-primary/60 transition-all"
                >
                  Browse files
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Template picker */}
      <div className="w-full">
        <p className="text-label-sm text-on-surface-variant uppercase tracking-wider mb-md text-center">
          Choose a template
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-md">
          {PICKER_TEMPLATES.map((t) => {
            const isSelected = selected === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelected(t.id)}
                className={`group relative flex flex-col rounded-2xl border-2 overflow-hidden text-left transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  isSelected
                    ? "border-primary shadow-lg shadow-primary/20 scale-[1.02]"
                    : "border-outline-variant/30 hover:border-primary/40 hover:shadow-md"
                }`}
              >
                <div className="relative w-full aspect-[3/4] bg-surface-container overflow-hidden">
                  <Image
                    src={`/resume-templates/${t.id}.png`}
                    alt={`${t.label} template preview`}
                    fill
                    className="object-cover object-top"
                    sizes="(max-width: 768px) 50vw, 25vw"
                  />
                  {isSelected && (
                    <div className="absolute inset-0 bg-primary/10 flex items-start justify-end p-sm">
                      <CheckCircle size={24} weight="fill" className="text-primary drop-shadow" />
                    </div>
                  )}
                </div>
                <div className="p-sm bg-surface-container-lowest border-t border-outline-variant/20">
                  <p className={`text-label-sm font-semibold ${isSelected ? "text-primary" : "text-on-surface"}`}>
                    {t.label}
                  </p>
                  <p className="text-caption text-on-surface-variant mt-xs line-clamp-2">
                    {t.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* CTA */}
      <div className="flex flex-col items-center gap-sm">
        <button
          onClick={handleCreate}
          disabled={isWorking || (mode === "upload" && !file)}
          className="px-xl py-md rounded-xl text-label-md text-on-primary bg-primary shadow-lg shadow-primary/20 hover:shadow-xl hover:scale-[0.98] active:scale-95 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100 min-w-[240px] flex items-center justify-center gap-sm"
        >
          {isWorking ? (
            <>
              <Spinner size={18} className="animate-spin" />
              {mode === "upload" ? "Parsing resume…" : "Creating…"}
            </>
          ) : mode === "upload" && file ? (
            "Parse & Build Resume"
          ) : (
            "Create Resume"
          )}
        </button>
        {error && <p className="text-body-sm text-error text-center max-w-[24rem]">{error}</p>}
        {mode === "upload" && file && (
          <p className="text-caption text-on-surface-variant text-center max-w-[24rem]">
            AI will extract your contact info, experience, education, and skills — then you can edit everything before exporting.
          </p>
        )}
      </div>
    </div>
  );
}

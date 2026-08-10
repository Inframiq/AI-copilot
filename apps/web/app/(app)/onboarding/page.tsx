"use client";
import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { UploadSimple, FilePdf, FileDoc, Spinner, ArrowRight } from "@phosphor-icons/react";
import { createBrowserClient } from "@/lib/supabase";
import { apiClient } from "@/lib/api-client";
import {
  upsertCareerProfile,
  setProfileMasterResume,
  resumeContentToCareerProfileInput,
} from "@/lib/career-profile-client";

export default function OnboardingPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function finish() {
    queryClient.invalidateQueries({ queryKey: ["careerProfile"] });
    router.push("/dashboard");
  }

  async function handleSkip() {
    setSkipping(true);
    try {
      // Best-effort stub row so this page doesn't keep resurfacing on every
      // future Google sign-in for an account with no career_profiles row yet.
      const sb = createBrowserClient();
      const { data: { user } } = await sb.auth.getUser();
      await upsertCareerProfile({
        master_resume_id: null,
        contact: {
          name: (user?.user_metadata?.full_name as string) ?? "",
          email: user?.email ?? "",
        },
        headline: null,
        experience: [],
        education: [],
        skills: [],
        certifications: [],
      });
    } catch (err) {
      console.error("Failed to save onboarding skip state:", err);
    } finally {
      finish();
    }
  }

  async function handleFile(file: File) {
    if (!file.name.match(/\.(pdf|docx|doc)$/i)) {
      setError("Only PDF or DOCX files are supported.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("File must be under 10 MB.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const resume = await apiClient.parseResumeFile(file, "ats_clean");
      await upsertCareerProfile(resumeContentToCareerProfileInput(resume.content, resume.id));
      await setProfileMasterResume(resume.id);
      finish();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. You can skip and add this later.");
      setUploading(false);
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-full flex items-center justify-center p-gutter">
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-xl p-xl max-w-[32rem] w-full">
        <h1 className="text-headline-lg text-on-surface font-bold mb-xs">Welcome to Career Copilot</h1>
        <p className="text-body-md text-on-surface-variant mb-lg">
          Upload your resume and we&rsquo;ll build your profile automatically — used across
          Resume Builder, JD Analyzer, and Networking. You can always fill it in later.
        </p>

        {error && (
          <div className="mb-md p-md rounded-lg bg-error-container text-on-error-container text-body-sm">
            {error}
          </div>
        )}

        <label
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center gap-sm rounded-2xl border-2 border-dashed p-xl cursor-pointer transition-colors ${
            dragging ? "border-primary bg-primary/5" : "border-outline-variant/40 hover:border-primary/50"
          }`}
        >
          <input
            type="file"
            accept=".pdf,.docx,.doc"
            className="hidden"
            disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          {uploading ? (
            <>
              <Spinner size={32} className="animate-spin text-primary" />
              <p className="text-body-sm text-on-surface-variant">Parsing your resume…</p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-sm text-on-surface-variant">
                <UploadSimple size={28} />
                <FilePdf size={28} />
                <FileDoc size={28} />
              </div>
              <p className="text-body-md text-on-surface font-semibold">Drop your resume here</p>
              <p className="text-body-sm text-on-surface-variant">or click to browse — PDF or DOCX, up to 10 MB</p>
            </>
          )}
        </label>

        <button
          onClick={handleSkip}
          disabled={uploading || skipping}
          className="w-full mt-lg flex items-center justify-center gap-xs py-md rounded-lg text-label-md text-on-surface-variant hover:bg-surface-container-low transition-colors disabled:opacity-60"
        >
          {skipping ? "Skipping…" : "Skip for now"}
          {!skipping && <ArrowRight size={16} />}
        </button>
      </div>
    </div>
  );
}

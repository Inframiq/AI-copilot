"use client";
import { isResumeLimitCancelled } from "@/stores/resume-limit-store";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { UploadSimple, FilePdf, FileDoc, Spinner, ArrowRight, User, EnvelopeSimple, Phone, Briefcase } from "@phosphor-icons/react";
import { createBrowserClient } from "@/lib/supabase";
import { apiClient } from "@/lib/api-client";
import {
  upsertCareerProfile,
  setProfileMasterResume,
  resumeContentToCareerProfileInput,
  fileUnplacedPoints,
  type RoleStatus,
} from "@/lib/career-profile-client";
import { PlansComparison } from "@/components/plans/PlansComparison";
import { mergeParsedContact } from "@/lib/contact-lock";
import { tidyPhone } from "@/lib/phone";
import { tidyContactLinks } from "@/lib/social-links";
import { UpgradeModal } from "@/components/plans/UpgradeModal";

const inputCls = "w-full px-md py-sm bg-surface-container border border-outline-variant/40 rounded-xl text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary focus:border-primary placeholder:text-on-surface-variant/50 transition-all";

export default function OnboardingPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"details" | "resume" | "plan">("details");
  const [showUpgrade, setShowUpgrade] = useState(false);

  // ── Step 1: mandatory details ────────────────────────────────────────────
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [roleStatus, setRoleStatus] = useState<RoleStatus | "">("");
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  useEffect(() => {
    const sb = createBrowserClient();
    (async () => {
      const {
        data: { user },
      } = await sb.auth.getUser();
      if (!user) return;
      setName((user.user_metadata?.full_name as string) ?? "");
      setEmail(user.email ?? "");
    })();
  }, []);

  // Phone is optional: a résumé is complete without one, so we don't ask
  // for it as a condition of using the app.
  const detailsValid = name.trim() && email.trim() && roleStatus;

  async function handleDetailsSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!detailsValid) return;
    setSavingDetails(true);
    setDetailsError(null);
    try {
      await upsertCareerProfile({
        master_resume_id: null,
        contact: { name: name.trim(), email: email.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}) },
        headline: null,
        experience: [],
        projects: [],
        education: [],
        skills: [],
        certifications: [],
        role_status: roleStatus,
        photo_url: null,
        photo_path: null,
      });
      setStep("resume");
    } catch (err) {
      setDetailsError(err instanceof Error ? err.message : "Failed to save your details");
    } finally {
      setSavingDetails(false);
    }
  }

  // ── Step 2: resume upload (optional) ─────────────────────────────────────
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function finish() {
    queryClient.invalidateQueries({ queryKey: ["careerProfile"] });
    router.push("/dashboard?tour=1");
  }

  function handleSkip() {
    // The mandatory details are already persisted from step 1 — nothing
    // further to save, just move on to the plan step.
    setStep("plan");
  }

  async function handleFile(file: File) {
    if (!file.name.match(/\.pdf$/i)) {
      setUploadError("Only PDF files are supported. Convert your resume to PDF and re-upload.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("File must be under 10 MB.");
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const resume = await apiClient.parseResumeFile(file, "ats_clean");
      // Reading the PDF is a model call: it costs a credit.
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
      const parsed = resumeContentToCareerProfileInput(resume.content, resume.id);
      await upsertCareerProfile({
        ...parsed,
        // The details from step 1 are the user's own: a parsed value only
        // fills a field still empty, and the email stays the sign-in email.
        // A LinkedIn or GitHub link that isn't a profile link stays off the
        // profile (the database would refuse the whole save); the résumé
        // keeps it, flagged in the Builder.
        contact: tidyContactLinks(mergeParsedContact({ name, email, phone }, parsed.contact, email), { dropBad: true }),
        role_status: roleStatus || null,
      });
      // Points the résumé printed under no job wait in the profile's
      // Miscellaneous, under their heading, for a later review to place.
      await fileUnplacedPoints(resume.unplaced).catch(console.error);
      await setProfileMasterResume(resume.id);
      setStep("plan");
    } catch (err) {
      if (isResumeLimitCancelled(err)) { setUploading(false); return; }
      setUploadError(err instanceof Error ? err.message : "Upload failed. You can skip and add this later.");
      setUploading(false);
    }
  }

  // A plain function, not a once-made useCallback: that kept step 1's
  // first-render values (all empty), so a dropped résumé replaced the
  // details the user had just typed and dropped their experience level.
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  if (step === "details") {
    return (
      <div className="min-h-full flex items-center justify-center p-gutter">
        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-xl p-xl max-w-[32rem] w-full">
          <h1 className="text-headline-lg text-on-surface font-bold mb-xs">Welcome to KripaX</h1>
          <p className="text-body-md text-on-surface-variant mb-lg">
            A few quick details before we get started — used across Resume Builder and JD Analyzer.
          </p>

          {detailsError && (
            <div className="mb-md p-md rounded-lg bg-error-container text-on-error-container text-body-sm">
              {detailsError}
            </div>
          )}

          <form onSubmit={handleDetailsSubmit} className="flex flex-col gap-md">
            <div className="flex flex-col gap-xs">
              <label className="text-label-sm text-on-surface-variant flex items-center gap-xs"><User size={14} /> Full Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required
                placeholder="Jane Smith" className={inputCls} />
            </div>
            <div className="flex flex-col gap-xs">
              <label className="text-label-sm text-on-surface-variant flex items-center gap-xs"><EnvelopeSimple size={14} /> Email</label>
              <input type="email" value={email} readOnly required aria-describedby="onboarding-email-note"
                className={`${inputCls} text-on-surface-variant cursor-default`} />
              <p id="onboarding-email-note" className="text-caption text-on-surface-variant">
                The sign-in email for this account. It cannot be changed.
              </p>
            </div>
            <div className="flex flex-col gap-xs">
              <label className="text-label-sm text-on-surface-variant flex items-center gap-xs"><Phone size={14} /> Phone Number <span className="font-normal">(optional)</span></label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                onBlur={(e) => setPhone(tidyPhone(e.target.value))}
                placeholder="+91 98765 43210" className={inputCls} />
            </div>
            <div className="flex flex-col gap-xs">
              <label htmlFor="onboarding-experience-level" className="text-label-sm text-on-surface-variant flex items-center gap-xs"><Briefcase size={14} /> Experience Level</label>
              <select id="onboarding-experience-level" value={roleStatus} onChange={(e) => setRoleStatus(e.target.value as RoleStatus | "")} required
                className={inputCls}>
                <option value="" disabled>Select one…</option>
                <option value="working">Working Professional</option>
                <option value="student">Student</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={!detailsValid || savingDetails}
              className="w-full mt-sm py-md text-label-md text-on-primary rounded-xl bg-primary shadow-md hover:shadow-lg hover:scale-[0.98] active:scale-95 transition-all duration-200 flex items-center justify-center gap-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
            >
              {savingDetails ? "Saving…" : "Continue"}
              {!savingDetails && <ArrowRight size={16} />}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (step === "plan") {
    return (
      <div className="min-h-full flex items-center justify-center p-gutter">
        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-xl p-xl max-w-[42rem] w-full">
          <h1 className="text-headline-lg text-on-surface font-bold mb-xs">Choose your plan</h1>
          <p className="text-body-md text-on-surface-variant mb-lg">
            Start free — you can upgrade anytime from Account.
          </p>
          <PlansComparison
            variant="compact"
            onChoosePlan={(id) => (id === "premium" ? setShowUpgrade(true) : finish())}
          />
          {showUpgrade && (
            <UpgradeModal
              onClose={() => {
                setShowUpgrade(false);
                finish();
              }}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full flex items-center justify-center p-gutter">
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-xl p-xl max-w-[32rem] w-full">
        <h1 className="text-headline-lg text-on-surface font-bold mb-xs">Upload your resume</h1>
        <p className="text-body-md text-on-surface-variant mb-lg">
          We&rsquo;ll parse it and build the rest of your profile automatically. You can always fill it in later.
        </p>

        {uploadError && (
          <div className="mb-md p-md rounded-lg bg-error-container text-on-error-container text-body-sm">
            {uploadError}
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
            accept=".pdf"
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
              <p className="text-body-sm text-on-surface-variant">or click to browse — PDF only, up to 10 MB</p>
            </>
          )}
        </label>

        <button
          onClick={handleSkip}
          disabled={uploading}
          className="w-full mt-lg flex items-center justify-center gap-xs py-md rounded-lg text-label-md text-on-surface-variant hover:bg-surface-container-low transition-colors disabled:opacity-60"
        >
          Skip for now
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

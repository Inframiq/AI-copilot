"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardText,
  ListDashes,
  MagnifyingGlass,
  Target,
  ListChecks,
  CheckCircle,
  WarningCircle,
  PlusCircle,
  Lightbulb,
  Briefcase,
  MapPin,
  Money,
  Brain,
  UploadSimple,
  X,
  Sparkle,
  Calendar,
} from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import { useTailoringStore } from "@/stores/tailoring-store";
import { useResumeStore } from "@/stores/resume-store";
import { getCareerProfile, type CareerProfile } from "@/lib/career-profile-client";
import type { JobDescription, JDStatus, Resume, LearningItem } from "@career-copilot/types";

const STATUS_LABEL: Record<JDStatus, string> = {
  applied: "Applied",
  interview: "Interview",
  final_round: "Final Round",
  offer: "Offer",
  accepted: "Accepted",
  rejected: "Rejected",
};

const STATUS_ORDER: JDStatus[] = ["applied", "interview", "final_round", "offer", "accepted", "rejected"];

function extractInsights(text: string) {
  const lower = text.toLowerCase();
  // Seniority
  let seniority = "Not specified"; let yearsNote = "";
  const yrs = lower.match(/(\d+)\+?\s*years?\s*(?:of\s+)?(?:experience|exp)/i);
  if (yrs) yearsNote = `${yrs[1]}+ years required`;
  if (/principal|staff engineer/.test(lower)) seniority = "Principal / Staff";
  else if (/\bsenior\b|sr\./.test(lower)) seniority = "Senior Level";
  else if (/\blead\b|tech lead/.test(lower)) seniority = "Lead Level";
  else if (/junior|jr\.|entry.level/.test(lower)) seniority = "Junior Level";
  else if (/mid.level|mid level/.test(lower)) seniority = "Mid Level";
  else if (/manager|director/.test(lower)) seniority = "Management";
  // Location
  let location = "Not specified"; let locNote = "";
  if (/fully remote|100%\s*remote/.test(lower)) location = "Fully Remote";
  else if (/\bremote\b/.test(lower)) location = "Remote";
  else if (/\bhybrid\b/.test(lower)) location = "Hybrid";
  else if (/on-site|onsite|in-office/.test(lower)) location = "On-site";
  if (/united states|us only|\busa\b/.test(lower)) locNote = "US-based";
  else if (/\buk\b|united kingdom/.test(lower)) locNote = "UK-based";
  else if (/\bcanada\b/.test(lower)) locNote = "Canada-based";
  if (/\bpst\b/.test(lower)) locNote = "PST timezone preferred";
  else if (/\best\b/.test(lower)) locNote = "EST timezone preferred";
  // Compensation
  let comp = "Not disclosed"; let compNote = "Check job posting";
  const salMatch = text.match(/\$[\d,]+k?[\s]*[-–][\s]*\$[\d,]+k?/i) || text.match(/[\d]+k\s*[-–]\s*[\d]+k/i);
  if (salMatch) { comp = salMatch[0].replace(/\s+/g, " "); compNote = "Listed salary range"; }
  else if (/competitive/i.test(text)) { comp = "Competitive"; compNote = "Exact range not disclosed"; }
  // Culture
  const vibes: string[] = [];
  if (/fast.paced/.test(lower)) vibes.push("Fast-paced");
  if (/startup/.test(lower)) vibes.push("Startup");
  if (/autonomous|self.starter/.test(lower)) vibes.push("Autonomous");
  if (/collaborative/.test(lower)) vibes.push("Collaborative");
  if (/innovative/.test(lower)) vibes.push("Innovative");
  const selfCount = (lower.match(/self.?starter/g) || []).length;
  const cultureVibe = vibes.length > 0 ? vibes.slice(0, 2).join(", ") : "Standard";
  const cultureNote = selfCount > 0 ? `Mentions "self-starter" ${selfCount}x` : vibes.length > 0 ? `${vibes.length} culture signals` : "No strong culture signals";
  return { seniority, yearsNote, location, locNote, comp, compNote, cultureVibe, cultureNote };
}

export default function JDIndexPage() {
  const router = useRouter();
  const [jdText, setJdText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setJd = useTailoringStore((s) => s.setJd);
  const runAnalysis = useTailoringStore((s) => s.runAnalysis);
  const runTailoring = useTailoringStore((s) => s.runTailoring);
  const isAnalyzing = useTailoringStore((s) => s.isAnalyzing);
  const isTailoring = useTailoringStore((s) => s.isLoading);
  const atsScore = useTailoringStore((s) => s.atsScore);
  const matchedSkills = useTailoringStore((s) => s.matchedSkills);
  const missingSkills = useTailoringStore((s) => s.missingSkills);
  const sessionId = useTailoringStore((s) => s.sessionId);
  const storedJdText = useTailoringStore((s) => s.jdText);
  const storeResumeId = useResumeStore((s) => s.resumeId);
  const [tailorError, setTailorError] = useState<string | null>(null);
  const [interviewPrompt, setInterviewPrompt] = useState<{ jdTitle: string; sessionId: string } | null>(null);

  // Override: user wants to use a different resume for this analysis
  const [overrideMode, setOverrideMode] = useState<"none" | "upload" | "pick">("none");
  const [overrideResumeId, setOverrideResumeId] = useState<string | null>(null);
  const [overrideFile, setOverrideFile] = useState<File | null>(null);
  const [overrideDragging, setOverrideDragging] = useState(false);
  const [overrideUploading, setOverrideUploading] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const overrideFileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: learningItems = [] } = useQuery<LearningItem[]>({
    queryKey: ["learning"],
    queryFn: () => apiClient.getLearningItems(),
  });

  async function handleJdStatusChange(id: string, status: JDStatus) {
    const jd = jds.find((j) => j.id === id);
    queryClient.setQueryData<JobDescription[]>(["jds"], (list) =>
      list?.map((j) => (j.id === id ? { ...j, status } : j))
    );
    try {
      await apiClient.updateJdStatus(id, status);
      // Only surface the "prepare for interview?" prompt on the transition
      // into Interview status, and only if there's actually a tailored
      // resume for this JD to prep from.
      if (status === "interview") {
        const { session_id } = await apiClient.getLatestJdSession(id);
        if (session_id) {
          setInterviewPrompt({ jdTitle: jd?.title ?? "this role", sessionId: session_id });
        }
      }
    } catch (err) {
      console.error("Failed to update JD status:", err);
      queryClient.invalidateQueries({ queryKey: ["jds"] });
    }
  }

  async function handleAddToLearningPath(skill: string) {
    const sourceTitle = (storedJdText || jdText).trim().split("\n")[0].slice(0, 120) || undefined;
    try {
      const item = await apiClient.addLearningItem({ skill, source_jd_title: sourceTitle });
      queryClient.setQueryData<LearningItem[]>(["learning"], (list) => [item, ...(list ?? [])]);
    } catch (err) {
      console.error("Failed to add to learning path:", err);
    }
  }

  // Resumes list (for pick mode)
  const { data: resumes = [] } = useQuery<Resume[]>({
    queryKey: ["resumes"],
    queryFn: () => apiClient.getResumes(),
    staleTime: 2 * 60 * 1000,
  });

  const { data: jds = [] } = useQuery<JobDescription[]>({
    queryKey: ["jds"],
    queryFn: () => apiClient.getJds(),
  });

  // Career profile — same query key as the profile page and Networking so a
  // profile save (which invalidates ["careerProfile"]) is reflected here too,
  // instead of this page only ever seeing what was loaded on mount.
  const { data: careerProfile, isLoading: profileLoading } = useQuery<CareerProfile | null>({
    queryKey: ["careerProfile"],
    queryFn: () => getCareerProfile(),
  });

  // Priority: manual override > career profile master resume > store resume
  const activeResumeId = overrideResumeId ?? careerProfile?.master_resume_id ?? storeResumeId;

  async function handleOverrideUpload() {
    if (!overrideFile) return;
    setOverrideUploading(true); setOverrideError(null);
    try {
      const resume = await apiClient.parseResumeFile(overrideFile, "ats_clean");
      await queryClient.invalidateQueries({ queryKey: ["resumes"] });
      setOverrideResumeId(resume.id);
      setOverrideMode("none");
      setOverrideFile(null);
    } catch (e: unknown) {
      setOverrideError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setOverrideUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!jdText.trim()) return;
    setIsSubmitting(true);
    setError(null);
    setTailorError(null);
    try {
      const firstLine = jdText.trim().split("\n")[0].slice(0, 120) || "Untitled JD";
      const jd = await apiClient.createJd({ title: firstLine, raw_text: jdText });
      // Use the local jdText we sent — don't rely on the backend echoing it back
      setJd(jd.id, jdText);
      if (activeResumeId) {
        // Read-only analysis only — this does NOT touch the resume. Tailoring
        // (which rewrites bullets and regenerates the PDF) is a separate,
        // explicit action via the "Tailor Resume" button once results are in.
        await runAnalysis(activeResumeId);
      } else {
        setError("Set up your profile first so we can compute your ATS match score.");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleTailor() {
    if (!activeResumeId) return;
    setTailorError(null);
    await runTailoring(activeResumeId);
    const err = useTailoringStore.getState().error;
    if (err) setTailorError(err);
  }

  const hasResults = atsScore !== null;
  // Gauge: 283 = full circle circumference (2π × 45). Offset for atsScore%.
  const gaugeOffset = hasResults ? 283 - (283 * atsScore) / 100 : 283;

  // Extract insights from the stored JD text when results are available
  const insights = hasResults && storedJdText ? extractInsights(storedJdText) : null;

  return (
    <div className="max-w-[1440px] mx-auto p-gutter pb-xxl flex flex-col gap-xl">
      {/* Page Header */}
      <section className="pt-xl pb-md flex flex-col md:flex-row md:items-end justify-between gap-md">
        <div>
          <h1 className="text-headline-xl text-on-surface mb-xs font-bold" style={{ letterSpacing: "-0.02em" }}>
            JD Analyzer
          </h1>
          <p className="text-body-lg text-on-surface-variant">
            Paste a job description to instantly analyze fit, extract key skills, and identify gaps.
          </p>
        </div>
      </section>

      {/* Profile status banner */}
      {!profileLoading && (
        <div className={`rounded-2xl border p-md flex items-center gap-md flex-wrap ${
          activeResumeId
            ? "bg-primary/5 border-primary/20"
            : "bg-surface-container border-outline-variant/20"
        }`}>
          {activeResumeId ? (
            <>
              <CheckCircle size={20} weight="fill" className="text-primary shrink-0" />
              <p className="text-label-md text-on-surface flex-1">
                {overrideResumeId
                  ? "Analyzing against uploaded resume"
                  : careerProfile?.master_resume_id
                  ? "Analyzing against your saved profile"
                  : "Analyzing against your resume"}
              </p>
              {overrideResumeId ? (
                <button onClick={() => { setOverrideResumeId(null); setOverrideMode("none"); }}
                  className="text-label-sm text-primary hover:underline shrink-0">
                  Revert to profile
                </button>
              ) : (
                <button onClick={() => setOverrideMode(overrideMode === "none" ? "pick" : "none")}
                  className="text-label-sm text-primary hover:underline shrink-0">
                  Use a different resume
                </button>
              )}
            </>
          ) : (
            <>
              <WarningCircle size={20} className="text-on-surface-variant shrink-0" />
              <p className="text-label-md text-on-surface-variant flex-1">
                No profile set — match score won&apos;t be computed.
              </p>
              <Link href="/profile"
                className="text-label-sm text-primary border border-primary/30 px-md py-xs rounded-lg hover:bg-primary/5 transition-all shrink-0">
                Set up Profile →
              </Link>
              <button onClick={() => setOverrideMode("upload")}
                className="text-label-sm text-on-surface-variant hover:text-primary transition-colors shrink-0">
                or upload a resume
              </button>
            </>
          )}
        </div>
      )}

      {/* Compact override panel */}
      {overrideMode !== "none" && !overrideResumeId && (
        <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-lg flex flex-col gap-md shadow-md">
          <div className="flex items-center justify-between">
            <p className="text-label-md text-on-surface font-semibold">
              {overrideMode === "upload" ? "Upload a resume" : "Pick a saved resume"}
            </p>
            <div className="flex gap-md">
              <button onClick={() => setOverrideMode(overrideMode === "upload" ? "pick" : "upload")}
                className="text-label-sm text-primary hover:underline">
                {overrideMode === "upload" ? "Pick existing instead" : "Upload instead"}
              </button>
              <button onClick={() => setOverrideMode("none")} className="text-on-surface-variant hover:text-error transition-colors">
                <X size={16} />
              </button>
            </div>
          </div>

          {overrideMode === "upload" && (
            <>
              <input ref={overrideFileRef} type="file" accept=".pdf,.docx,.doc" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) {
                  if (!f.name.match(/\.(pdf|docx|doc)$/i)) { setOverrideError("PDF or DOCX only"); return; }
                  setOverrideError(null); setOverrideFile(f);
                }}} />
              {overrideFile ? (
                <div className="flex items-center gap-md p-md rounded-xl border border-primary/30 bg-primary/5">
                  <UploadSimple size={20} className="text-primary shrink-0" />
                  <span className="flex-1 text-label-sm text-on-surface truncate">{overrideFile.name}</span>
                  <button onClick={() => setOverrideFile(null)} className="text-on-surface-variant hover:text-error transition-colors"><X size={14} /></button>
                </div>
              ) : (
                <div
                  onDragOver={e => { e.preventDefault(); setOverrideDragging(true); }}
                  onDragLeave={() => setOverrideDragging(false)}
                  onDrop={e => { e.preventDefault(); setOverrideDragging(false); const f = e.dataTransfer.files[0]; if (f) { setOverrideError(null); setOverrideFile(f); }}}
                  onClick={() => overrideFileRef.current?.click()}
                  className={`rounded-xl border-2 border-dashed p-lg flex items-center gap-lg cursor-pointer transition-all ${overrideDragging ? "border-primary bg-primary/5" : "border-outline-variant/40 hover:border-primary/40"}`}
                >
                  <UploadSimple size={24} className="text-on-surface-variant/50" />
                  <div className="flex-1">
                    <p className="text-label-sm text-on-surface font-semibold">Drop resume here</p>
                    <p className="text-caption text-on-surface-variant">PDF or DOCX · up to 10 MB</p>
                  </div>
                  <span className="text-label-sm text-primary border border-primary/30 rounded-lg px-md py-sm">Browse</span>
                </div>
              )}
              {overrideError && <p className="text-caption text-error">{overrideError}</p>}
              <button onClick={handleOverrideUpload} disabled={!overrideFile || overrideUploading}
                className="w-full py-sm rounded-xl text-label-sm text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-md hover:shadow-lg hover:scale-[0.98] active:scale-95 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100">
                {overrideUploading ? "Parsing…" : "Use this resume"}
              </button>
            </>
          )}

          {overrideMode === "pick" && (
            <div className="flex flex-col gap-sm">
              {resumes.length === 0 ? (
                <p className="text-body-sm text-on-surface-variant text-center py-md">No saved resumes. Upload one instead.</p>
              ) : resumes.map(r => (
                <button key={r.id} onClick={() => { setOverrideResumeId(r.id); setOverrideMode("none"); }}
                  className="flex items-center gap-md p-md rounded-xl border border-outline-variant/30 hover:border-primary/40 hover:bg-surface-container/50 transition-all text-left">
                  <UploadSimple size={18} className="text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-label-sm text-on-surface font-semibold truncate">{r.title}</p>
                    <p className="text-caption text-on-surface-variant">{new Date(r.updated_at).toLocaleDateString()}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bento Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-gutter">
        {/* Input Area — 2 cols */}
        <div className="lg:col-span-2 flex flex-col gap-md bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 hover:shadow-xl hover:shadow-on-surface/10 transition-shadow relative overflow-hidden">
          <div className="flex justify-between items-center mb-xs">
            <h2 className="text-headline-md text-on-surface flex items-center gap-sm font-semibold">
              <ClipboardText size={24} className="text-primary" />
              Job Description Input
            </h2>
            <button className="p-xs rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container-high/40 transition-all duration-300">
              <ListDashes size={20} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-md flex-1">
            <div className="relative flex-1 min-h-[300px]">
              <textarea
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                className="w-full h-full p-md bg-surface-container-lowest/50 border border-outline-variant/50 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary resize-none text-body-sm text-on-surface placeholder:text-on-surface-variant/60 outline-none min-h-[300px]"
                placeholder={`Paste the full job description here...\n\ne.g., 'Looking for a Senior Product Designer with 5+ years of experience in Figma, design systems, and user testing...'`}
              />
            </div>
            {error && <p className="text-body-sm text-error">{error}</p>}
            <button
              type="submit"
              disabled={isSubmitting || !jdText.trim()}
              className="w-full py-md text-label-md text-on-primary rounded-xl bg-gradient-to-b from-primary to-[#000840] shadow-[0_4px_12px_rgba(0,10,86,0.3)] hover:shadow-[0_8px_20px_rgba(0,10,86,0.4)] hover:scale-[0.98] active:scale-95 transition-all duration-300 flex items-center justify-center gap-sm mt-auto disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
            >
              <MagnifyingGlass size={20} />
              {isSubmitting ? "Analyzing…" : "Analyze Description"}
            </button>
          </form>

          {hasResults && (
            <div className="flex flex-col gap-xs">
              {tailorError && <p className="text-body-sm text-error">{tailorError}</p>}
              <button
                type="button"
                onClick={handleTailor}
                disabled={isTailoring || !activeResumeId}
                className="w-full py-md text-label-md text-on-primary rounded-xl bg-gradient-to-b from-success-accent to-success-accent/80 shadow-md hover:shadow-lg hover:scale-[0.98] active:scale-95 transition-all duration-300 flex items-center justify-center gap-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
              >
                <Sparkle size={20} />
                {isTailoring ? "Tailoring resume…" : sessionId ? "Re-tailor Resume" : "Tailor Resume"}
              </button>
              {sessionId && !isTailoring && (
                <p className="text-caption text-on-surface-variant text-center">
                  Resume tailored and saved — check Resume Builder for the updated PDF.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Match Gauge — 1 col */}
        <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 hover:shadow-xl hover:shadow-on-surface/10 transition-shadow flex flex-col items-center justify-center gap-md relative overflow-hidden">
          <div className="absolute top-lg left-lg">
            <h2 className="text-headline-md text-on-surface flex items-center gap-sm font-semibold">
              <Target size={24} className="text-primary" />
              Profile Match
            </h2>
          </div>
          <div className="relative w-48 h-48 mt-xl">
            <svg className="w-full h-full" style={{ transform: "rotate(-90deg)" }} viewBox="0 0 100 100">
              <circle cx="50" cy="50" fill="none" r="45" stroke="#eaedff" strokeWidth="8" />
              <circle
                cx="50"
                cy="50"
                fill="none"
                r="45"
                stroke="#000a56"
                strokeLinecap="round"
                strokeWidth="8"
                strokeDasharray="283"
                strokeDashoffset={gaugeOffset}
                style={{ transition: "stroke-dashoffset 1.5s ease-out" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-headline-xl text-primary font-bold">
                {hasResults ? `${atsScore}%` : "—"}
              </span>
              <span className="text-label-sm text-on-surface-variant uppercase tracking-wider">
                {hasResults
                  ? atsScore >= 80
                    ? "Strong Fit"
                    : atsScore >= 60
                    ? "Good Fit"
                    : "Needs Work"
                  : "Paste JD"}
              </span>
            </div>
          </div>
          <p className="text-body-sm text-on-surface-variant text-center px-md mt-sm">
            {hasResults
              ? "Your profile aligns with the core requirements. Focus on bridging the skill gaps."
              : "Paste a job description and analyze to see your match score."}
          </p>
        </div>

        {/* Skill Breakdown — 3 cols */}
        <div className="lg:col-span-3 bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 hover:shadow-xl hover:shadow-on-surface/10 transition-shadow flex flex-col gap-md relative overflow-hidden">
          <h2 className="text-headline-md text-on-surface flex items-center gap-sm mb-xs font-semibold">
            <ListChecks size={24} className="text-primary" />
            Skill Breakdown
          </h2>

          {hasResults ? (
            <>
              {matchedSkills.length > 0 && (
                <div className="flex flex-col gap-sm">
                  <h3 className="text-label-md text-on-surface-variant flex items-center gap-xs">
                    <CheckCircle size={16} className="text-success-accent" />
                    Matched Skills ({matchedSkills.length})
                  </h3>
                  <div className="flex flex-wrap gap-xs">
                    {matchedSkills.map((skill) => (
                      <span
                        key={skill}
                        className="px-sm py-xs bg-surface-container text-on-surface text-label-sm rounded-md border border-outline-variant/30"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {matchedSkills.length > 0 && missingSkills.length > 0 && (
                <div className="w-full h-px bg-outline-variant/30 my-sm" />
              )}

              {missingSkills.length > 0 && (
                <div className="flex flex-col gap-sm">
                  <h3 className="text-label-md text-on-surface-variant flex items-center gap-xs">
                    <WarningCircle size={16} className="text-error" />
                    Missing Skills ({missingSkills.length})
                  </h3>
                  <div className="flex flex-wrap gap-xs">
                    {missingSkills.map((skill) => {
                      const alreadyAdded = learningItems.some(
                        (li) => li.skill.toLowerCase() === skill.toLowerCase()
                      );
                      return (
                        <span
                          key={skill}
                          className="px-sm py-xs bg-error-container/30 text-error text-label-sm rounded-md border border-error/20 flex items-center gap-xs"
                        >
                          {skill}
                          <button
                            type="button"
                            onClick={() => !alreadyAdded && handleAddToLearningPath(skill)}
                            disabled={alreadyAdded}
                            aria-label={alreadyAdded ? "Already in learning path" : "Add to learning path"}
                            className="flex items-center"
                          >
                            {alreadyAdded ? (
                              <CheckCircle size={14} className="text-success-accent" />
                            ) : (
                              <PlusCircle size={14} className="cursor-pointer hover:text-error/70" />
                            )}
                          </button>
                        </span>
                      );
                    })}
                  </div>
                  <p className="text-caption text-on-surface-variant mt-xs italic">
                    Tip: Click &apos;+&apos; to add missing skills to your Learning Path.
                  </p>
                </div>
              )}

              {matchedSkills.length === 0 && missingSkills.length === 0 && (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-body-sm text-on-surface-variant text-center">
                    No skill data returned from the analysis.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-body-sm text-on-surface-variant text-center">
                Analyze a job description to see matched and missing skills.
              </p>
            </div>
          )}
        </div>

        {/* Quick Scan — full width. Plain keyword matching against the JD
            text, not an AI call — labeled accordingly so it doesn't read
            as equally authoritative as the ATS score above, which is. */}
        {hasResults && insights && (
          <div className="lg:col-span-4 bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 hover:shadow-xl hover:shadow-on-surface/10 transition-shadow">
            <div className="flex items-center justify-between mb-md">
              <h2 className="text-headline-md text-on-surface flex items-center gap-sm font-semibold">
                <Lightbulb size={24} className="text-primary" />
                Quick Scan
              </h2>
              <span className="text-caption text-on-surface-variant uppercase tracking-wider">
                Keyword-based, not AI-verified
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-md">
              <div className="bg-surface-container-lowest p-md rounded-xl border border-outline-variant/30 flex items-start gap-md">
                <div className="w-10 h-10 bg-surface-container rounded-lg text-primary flex items-center justify-center shrink-0">
                  <Briefcase size={20} />
                </div>
                <div>
                  <h4 className="text-label-sm text-on-surface-variant uppercase tracking-wider mb-xs">Seniority</h4>
                  <p className="text-body-md text-on-surface font-medium">{insights.seniority}</p>
                  <p className="text-caption text-on-surface-variant mt-1">{insights.yearsNote || "No year req. found"}</p>
                </div>
              </div>
              <div className="bg-surface-container-lowest p-md rounded-xl border border-outline-variant/30 flex items-start gap-md">
                <div className="w-10 h-10 bg-surface-container rounded-lg text-primary flex items-center justify-center shrink-0">
                  <MapPin size={20} />
                </div>
                <div>
                  <h4 className="text-label-sm text-on-surface-variant uppercase tracking-wider mb-xs">Location</h4>
                  <p className="text-body-md text-on-surface font-medium">{insights.location}</p>
                  <p className="text-caption text-on-surface-variant mt-1">{insights.locNote || "No region specified"}</p>
                </div>
              </div>
              <div className="bg-surface-container-lowest p-md rounded-xl border border-outline-variant/30 flex items-start gap-md">
                <div className="w-10 h-10 bg-surface-container rounded-lg text-primary flex items-center justify-center shrink-0">
                  <Money size={20} />
                </div>
                <div>
                  <h4 className="text-label-sm text-on-surface-variant uppercase tracking-wider mb-xs">Compensation</h4>
                  <p className="text-body-md text-on-surface font-medium">{insights.comp}</p>
                  <p className="text-caption text-on-surface-variant mt-1">{insights.compNote}</p>
                </div>
              </div>
              <div className="bg-surface-container-lowest p-md rounded-xl border border-outline-variant/30 flex items-start gap-md">
                <div className="w-10 h-10 bg-surface-container rounded-lg text-primary flex items-center justify-center shrink-0">
                  <Brain size={20} />
                </div>
                <div>
                  <h4 className="text-label-sm text-on-surface-variant uppercase tracking-wider mb-xs">Key Vibe</h4>
                  <p className="text-body-md text-on-surface font-medium">{insights.cultureVibe}</p>
                  <p className="text-caption text-on-surface-variant mt-1">{insights.cultureNote}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Previous Analyses — always shown below bento grid */}
      {jds.length > 0 && (
        <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 hover:shadow-xl hover:shadow-on-surface/10 transition-shadow">
          <h2 className="text-headline-md text-on-surface flex items-center gap-sm mb-md font-semibold">
            <Lightbulb size={24} className="text-primary" />
            Previous Analyses
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-md">
            {jds.map((jd) => (
              <div
                key={jd.id}
                className="p-md rounded-xl border border-outline-variant/20 hover:border-primary/40 hover:bg-surface-container transition-all flex flex-col gap-sm"
              >
                <button onClick={() => router.push(`/jd/${jd.id}`)} className="text-left">
                  <p className="text-label-md text-on-surface truncate">{jd.title}</p>
                  <p className="text-caption text-on-surface-variant mt-xs">
                    {new Date(jd.created_at).toLocaleDateString()} · Click to view analysis
                  </p>
                </button>
                <select
                  value={jd.status}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => handleJdStatusChange(jd.id, e.target.value as JDStatus)}
                  className="w-full px-sm py-xs rounded-lg text-caption font-semibold bg-surface-container border border-outline-variant/30 text-on-surface-variant cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {jds.length === 0 && !hasResults && (
        <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 flex items-center justify-center py-xl text-center">
          <div>
            <p className="text-body-md text-on-surface font-medium mb-xs">No analyses yet</p>
            <p className="text-body-sm text-on-surface-variant">Paste a job description above to get started.</p>
          </div>
        </div>
      )}

      {/* Prompted only on the transition into Interview status — not on every
          tailoring run — since that's the moment prep actually becomes relevant. */}
      {interviewPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-gutter">
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-2xl p-xl max-w-[26rem] w-full flex flex-col items-center text-center gap-md">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <Calendar size={28} className="text-primary" />
            </div>
            <div>
              <p className="text-headline-md text-on-surface font-bold mb-xs">You&rsquo;re in! 🎉</p>
              <p className="text-body-sm text-on-surface-variant">
                {interviewPrompt.jdTitle} moved to Interview. Want to prepare now?
              </p>
            </div>
            <div className="flex gap-sm w-full">
              <button
                onClick={() => setInterviewPrompt(null)}
                className="flex-1 py-sm rounded-xl text-label-md text-on-surface-variant border border-outline-variant hover:bg-surface-container-low transition-colors"
              >
                Later
              </button>
              <button
                onClick={() => router.push(`/interview/${interviewPrompt.sessionId}`)}
                className="flex-1 py-sm rounded-xl text-label-md text-on-primary bg-gradient-to-b from-primary to-primary-container shadow-md hover:shadow-lg transition-all"
              >
                Prepare Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
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
} from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import { useTailoringStore } from "@/stores/tailoring-store";
import { useResumeStore } from "@/stores/resume-store";
import type { JobDescription } from "@career-copilot/types";

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
  const runTailoring = useTailoringStore((s) => s.runTailoring);
  const atsScore = useTailoringStore((s) => s.atsScore);
  const matchedSkills = useTailoringStore((s) => s.matchedSkills);
  const missingSkills = useTailoringStore((s) => s.missingSkills);
  const storedJdText = useTailoringStore((s) => s.jdText);
  const resumeId = useResumeStore((s) => s.resumeId);

  const { data: jds = [] } = useQuery<JobDescription[]>({
    queryKey: ["jds"],
    queryFn: () => apiClient.getJds(),
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!jdText.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const firstLine = jdText.trim().split("\n")[0].slice(0, 120) || "Untitled JD";
      const jd = await apiClient.createJd({ title: firstLine, raw_text: jdText });
      // Use the local jdText we sent — don't rely on the backend echoing it back
      setJd(jd.id, jdText);
      if (resumeId) {
        await runTailoring(resumeId);
      } else {
        setError("JD saved! Open a resume in Resume Builder first so we can tailor it and compute your ATS score.");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
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

        {/* Skill Breakdown — 1 col */}
        <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 hover:shadow-xl hover:shadow-on-surface/10 transition-shadow flex flex-col gap-md relative overflow-hidden">
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
                    {missingSkills.map((skill) => (
                      <span
                        key={skill}
                        className="px-sm py-xs bg-error-container/30 text-error text-label-sm rounded-md border border-error/20 flex items-center gap-xs"
                      >
                        {skill}
                        <PlusCircle size={14} className="cursor-pointer hover:text-error/70" aria-label="Add to learning path" />
                      </span>
                    ))}
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

        {/* Extracted Insights — full width */}
        {hasResults && insights && (
          <div className="lg:col-span-4 bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 hover:shadow-xl hover:shadow-on-surface/10 transition-shadow">
            <h2 className="text-headline-md text-on-surface flex items-center gap-sm mb-md font-semibold">
              <Lightbulb size={24} className="text-primary" />
              Extracted Job Insights
            </h2>
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
              <button
                key={jd.id}
                onClick={() => router.push(`/jd/${jd.id}`)}
                className="text-left p-md rounded-xl border border-outline-variant/20 hover:border-primary/40 hover:bg-surface-container transition-all"
              >
                <p className="text-label-md text-on-surface truncate">{jd.title}</p>
                <p className="text-caption text-on-surface-variant mt-xs">
                  {new Date(jd.created_at).toLocaleDateString()} · Click to view analysis
                </p>
              </button>
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
    </div>
  );
}

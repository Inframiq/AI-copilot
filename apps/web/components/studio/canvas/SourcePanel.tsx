"use client";
import { CheckCircle, Sparkle } from "@phosphor-icons/react";
import { useResumeStore } from "@/stores/resume-store";
import { useTailoringStore } from "@/stores/tailoring-store";

// The canvas surface behind the spine's "Source" and "Match" nodes.
//
// Ported from components/resume/EditorPanel.tsx — both of the ways that
// panel let a user start AI tailoring, which the redesigned canvas would
// otherwise have dropped entirely:
//
//   • the JD-context form (its `TailoringForm` sub-component), shown when
//     the user arrived from the JD Analyzer with a saved JD (`jdId` set):
//     ATS context and the target company;
//   • the manual-paste form (EditorPanel's `jdId`-unset branch): target
//     company plus a textarea for a job description pasted right here.
//
// Every store call and argument is carried over verbatim. The one control
// deliberately left behind is HumanizeSlider: per-bullet Humanize in the
// triage deck is the single model for that knob now, so `humanizeLevel`
// simply keeps the tailoring store's default.
export function SourcePanel() {
  const resumeId = useResumeStore((s) => s.resumeId);

  const jdId = useTailoringStore((s) => s.jdId);
  const jdText = useTailoringStore((s) => s.jdText);
  const setJd = useTailoringStore((s) => s.setJd);
  const companyName = useTailoringStore((s) => s.companyName);
  const setCompanyName = useTailoringStore((s) => s.setCompanyName);
  const atsScore = useTailoringStore((s) => s.atsScore);
  const matchedSkills = useTailoringStore((s) => s.matchedSkills);
  const runTailoring = useTailoringStore((s) => s.runTailoring);
  const isLoading = useTailoringStore((s) => s.isLoading);
  const error = useTailoringStore((s) => s.error);

  const hasJdContext = !!jdId;

  function handleTailor() {
    if (resumeId) runTailoring(resumeId);
  }

  const companyField = (
    <div className="flex flex-col gap-xs">
      <label
        htmlFor="source-company"
        className="flex items-center gap-xs text-label-caps text-on-surface-variant"
      >
        Target Company
        <span className="rounded-full bg-secondary-container px-xs py-xs text-caption font-semibold text-on-secondary-container">
          optional
        </span>
      </label>
      <input
        id="source-company"
        type="text"
        value={companyName}
        onChange={(e) => setCompanyName(e.target.value)}
        placeholder="e.g. Google, Stripe, Amazon…"
        maxLength={200}
        className="w-full rounded-xl border border-outline-variant/50 bg-surface px-md py-sm text-body-md text-on-surface transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    </div>
  );

  const runButton = (
    <div className="flex flex-col gap-sm">
      <button
        type="button"
        onClick={handleTailor}
        disabled={isLoading || !resumeId || (!hasJdContext && !jdText.trim())}
        className="flex w-full items-center justify-center gap-sm rounded-xl bg-primary py-md text-label-md text-on-primary shadow-md transition-all hover:shadow-lg active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Sparkle size={18} />
        {isLoading ? "Tailoring your resume…" : "Tailor Resume"}
      </button>

      {isLoading && (
        <p className="text-center text-caption text-on-surface-variant">
          AI is rewriting your bullets — this can take up to a couple of minutes…
        </p>
      )}
      {!isLoading && error && <p className="text-center text-caption text-error">{error}</p>}
    </div>
  );

  return (
    <section className="flex flex-col gap-lg rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-xl shadow-sm">
      <div className="flex flex-col gap-xs">
        <h2 className="text-label-caps text-on-surface-variant">
          {hasJdContext ? "Tailor to this job description" : "Tailor to a job description"}
        </h2>
        <p className="text-body-md text-on-surface-variant">
          {hasJdContext
            ? "Your resume's bullets get rewritten against this JD's keywords, weighted toward anything you flag below."
            : "Paste the job posting you're applying to — AI rewrites your bullets to match it, then you review every change."}
        </p>
      </div>

      {hasJdContext ? (
        <>
          {/* ATS context — only once the JD Analyzer has actually scored a match. */}
          {atsScore !== null && (
            <div className="flex items-center gap-lg rounded-xl border border-outline-variant/30 bg-surface-container-low p-lg">
              <div className="shrink-0 text-center">
                <div
                  className={`tabular text-headline-md font-bold ${
                    atsScore >= 80 ? "text-success" : atsScore >= 60 ? "text-primary" : "text-error"
                  }`}
                >
                  {atsScore}%
                </div>
                <p className="text-caption text-on-surface-variant">ATS Match</p>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-xs">
                  {matchedSkills.slice(0, 5).map((s) => (
                    <span
                      key={s}
                      className="flex items-center gap-xs rounded-md border border-success/25 bg-success/10 px-sm py-xs text-caption text-on-surface"
                    >
                      <CheckCircle size={11} weight="fill" className="shrink-0 text-success" />
                      {s}
                    </span>
                  ))}
                  {matchedSkills.length > 5 && (
                    <span className="text-caption text-on-surface-variant">
                      +{matchedSkills.length - 5} more
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {companyField}
          {runButton}
        </>
      ) : (
        <>
          {companyField}
          {companyName.trim() && (
            <p className="text-caption text-on-surface-variant">
              AI will extract {companyName.trim()}&apos;s culture keywords, tech preferences, and ATS
              filter phrases to further optimise your resume.
            </p>
          )}

          <div className="flex flex-col gap-xs">
            <label htmlFor="source-jd" className="text-label-caps text-on-surface-variant">
              Job Description
            </label>
            <textarea
              id="source-jd"
              value={jdText}
              onChange={(e) => setJd("", e.target.value)}
              placeholder="Paste the job description here — AI will rewrite your bullets to match it…"
              rows={10}
              className="w-full resize-none rounded-xl border border-outline-variant/50 bg-surface px-md py-md text-body-md leading-relaxed text-on-surface transition-all focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {runButton}
        </>
      )}
    </section>
  );
}

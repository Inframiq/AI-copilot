"use client";
import { useState } from "react";
import { useTailoringStore } from "@/stores/tailoring-store";
import { CheckCircle, XCircle, ArrowCounterClockwise } from "@phosphor-icons/react";
import { ImportanceBadge } from "./ImportanceBadge";

export function SkillsDelta() {
  const { atsScore, matchedSkills, missingSkills, jdImportance } = useTailoringStore();

  // Track skills the user has manually dismissed from each list.
  const [removedMatched, setRemovedMatched] = useState<Set<string>>(new Set());
  const [removedMissing, setRemovedMissing] = useState<Set<string>>(new Set());

  if (atsScore === null) return null;

  const visibleMatched = matchedSkills.filter((s) => !removedMatched.has(s));
  const visibleMissing = missingSkills.filter((s) => !removedMissing.has(s));
  const hiddenMatched = matchedSkills.filter((s) => removedMatched.has(s));
  const hiddenMissing = missingSkills.filter((s) => removedMissing.has(s));
  const hasHidden = hiddenMatched.length > 0 || hiddenMissing.length > 0;

  function removeMatched(skill: string) {
    setRemovedMatched((prev) => new Set([...prev, skill]));
  }
  function removeMissing(skill: string) {
    setRemovedMissing((prev) => new Set([...prev, skill]));
  }
  function restoreMatched(skill: string) {
    setRemovedMatched((prev) => { const n = new Set(prev); n.delete(skill); return n; });
  }
  function restoreMissing(skill: string) {
    setRemovedMissing((prev) => { const n = new Set(prev); n.delete(skill); return n; });
  }

  return (
    <div className="flex flex-col gap-md">
      <div className="flex items-center justify-between">
        <span className="text-label-md text-on-surface-variant">ATS Score</span>
        <span className="text-headline-md text-primary font-bold">{atsScore}%</span>
      </div>

      {matchedSkills.length > 0 && (
        <div>
          <p className="text-label-sm text-on-surface-variant mb-sm">
            Matched
            <span className="ml-xs text-caption opacity-60">· click to dismiss</span>
          </p>
          <div className="flex flex-wrap gap-sm">
            {visibleMatched.map((s) => (
              <button
                key={s}
                onClick={() => removeMatched(s)}
                title="Click to dismiss"
                className="group flex items-center gap-xs px-sm py-xs rounded-full bg-[#e6f4ea] text-[#1e7e34] text-label-sm hover:bg-[#c8e6c9] transition-colors"
              >
                <CheckCircle size={12} weight="fill" className="group-hover:hidden" />
                <XCircle size={12} weight="fill" className="hidden group-hover:block text-[#c62828]" />
                {s}
                {jdImportance[s.toLowerCase()] && (
                  <ImportanceBadge level={jdImportance[s.toLowerCase()]} className="ml-xs" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {missingSkills.length > 0 && (
        <div>
          <p className="text-label-sm text-on-surface-variant mb-sm">
            Missing
            <span className="ml-xs text-caption opacity-60">· click to dismiss</span>
          </p>
          <div className="flex flex-wrap gap-sm">
            {visibleMissing.map((s) => (
              <button
                key={s}
                onClick={() => removeMissing(s)}
                title="Click to dismiss"
                className="group flex items-center gap-xs px-sm py-xs rounded-full bg-error-container text-on-error-container text-label-sm hover:opacity-70 transition-opacity"
              >
                <XCircle size={12} weight="fill" className="group-hover:hidden" />
                <XCircle size={12} weight="fill" className="hidden group-hover:block opacity-40" />
                {s}
                {jdImportance[s.toLowerCase()] && (
                  <ImportanceBadge level={jdImportance[s.toLowerCase()]} className="ml-xs" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Dismissed skills — restore section */}
      {hasHidden && (
        <div className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-md flex flex-col gap-sm">
          <p className="text-label-sm text-on-surface-variant flex items-center gap-xs">
            <ArrowCounterClockwise size={13} />
            Dismissed — click to restore
          </p>
          <div className="flex flex-wrap gap-sm">
            {hiddenMatched.map((s) => (
              <button
                key={s}
                onClick={() => restoreMatched(s)}
                title="Restore to Matched"
                className="flex items-center gap-xs px-sm py-xs rounded-full bg-surface-container text-on-surface-variant text-label-sm border border-dashed border-[#1e7e34]/40 hover:bg-[#e6f4ea] hover:text-[#1e7e34] transition-colors"
              >
                <CheckCircle size={12} weight="regular" />
                {s}
              </button>
            ))}
            {hiddenMissing.map((s) => (
              <button
                key={s}
                onClick={() => restoreMissing(s)}
                title="Restore to Missing"
                className="flex items-center gap-xs px-sm py-xs rounded-full bg-surface-container text-on-surface-variant text-label-sm border border-dashed border-error/40 hover:bg-error-container hover:text-on-error-container transition-colors"
              >
                <XCircle size={12} weight="regular" />
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

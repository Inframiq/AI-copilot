"use client";
import { useTailoringStore } from "@/stores/tailoring-store";
import { CheckCircle, XCircle } from "@phosphor-icons/react";

export function SkillsDelta() {
  const { atsScore, matchedSkills, missingSkills } = useTailoringStore();

  if (atsScore === null) return null;

  return (
    <div className="flex flex-col gap-md">
      <div className="flex items-center justify-between">
        <span className="text-label-md text-on-surface-variant">ATS Score</span>
        <span className="text-headline-md text-primary font-bold">{atsScore}%</span>
      </div>

      {matchedSkills.length > 0 && (
        <div>
          <p className="text-label-sm text-on-surface-variant mb-sm">Matched</p>
          <div className="flex flex-wrap gap-sm">
            {matchedSkills.map((s) => (
              <span
                key={s}
                className="flex items-center gap-xs px-sm py-xs rounded-full bg-[#e6f4ea] text-[#1e7e34] text-label-sm"
              >
                <CheckCircle size={12} weight="fill" />
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {missingSkills.length > 0 && (
        <div>
          <p className="text-label-sm text-on-surface-variant mb-sm">Missing</p>
          <div className="flex flex-wrap gap-sm">
            {missingSkills.map((s) => (
              <span
                key={s}
                className="flex items-center gap-xs px-sm py-xs rounded-full bg-error-container text-on-error-container text-label-sm"
              >
                <XCircle size={12} weight="fill" />
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

"use client";
import { ArrowDown, ArrowUp, Trash } from "@phosphor-icons/react";
import type { WorkProject } from "@career-copilot/types";
import { SuggestInput } from "@/components/ui/SuggestInput";
import { MonthYearField } from "@/components/ui/MonthYearPicker";
import { LinesTextarea } from "./LinesTextarea";
import { projectLine } from "@/lib/work-projects";

const inputCls =
  "w-full px-sm py-xs rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-body-md focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all";
const iconBtn =
  "w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container disabled:opacity-30 disabled:cursor-not-allowed transition-colors";

/**
 * The projects inside one experience entry, in the Builder. Every field is
 * optional but the points: a client and a domain matter mostly at services
 * companies. Name and technologies are kept for the profile and tailoring;
 * the résumé prints the short line, the dates and the points.
 */
export function JobProjects({ entryIndex, projects, onChange }: {
  entryIndex: number;
  projects: WorkProject[];
  onChange: (projects: WorkProject[]) => void;
}) {
  const set = (i: number, patch: Partial<WorkProject>) =>
    onChange(projects.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...projects];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-sm">
      <div className="flex items-baseline justify-between gap-sm">
        <span className="text-label-sm text-on-surface-variant">Projects</span>
        {projects.length === 0 && (
          <span className="text-caption text-on-surface-variant">Optional — one per client or project.</span>
        )}
      </div>
      {projects.map((p, i) => {
        const id = `builder-exp-${entryIndex}-project-${i}`;
        const line = projectLine(p);
        return (
          <div key={i} className="rounded-xl border border-outline-variant/30 bg-surface-container-low/40 p-md flex flex-col gap-sm">
            <div className="flex items-center gap-xs">
              <span className="text-label-sm font-semibold text-on-surface truncate flex-1">
                {line || `Project ${i + 1}`}
              </span>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move project ${i + 1} up`} className={iconBtn}>
                <ArrowUp size={14} />
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === projects.length - 1} aria-label={`Move project ${i + 1} down`} className={iconBtn}>
                <ArrowDown size={14} />
              </button>
              <button type="button" onClick={() => onChange(projects.filter((_, idx) => idx !== i))}
                aria-label={`Remove project ${i + 1}`} className={`${iconBtn} hover:text-error`}>
                <Trash size={14} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-sm">
              <div className="flex flex-col gap-xs">
                <label htmlFor={`${id}-client`} className="text-caption text-on-surface-variant">Client</label>
                <input id={`${id}-client`} value={p.client ?? ""} onChange={(e) => set(i, { client: e.target.value })}
                  placeholder="Barclays, or a leading US bank" className={inputCls} />
              </div>
              <div className="flex flex-col gap-xs">
                <label htmlFor={`${id}-name`} className="text-caption text-on-surface-variant">Project name</label>
                <input id={`${id}-name`} value={p.name ?? ""} onChange={(e) => set(i, { name: e.target.value })}
                  placeholder="Payments Hub" className={inputCls} />
              </div>
              <div className="flex flex-col gap-xs">
                <label htmlFor={`${id}-role`} className="text-caption text-on-surface-variant">Your role</label>
                <SuggestInput id={`${id}-role`} kind="jobTitle" value={p.role ?? ""} onValueChange={(role) => set(i, { role })}
                  placeholder="Module Lead" className={inputCls} />
              </div>
              <div className="flex flex-col gap-xs">
                <label htmlFor={`${id}-domain`} className="text-caption text-on-surface-variant">Domain</label>
                <SuggestInput id={`${id}-domain`} kind="domain" value={p.domain ?? ""} onValueChange={(domain) => set(i, { domain })}
                  placeholder="Banking" className={inputCls} />
              </div>
              <div className="flex flex-col gap-xs">
                <label htmlFor={`${id}-start`} className="text-caption text-on-surface-variant">Start</label>
                <MonthYearField id={`${id}-start`} label="Project start" value={p.start ?? ""}
                  onChange={(start) => set(i, { start })} placeholder="Jan 2022" className={inputCls} />
              </div>
              <div className="flex flex-col gap-xs">
                <label htmlFor={`${id}-end`} className="text-caption text-on-surface-variant">End</label>
                <MonthYearField id={`${id}-end`} label="Project end" value={p.end ?? ""} start={p.start} allowPresent
                  onChange={(end) => set(i, { end })} placeholder="Present" className={inputCls} />
              </div>
              <div className="col-span-2 flex flex-col gap-xs">
                <label htmlFor={`${id}-tech`} className="text-caption text-on-surface-variant">Technologies</label>
                <SuggestInput id={`${id}-tech`} kind="skill" list value={p.tech_stack ?? ""} onValueChange={(tech_stack) => set(i, { tech_stack })}
                  placeholder="Java, Spring Boot, Kafka" className={inputCls} />
              </div>
              <div className="col-span-2 flex flex-col gap-xs">
                <label htmlFor={`${id}-points`} className="text-caption text-on-surface-variant">
                  Points <span className="font-normal">(one per line)</span>
                </label>
                <LinesTextarea id={`${id}-points`} lines={p.bullets ?? []} onChange={(bullets) => set(i, { bullets })}
                  placeholder={"Led the payments module for 12 developers\nCut settlement time by 30%"} />
              </div>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => onChange([...projects, { bullets: [] }])}
        className="self-start flex items-center gap-xs px-md py-xs rounded-full text-label-sm font-semibold text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
      >
        + Add project
      </button>
    </div>
  );
}

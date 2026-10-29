"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, CaretDown, Plus, Trash } from "@phosphor-icons/react";
import { SuggestInput } from "@/components/ui/SuggestInput";
import { MonthYearField } from "@/components/ui/MonthYearPicker";
import { blankWorkProject, workToResumeProject, type WorkProjectEntry } from "@/lib/career-profile-client";
import { projectLine } from "@/lib/work-projects";
import { inputCls, textareaCls } from "./ProfileFormParts";

const iconBtn =
  "w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-primary/10 hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors";
const labelCls = "text-caption text-on-surface-variant";

/**
 * The projects inside one experience entry on the Profile: one card per
 * client at a services company, or per project anywhere. Every field is
 * optional — a client and a domain matter mostly at services companies.
 * The Profile keeps all of it; a résumé prints the short line (client, or
 * else name · domain · role), the dates and the points.
 */
export function WorkProjects({ entryId, projects, onChange }: {
  entryId: string;
  projects: WorkProjectEntry[];
  onChange: (projects: WorkProjectEntry[]) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const set = (id: string, patch: Partial<WorkProjectEntry>) =>
    onChange(projects.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...projects];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  };
  const add = () => {
    const p = blankWorkProject();
    setOpen((o) => ({ ...o, [p.id]: true }));
    onChange([...projects, p]);
  };

  return (
    <div className="flex flex-col gap-sm">
      <div className="flex items-baseline justify-between gap-sm">
        <span className="text-label-sm text-on-surface-variant/90 font-semibold">Projects</span>
        <span className="text-caption text-on-surface-variant text-right">
          Optional — one per client or project
        </span>
      </div>
      {projects.map((p, i) => {
        const id = `${entryId}-project-${p.id}`;
        // A new card opens; a filled one starts folded to its line.
        const expanded = open[p.id] ?? !projectLine(workToResumeProject(p));
        const line = projectLine(workToResumeProject(p));
        return (
          <div key={p.id} className="rounded-xl border border-outline-variant/30 bg-surface-container-low/40">
            <div className="flex items-center gap-xs px-sm py-xs">
              <button type="button" onClick={() => setOpen((o) => ({ ...o, [p.id]: !expanded }))}
                aria-expanded={expanded} aria-controls={`${id}-body`}
                className="flex-1 min-w-0 flex items-center gap-xs text-left py-xs">
                <CaretDown size={14} className={`shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
                <span className="truncate text-label-sm font-semibold text-on-surface">{line || `Project ${i + 1}`}</span>
                {(p.start || p.end) && (
                  <span className="shrink-0 text-caption text-on-surface-variant">
                    {p.start}{p.start ? " – " : ""}{p.end || (p.start ? "Present" : "")}
                  </span>
                )}
              </button>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move project ${i + 1} up`} className={iconBtn}>
                <ArrowUp size={14} />
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === projects.length - 1} aria-label={`Move project ${i + 1} down`} className={iconBtn}>
                <ArrowDown size={14} />
              </button>
              <button type="button" onClick={() => onChange(projects.filter((x) => x.id !== p.id))}
                aria-label={`Remove project ${i + 1}`} className={`${iconBtn} hover:bg-error/10 hover:text-error`}>
                <Trash size={14} />
              </button>
            </div>
            {expanded && (
              <div id={`${id}-body`} className="grid grid-cols-2 gap-sm px-sm sm:px-md pb-sm sm:pb-md">
                <div className="flex flex-col gap-xs">
                  <label htmlFor={`${id}-client`} className={labelCls}>Client</label>
                  <input id={`${id}-client`} value={p.client} onChange={(e) => set(p.id, { client: e.target.value })}
                    placeholder="Barclays, or a leading US bank" className={inputCls} />
                </div>
                <div className="flex flex-col gap-xs">
                  <label htmlFor={`${id}-name`} className={labelCls}>Project name</label>
                  <input id={`${id}-name`} value={p.name} onChange={(e) => set(p.id, { name: e.target.value })}
                    placeholder="Payments Hub" className={inputCls} />
                </div>
                <div className="flex flex-col gap-xs">
                  <label htmlFor={`${id}-role`} className={labelCls}>Your role</label>
                  <SuggestInput id={`${id}-role`} kind="jobTitle" value={p.role} onValueChange={(role) => set(p.id, { role })}
                    placeholder="Module Lead" className={inputCls} />
                </div>
                <div className="flex flex-col gap-xs">
                  <label htmlFor={`${id}-domain`} className={labelCls}>Domain</label>
                  <SuggestInput id={`${id}-domain`} kind="domain" value={p.domain} onValueChange={(domain) => set(p.id, { domain })}
                    placeholder="Banking" className={inputCls} />
                </div>
                <div className="flex flex-col gap-xs">
                  <label htmlFor={`${id}-start`} className={labelCls}>Start</label>
                  <MonthYearField id={`${id}-start`} label="Project start" value={p.start}
                    onChange={(start) => set(p.id, { start })} placeholder="Jan 2022" className={inputCls} />
                </div>
                <div className="flex flex-col gap-xs">
                  <label htmlFor={`${id}-end`} className={labelCls}>End</label>
                  <MonthYearField id={`${id}-end`} label="Project end" value={p.end} start={p.start} allowPresent
                    onChange={(end) => set(p.id, { end })} placeholder="Present" className={inputCls} />
                </div>
                <div className="col-span-2 flex flex-col gap-xs">
                  <label htmlFor={`${id}-tech`} className={labelCls}>Technologies</label>
                  <SuggestInput id={`${id}-tech`} kind="skill" list value={p.techStack} onValueChange={(techStack) => set(p.id, { techStack })}
                    placeholder="Java, Spring Boot, Kafka" className={inputCls} />
                </div>
                <div className="col-span-2 flex flex-col gap-xs">
                  <label htmlFor={`${id}-resp`} className={labelCls}>Responsibilities</label>
                  <textarea id={`${id}-resp`} value={p.responsibilities} onChange={(e) => set(p.id, { responsibilities: e.target.value })}
                    rows={2} placeholder="Led the payments module for a team of 12…" className={textareaCls} />
                </div>
                <div className="flex flex-col gap-xs">
                  <label htmlFor={`${id}-ach`} className={labelCls}>Achievements</label>
                  <textarea id={`${id}-ach`} value={p.achievements} onChange={(e) => set(p.id, { achievements: e.target.value })}
                    rows={2} placeholder="Shipped settlement v2 a month early…" className={textareaCls} />
                </div>
                <div className="flex flex-col gap-xs">
                  <label htmlFor={`${id}-impact`} className={labelCls}>Impact</label>
                  <textarea id={`${id}-impact`} value={p.impact} onChange={(e) => set(p.id, { impact: e.target.value })}
                    rows={2} placeholder="Cut settlement time by 30%…" className={textareaCls} />
                </div>
              </div>
            )}
          </div>
        );
      })}
      <button type="button" onClick={add}
        className="self-start flex items-center gap-xs px-md py-xs rounded-full text-label-sm font-semibold text-primary bg-primary/5 hover:bg-primary/10 transition-colors">
        <Plus size={14} weight="bold" /> Add project
      </button>
    </div>
  );
}

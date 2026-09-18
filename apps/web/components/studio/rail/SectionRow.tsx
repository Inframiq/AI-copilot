"use client";
import type { SectionId, SectionState } from "@/lib/section-completeness";
import { CompletenessRing } from "./CompletenessRing";

export function SectionRow({
  state,
  isActive,
  entries,
  pendingChanges,
  collapsed,
  onSelect,
  onSelectEntry,
}: {
  state: SectionState;
  isActive: boolean;
  entries?: string[];
  pendingChanges?: number;
  collapsed?: boolean;
  onSelect: (id: SectionId) => void;
  onSelectEntry?: (id: SectionId, index: number) => void;
}) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-current={isActive ? "true" : undefined}
        title={collapsed ? state.label : undefined}
        aria-label={collapsed ? state.label : undefined}
        onClick={() => onSelect(state.id)}
        className={`relative flex items-center gap-sm px-sm py-sm rounded-lg text-left transition-colors ${
          collapsed ? "justify-center" : ""
        } ${
          isActive
            ? "bg-primary/8 text-on-surface font-semibold"
            : "text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
        }`}
      >
        <CompletenessRing ratio={state.ratio} />
        {!collapsed && (
          <span className="text-label-md flex-1 min-w-0 truncate">{state.label}</span>
        )}
        {!collapsed && !!pendingChanges && pendingChanges > 0 && (
          <span
            aria-label={`${pendingChanges} pending change${pendingChanges === 1 ? "" : "s"}`}
            className="tabular shrink-0 px-xs rounded-full bg-primary text-on-primary text-caption font-bold"
          >
            {pendingChanges}
          </span>
        )}
        {collapsed && !!pendingChanges && pendingChanges > 0 && (
          <span
            aria-label={`${pendingChanges} pending change${pendingChanges === 1 ? "" : "s"}`}
            className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-primary"
          />
        )}
      </button>

      {!collapsed && entries && entries.length > 0 && (
        <div className="flex flex-col pl-lg">
          {entries.map((label, i) => (
            <button
              key={`${label}-${i}`}
              type="button"
              onClick={() => onSelectEntry?.(state.id, i)}
              className="text-left px-sm py-xs rounded-lg text-caption text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors truncate"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";
import { Plus } from "@phosphor-icons/react";
import { InfoTooltip } from "@/components/ui/InfoTooltip";

// The Profile page's shared look, used by the page and the section editors
// beside it (ProfileSections.tsx).

export function SectionHeader({ title, info, onAdd, addLabel, action }: {
  title: string; info?: string; onAdd?: () => void; addLabel?: string;
  /** Anything else for the header's right side (a section's Remove). */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-sm mb-md sm:mb-lg">
      <h2 className="text-headline-md text-on-surface font-bold tracking-tight flex items-center gap-sm">
        {title}
        {info && <InfoTooltip text={info} />}
      </h2>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="shrink-0 flex items-center gap-xs px-sm sm:px-md py-xs pill pill-interactive rounded-full text-label-sm font-semibold text-primary bg-primary/5 hover:bg-primary/10 transition-all"
        >
          <Plus size={14} weight="bold" />
          <span className="sm:hidden">Add</span>
          <span className="hidden sm:inline">{addLabel ?? "Add"}</span>
        </button>
      )}
      {action}
    </div>
  );
}

export const cardCls = "bg-surface-container-lowest/80 backdrop-blur-xl rounded-2xl p-lg border border-outline-variant/30 shadow-lg shadow-primary/5";

export const inputCls = "w-full px-sm sm:px-md py-sm bg-surface-container-lowest/80 border border-outline-variant/40 rounded-xl text-body-sm text-on-surface outline-none transition-all placeholder:text-on-surface-variant/50 hover:border-outline-variant focus:border-primary focus:ring-2 focus:ring-primary/15 focus:bg-surface-container-lowest";
export const textareaCls = `${inputCls} resize-none`;
// A field with an icon drawn at its left. The left padding is repeated at
// sm: because inputCls's own sm:px-md comes later in the CSS and would
// otherwise win there, sliding the text under the icon.
export const iconInputCls = `${inputCls} pl-[2.75rem] sm:pl-[2.75rem]`;
export const fieldLabelCls = "text-label-sm text-on-surface-variant/90 flex items-center gap-xs font-semibold tracking-wide";

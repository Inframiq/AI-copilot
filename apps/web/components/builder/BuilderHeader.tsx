"use client";
import { ArrowLeft, CheckCircle, CircleNotch, WarningCircle } from "@phosphor-icons/react";
import { useResumeStore } from "@/stores/resume-store";

/**
 * Back, title and autosave status. The status reads straight off
 * resume-store's existing isDirty / isSaving / saveError — the Builder adds
 * no persistence of its own.
 */
export function BuilderHeader({
  title,
  onBack,
  backLabel,
}: {
  title: string;
  onBack: () => void;
  backLabel: string;
}) {
  const isDirty = useResumeStore((s) => s.isDirty);
  const isSaving = useResumeStore((s) => s.isSaving);
  const saveError = useResumeStore((s) => s.saveError);

  // Error first: a failed write matters more than whatever else is pending,
  // and showing "Saving…" over a failure would be a lie.
  const status = saveError
    ? { icon: <WarningCircle size={14} weight="fill" />, text: saveError, tone: "text-error" }
    : isSaving
      ? {
          icon: <CircleNotch size={14} className="animate-spin" />,
          text: "Saving…",
          tone: "text-on-surface-variant",
        }
      : isDirty
        ? { icon: null, text: "Unsaved changes", tone: "text-on-surface-variant" }
        : {
            icon: <CheckCircle size={14} weight="fill" />,
            text: "All changes saved",
            tone: "text-success",
          };

  return (
    <header className="flex shrink-0 items-center gap-lg border-b border-outline-variant/30 bg-surface px-lg py-md">
      <button
        type="button"
        onClick={onBack}
        className="flex shrink-0 items-center gap-xs text-label-md text-on-surface-variant transition-colors hover:text-on-surface"
      >
        <ArrowLeft size={16} />
        {backLabel}
      </button>
      <span aria-hidden className="h-4 w-px shrink-0 bg-outline-variant/40" />
      <h1 className="truncate text-headline-md font-semibold text-on-surface">{title}</h1>
      <span
        data-testid="save-status"
        className={`ml-auto flex shrink-0 items-center gap-xs text-caption ${status.tone}`}
      >
        {status.icon}
        {status.text}
      </span>
    </header>
  );
}

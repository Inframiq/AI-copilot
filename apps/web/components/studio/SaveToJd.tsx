"use client";
import { CheckCircle, CircleNotch, FloppyDisk } from "@phosphor-icons/react";
import { FOCUS_RING } from "@/lib/focus";

/**
 * The JD path's save: links the tailored résumé to the job it was tailored
 * for. Until pressed, the Studio holds an unsaved draft and nothing is
 * written anywhere — least of all over the master résumé it was built from.
 * Once saved, later edits autosave into that JD's own copy, and this reads
 * as a quiet confirmation instead of a button.
 */
export function SaveToJd({
  saved,
  isSaving,
  onSave,
}: {
  saved: boolean;
  isSaving: boolean;
  onSave: () => void;
}) {
  if (saved) {
    return (
      <span
        role="status"
        className="flex shrink-0 items-center gap-xs text-label-sm text-success"
      >
        <CheckCircle size={16} weight="fill" />
        <span className="hidden sm:inline">Saved to JD</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={isSaving}
      aria-label="Save to JD"
      className={`flex shrink-0 items-center gap-xs rounded-xl border border-primary/40 px-md py-sm text-label-md text-primary transition-colors hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
    >
      {isSaving ? <CircleNotch size={16} className="animate-spin" /> : <FloppyDisk size={16} />}
      <span className="hidden sm:inline">Save to JD</span>
    </button>
  );
}

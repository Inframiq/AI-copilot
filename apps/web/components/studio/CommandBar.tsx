"use client";
import { useState } from "react";
import {
  CheckCircle,
  DownloadSimple,
  FilePdf,
  ListBullets,
  PencilSimple,
  Spinner,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";

// Ported from the header of app/(app)/studio/[resumeId]/page.tsx: inline
// title edit, the save-state chip, arm-to-confirm delete and Export.
//
// Two of the old header's controls are deliberately absent:
//   • the template <select> — template choice now lives in the dock's
//     TemplateGallery, next to the render it changes;
//   • the Preview toggle — the dock is always docked, so there is nothing
//     left to toggle.
//
// The title is a heading, so it renders in text-on-surface. text-primary is
// reserved for interactive or current state.
export function CommandBar({
  title,
  isDirty,
  isSaving,
  saveError,
  onRename,
  renameError,
  onRetrySave,
  onExport,
  isExporting,
  exportError,
  exportDone,
  canExport = true,
  onDelete,
  isDeleting,
  deleteError,
  onOpenRail,
  onOpenPreview,
}: {
  title: string;
  isDirty: boolean;
  isSaving: boolean;
  saveError: string | null;
  /** Called with the trimmed new title; the caller owns the write. */
  onRename: (next: string) => void;
  renameError?: string | null;
  onRetrySave: () => void;
  onExport: () => void;
  isExporting: boolean;
  exportError?: string | null;
  exportDone?: boolean;
  canExport?: boolean;
  onDelete: () => void;
  isDeleting: boolean;
  deleteError?: string | null;
  /** Below xl the rail is a sheet — this opens it. Omit to hide the button. */
  onOpenRail?: () => void;
  /** Below xl the preview dock is a sheet — this opens it. */
  onOpenPreview?: () => void;
}) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  // Arm-to-confirm: the first click only arms, the second deletes. Local to
  // the bar — the caller never sees a half-pressed delete.
  const [deleteArmed, setDeleteArmed] = useState(false);

  function startEditingTitle() {
    setTitleDraft(title);
    setIsEditingTitle(true);
  }

  function commitTitle() {
    setIsEditingTitle(false);
    const next = titleDraft.trim();
    if (!next || next === title) return;
    onRename(next);
  }

  return (
    <header className="flex shrink-0 items-center justify-between gap-md border-b border-outline-variant/20 bg-surface-container-lowest/80 px-lg h-16 backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-md">
        {/* Below xl the rail is not on screen — this is the only way to it. */}
        {onOpenRail && (
          <button
            type="button"
            onClick={onOpenRail}
            aria-label="Open sections"
            title="Sections"
            className="shrink-0 rounded-xl p-xs text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface xl:hidden"
          >
            <ListBullets size={20} />
          </button>
        )}

        {isEditingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setIsEditingTitle(false);
            }}
            maxLength={200}
            aria-label="Resume title"
            className="min-w-0 border-b-2 border-primary bg-transparent text-headline-md text-on-surface outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={startEditingTitle}
            title="Rename resume"
            className="group flex min-w-0 items-center gap-xs text-headline-md text-on-surface transition-opacity hover:opacity-80"
          >
            <span className="truncate">{title || "Resume Studio"}</span>
            <PencilSimple
              size={16}
              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
            />
          </button>
        )}

        {saveError ? (
          <button
            type="button"
            onClick={onRetrySave}
            title={saveError}
            className="flex items-center gap-xs rounded-full bg-error-container/30 px-sm py-xs text-label-caps text-error transition-colors hover:bg-error-container/50"
          >
            <WarningCircle size={14} weight="fill" /> Failed to save · Retry
          </button>
        ) : isSaving ? (
          <span className="flex items-center gap-xs rounded-full bg-surface-variant px-sm py-xs text-label-caps text-on-surface-variant">
            <Spinner size={12} className="animate-spin" /> Saving…
          </span>
        ) : isDirty ? (
          <span className="rounded-full bg-surface-variant px-sm py-xs text-label-caps text-on-surface-variant">
            Unsaved changes
          </span>
        ) : (
          <span className="flex items-center gap-xs rounded-full bg-surface-variant px-sm py-xs text-label-caps text-on-surface-variant">
            <CheckCircle size={12} weight="fill" /> Saved
          </span>
        )}

        {renameError && <span className="text-caption text-error">{renameError}</span>}
      </div>

      <div className="flex items-center gap-sm">
        {/* The dock keeps its column down to lg; below that it is a sheet. */}
        {onOpenPreview && (
          <button
            type="button"
            onClick={onOpenPreview}
            aria-label="Open preview"
            title="Preview"
            className="shrink-0 rounded-xl p-xs text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface lg:hidden"
          >
            <FilePdf size={20} />
          </button>
        )}

        <div className="flex flex-col items-end gap-xs">
          <button
            type="button"
            onClick={() => {
              if (!deleteArmed) {
                setDeleteArmed(true);
                return;
              }
              onDelete();
            }}
            disabled={isDeleting}
            title={deleteArmed ? "Click again to confirm" : "Delete resume"}
            className={`flex items-center gap-xs rounded-xl px-sm py-xs text-label-md transition-all disabled:opacity-50 ${
              deleteArmed
                ? "bg-error text-on-primary"
                : "text-on-surface-variant hover:bg-error-container/50 hover:text-error"
            }`}
          >
            <Trash size={18} />
            {deleteArmed && (
              <span className="hidden sm:inline">
                {isDeleting ? "Deleting…" : "Confirm delete"}
              </span>
            )}
          </button>
          {deleteError && <span className="text-caption text-error">{deleteError}</span>}
        </div>

        <div className="flex flex-col items-end gap-xs">
          <button
            type="button"
            onClick={onExport}
            disabled={isExporting || !canExport}
            title="Download PDF"
            className="flex items-center gap-xs rounded-xl bg-primary px-md py-xs text-label-md text-on-primary shadow-md transition-all hover:shadow-xl active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <DownloadSimple size={18} />
            <span className="hidden sm:inline">{isExporting ? "Generating…" : "Export"}</span>
          </button>
          {exportError && <span className="text-caption text-error">{exportError}</span>}
          {exportDone && !exportError && (
            <span className="text-caption text-success">Downloaded ✓</span>
          )}
        </div>
      </div>
    </header>
  );
}

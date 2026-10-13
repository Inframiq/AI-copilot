"use client";
import { useState } from "react";
import { Trash } from "@phosphor-icons/react";
import { FOCUS_RING } from "@/lib/focus";

/**
 * Deleting a letter cannot be undone, so it takes two clicks: Delete, then
 * a plain "Delete this letter?" with Delete and Cancel in place.
 *
 * `compact` is the icon-only form for a card in the list.
 */
export function DeleteLetter({
  onDelete,
  compact = false,
}: {
  onDelete: () => Promise<void>;
  compact?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete the letter.");
      setDeleting(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label="Delete letter"
        title="Delete letter"
        className={
          compact
            ? `flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-error/10 hover:text-error ${FOCUS_RING}`
            : `flex items-center gap-xs rounded-xl border border-outline-variant/40 px-md py-sm text-label-md text-on-surface-variant transition-all hover:border-error/40 hover:bg-error/5 hover:text-error ${FOCUS_RING}`
        }
      >
        <Trash size={16} />
        {!compact && "Delete"}
      </button>
    );
  }

  return (
    <div role="group" aria-label="Confirm delete" className="flex flex-wrap items-center gap-xs">
      <span className="text-caption font-semibold text-on-surface">Delete this letter?</span>
      <button
        type="button"
        onClick={confirm}
        disabled={deleting}
        className={`rounded-lg bg-error px-sm py-xs text-caption font-semibold text-on-error transition-opacity hover:opacity-90 disabled:opacity-60 ${FOCUS_RING}`}
      >
        {deleting ? "Deleting…" : "Delete"}
      </button>
      <button
        type="button"
        onClick={() => { setConfirming(false); setError(null); }}
        disabled={deleting}
        className={`rounded-lg px-sm py-xs text-caption font-semibold text-on-surface-variant transition-colors hover:bg-on-surface/5 ${FOCUS_RING}`}
      >
        Cancel
      </button>
      {error && <span role="alert" className="basis-full text-caption text-error">{error}</span>}
    </div>
  );
}

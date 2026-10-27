"use client";
import { useState } from "react";
import { FloppyDisk } from "@phosphor-icons/react";
import { FOCUS_RING } from "@/lib/focus";
import { Sheet, SheetBody, SheetHeader } from "@/components/ui/Sheet";

interface Props {
  defaultName: string;
  /** Existing saved analysis titles, for the case-insensitive collision check. */
  existingTitles: { id: string; title: string }[];
  onCancel: () => void;
  /** replaceId is set when the chosen name matched an existing entry and the
   * user confirmed replacing it. */
  onConfirm: (name: string, replaceId?: string) => void;
}

export function SaveAnalysisModal({ defaultName, existingTitles, onCancel, onConfirm }: Props) {
  const [name, setName] = useState(defaultName);
  const [conflict, setConflict] = useState<{ id: string; title: string } | null>(null);

  function handleSaveClick() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const match = existingTitles.find((t) => t.title.trim().toLowerCase() === trimmed.toLowerCase());
    if (match) {
      setConflict(match);
      return;
    }
    onConfirm(trimmed);
  }

  const secondary = `flex-1 py-sm rounded-lg border border-outline-variant/50 text-label-md text-on-surface hover:bg-surface-container ${FOCUS_RING}`;

  return (
    // Closing the name clash goes back to the name, not away.
    <Sheet
      labelledBy="save-analysis-title"
      describedBy={conflict ? "save-analysis-help" : undefined}
      onClose={conflict ? () => setConflict(null) : onCancel}
    >
      <SheetBody>
        {conflict ? (
          <>
            <SheetHeader
              eyebrow="Name already used"
              tone="text-error"
              titleId="save-analysis-title"
              title={<>&ldquo;{conflict.title}&rdquo; already exists</>}
              descriptionId="save-analysis-help"
            >
              Replacing it deletes that entry and any tailoring history built on it. This can&apos;t be undone.
            </SheetHeader>
            <div className="flex gap-sm">
              <button onClick={() => setConflict(null)} data-autofocus className={secondary}>
                Back
              </button>
              <button
                onClick={() => onConfirm(name.trim(), conflict.id)}
                className={`flex-[1.4] py-sm rounded-lg text-label-md font-semibold text-on-error bg-error hover:opacity-90 transition-opacity ${FOCUS_RING}`}
              >
                Replace
              </button>
            </div>
          </>
        ) : (
          <>
            <SheetHeader eyebrow="JD Analyzer" titleId="save-analysis-title" title="Save analysis as" />
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveClick(); }}
              onFocus={(e) => e.currentTarget.select()}
              placeholder="Name this analysis"
              aria-label="Analysis name"
              className="w-full px-md py-sm bg-surface border border-outline-variant/60 rounded-lg text-body-md text-on-surface outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            <div className="flex gap-sm">
              <button onClick={onCancel} className={secondary}>
                Cancel
              </button>
              <button
                onClick={handleSaveClick}
                disabled={!name.trim()}
                className={`flex-[1.4] inline-flex items-center justify-center gap-xs py-sm rounded-lg text-label-md font-semibold text-on-primary bg-primary hover:bg-primary-container transition-colors disabled:opacity-40 ${FOCUS_RING}`}
              >
                <FloppyDisk size={16} />
                Save
              </button>
            </div>
          </>
        )}
      </SheetBody>
    </Sheet>
  );
}

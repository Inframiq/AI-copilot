"use client";
import { useEffect, useState } from "react";
import { FloppyDisk, WarningCircle, X } from "@phosphor-icons/react";

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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") (conflict ? setConflict(null) : onCancel());
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [conflict, onCancel]);

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

  return (
    <>
      <div className="fixed inset-0 z-40 bg-on-surface/30 backdrop-blur-sm" onClick={conflict ? undefined : onCancel} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-lg pointer-events-none">
        <div className="pointer-events-auto w-full max-w-[26rem] bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-2xl overflow-hidden">
          {conflict ? (
            <div className="p-lg flex flex-col gap-md">
              <div className="flex items-start gap-md">
                <div className="w-10 h-10 rounded-full bg-error-container/40 flex items-center justify-center shrink-0">
                  <WarningCircle size={20} className="text-error" />
                </div>
                <div>
                  <p className="text-label-md text-on-surface font-semibold">
                    &ldquo;{conflict.title}&rdquo; already exists
                  </p>
                  <p className="text-body-sm text-on-surface-variant mt-xs">
                    Replacing it deletes that entry and any tailoring history built on it. This can&apos;t be undone.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-sm">
                <button
                  onClick={() => setConflict(null)}
                  className="px-lg py-sm rounded-lg text-label-sm text-on-surface-variant hover:bg-surface-container transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={() => onConfirm(name.trim(), conflict.id)}
                  className="px-lg py-sm rounded-lg text-label-sm text-on-error bg-error hover:opacity-90 transition-opacity"
                >
                  Replace
                </button>
              </div>
            </div>
          ) : (
            <div className="p-lg flex flex-col gap-md">
              <div className="flex items-center justify-between">
                <p className="text-label-md text-on-surface font-semibold">Save analysis as</p>
                <button onClick={onCancel} className="p-xs rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors">
                  <X size={16} />
                </button>
              </div>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveClick(); }}
                onFocus={(e) => e.currentTarget.select()}
                placeholder="Name this analysis"
                className="w-full px-md py-sm bg-surface-container border border-outline-variant/40 rounded-xl text-body-sm text-on-surface outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
              <div className="flex items-center justify-end gap-sm">
                <button
                  onClick={onCancel}
                  className="px-lg py-sm rounded-lg text-label-sm text-on-surface-variant hover:bg-surface-container transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveClick}
                  disabled={!name.trim()}
                  className="flex items-center gap-xs px-lg py-sm rounded-lg text-label-sm text-on-primary bg-primary hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  <FloppyDisk size={16} />
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

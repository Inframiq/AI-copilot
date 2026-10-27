"use client";
import { useEffect, useRef, useState } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import { isResumeChanged } from "@/lib/api-client";
import { FOCUS_RING } from "@/lib/focus";
import { Sheet, SheetBody } from "@/components/ui/Sheet";
import { useResumeStore } from "@/stores/resume-store";

/**
 * Asks which copy to keep when a save is refused because the résumé was
 * saved on another device (or tab) since this one loaded it — instead of
 * either device silently overwriting the other. Opens on the store's
 * conflictUpdatedAt; autosave holds until a choice is made, so there is no
 * dismiss — closing it would leave edits quietly unsaved. Mounted once,
 * app-wide, in app/providers.tsx.
 */
export function ResumeConflictModal() {
  const theirs = useResumeStore((s) => s.conflictUpdatedAt);
  if (!theirs) return null;
  return <ConflictDialog key={theirs} />;
}

function ConflictDialog() {
  const keepMine = useResumeStore((s) => s.keepMine);
  const loadTheirs = useResumeStore((s) => s.loadTheirs);
  const [busy, setBusy] = useState<"mine" | "theirs" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  async function choose(which: "mine" | "theirs") {
    setBusy(which);
    setError(null);
    try {
      await (which === "mine" ? keepMine() : loadTheirs());
    } catch (e) {
      // Yet another save landed: the store holds the new version and this
      // dialog remounts to ask again, so there's nothing to say here.
      if (isResumeChanged(e)) return;
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
      setBusy(null);
    }
  }

  return (
    <Sheet
      role="alertdialog"
      labelledBy="resume-conflict-title"
      describedBy="resume-conflict-body"
      onClose={() => {}}
      dismissible={false}
    >
      <SheetBody>
        <div>
          <p className="font-label-caps text-label-caps uppercase text-primary">Two versions</p>
          <h2
            id="resume-conflict-title"
            ref={titleRef}
            tabIndex={-1}
            className="mt-sm text-headline-md text-on-surface outline-none"
          >
            This résumé changed on another device
          </h2>
          <p id="resume-conflict-body" className="mt-xs text-body-sm text-on-surface-variant">
            It was saved somewhere else — another tab, your phone or laptop — while you were editing here. Your
            latest changes here aren&apos;t saved yet. Which version do you want to keep?
          </p>
        </div>

        {error && <p role="alert" className="text-caption text-error">{error}</p>}
        <div className="flex gap-sm">
          <button
            type="button"
            onClick={() => choose("theirs")}
            disabled={busy !== null}
            className={`flex-1 min-w-0 inline-flex flex-col items-center justify-center py-sm px-xs rounded-lg border border-outline-variant/50 text-on-surface hover:bg-surface-container disabled:opacity-50 ${FOCUS_RING}`}
          >
            <span className="inline-flex items-center gap-xs text-label-md font-semibold">
              {busy === "theirs" && <CircleNotch size={16} className="animate-spin motion-reduce:animate-none" />}
              Use the other one
            </span>
            <span className="text-caption text-on-surface-variant">Drops your edits here</span>
          </button>
          <button
            type="button"
            onClick={() => choose("mine")}
            disabled={busy !== null}
            className={`flex-1 min-w-0 inline-flex flex-col items-center justify-center py-sm px-xs rounded-lg bg-primary text-on-primary hover:bg-primary-container disabled:opacity-50 ${FOCUS_RING}`}
          >
            <span className="inline-flex items-center gap-xs text-label-md font-semibold">
              {busy === "mine" && <CircleNotch size={16} className="animate-spin motion-reduce:animate-none" />}
              Keep mine
            </span>
            <span className="text-caption opacity-80">Saves over the other one</span>
          </button>
        </div>
      </SheetBody>
    </Sheet>
  );
}

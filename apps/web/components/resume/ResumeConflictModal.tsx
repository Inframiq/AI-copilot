"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowsClockwise, CircleNotch } from "@phosphor-icons/react";
import { isResumeChanged } from "@/lib/api-client";
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
    <>
      <div className="fixed inset-0 z-[70] bg-on-surface/30 backdrop-blur-sm" />
      <div className="fixed inset-0 z-[71] flex items-end sm:items-center justify-center p-sm sm:p-lg pointer-events-none">
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="resume-conflict-title"
          aria-describedby="resume-conflict-body"
          className="pointer-events-auto w-full max-w-[28rem] flex flex-col bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-2xl"
        >
          <div className="p-md sm:p-lg pb-sm flex items-start gap-md">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <ArrowsClockwise size={20} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h2
                id="resume-conflict-title"
                ref={titleRef}
                tabIndex={-1}
                className="text-headline-md text-on-surface font-semibold outline-none"
              >
                This résumé changed on another device
              </h2>
              <p id="resume-conflict-body" className="text-body-sm text-on-surface-variant mt-xs">
                It was saved somewhere else — another tab, your phone or laptop — while you were
                editing here. Your latest changes here aren&apos;t saved yet. Which version do you
                want to keep?
              </p>
            </div>
          </div>

          <div className="p-md sm:p-lg pt-sm flex flex-col gap-sm">
            {error && <p role="alert" className="text-caption text-error">{error}</p>}
            <div className="flex gap-sm">
              <button
                type="button"
                onClick={() => choose("theirs")}
                disabled={busy !== null}
                className="flex-1 min-w-0 inline-flex flex-col items-center justify-center py-sm px-xs rounded-xl border border-outline-variant/40 text-on-surface hover:bg-surface-container disabled:opacity-50"
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
                className="flex-1 min-w-0 inline-flex flex-col items-center justify-center py-sm px-xs rounded-xl bg-primary text-on-primary hover:opacity-90 disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-xs text-label-md font-semibold">
                  {busy === "mine" && <CircleNotch size={16} className="animate-spin motion-reduce:animate-none" />}
                  Keep mine
                </span>
                <span className="text-caption opacity-80">Saves over the other one</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

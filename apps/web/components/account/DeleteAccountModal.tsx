"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { leaveSignedOut, signOutHere } from "@/lib/supabase";
import { apiClient, ApiError } from "@/lib/api-client";
import { FOCUS_RING } from "@/lib/focus";
import { Sheet, SheetBody, SheetHeader } from "@/components/ui/Sheet";

// What a deletion actually removes — shown in the dialog so "permanent" is
// concrete, not a vague warning. Mirrors the rows DELETE /me wipes.
const REMOVED = [
  "Your saved resumes and uploaded files",
  "Job descriptions, tailoring history and interview prep",
  "Cover letters and analytics",
  "Your career profile and photo",
  "Your plan and any remaining credits",
];

const CONFIRM_WORD = "DELETE";

export function DeleteAccountModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();

  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"form" | "deleting" | "done">("form");

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    if (confirmText !== CONFIRM_WORD || phase !== "form") return;
    setError("");
    setPhase("deleting");

    try {
      await apiClient.deleteAccount();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong deleting your account. Please try again."
      );
      setPhase("form");
      return;
    }

    // Data + auth user are gone. Show that for a moment, then tear down the
    // local session and leave: signing out first would let SessionGuard
    // leave at once, before the confirmation was seen.
    setPhase("done");
    setTimeout(async () => {
      await signOutHere();
      queryClient.clear();
      leaveSignedOut();
    }, 1200);
  }

  return (
    <Sheet
      labelledBy="delete-account-title"
      describedBy="delete-account-help"
      onClose={onClose}
      dismissible={phase === "form"}
    >
      <SheetBody>
        {phase === "done" ? (
          <SheetHeader eyebrow="Account" tone="text-error" titleId="delete-account-title" title="Account deleted" descriptionId="delete-account-help">
            Your account and data have been removed. Taking you to the sign-in page…
          </SheetHeader>
        ) : (
          <>
            <SheetHeader
              eyebrow="Delete account"
              tone="text-error"
              titleId="delete-account-title"
              title="Delete your account?"
              descriptionId="delete-account-help"
            >
              This is permanent and cannot be undone. The following is deleted immediately:
            </SheetHeader>
            <ul className="rounded-xl bg-error-container/30 p-sm sm:p-md flex flex-col gap-xs">
              {REMOVED.map((item) => (
                <li key={item} className="text-body-sm text-on-surface flex items-start gap-sm">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-error" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>

            {error && (
              <p role="alert" className="rounded-lg bg-error-container px-md py-sm text-on-error-container text-body-sm">
                {error}
              </p>
            )}

            <form onSubmit={handleDelete} className="flex flex-col gap-md">
              <label className="flex flex-col gap-xs">
                <span className="text-label-md text-on-surface-variant">
                  Type <strong className="text-on-surface">{CONFIRM_WORD}</strong> to confirm
                </span>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  data-autofocus
                  disabled={phase === "deleting"}
                  placeholder={CONFIRM_WORD}
                  className="w-full px-md py-sm rounded-lg border border-outline-variant bg-surface text-on-surface text-body-md placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-error disabled:opacity-60"
                />
              </label>
              <div className="flex gap-sm">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={phase === "deleting"}
                  className={`flex-1 py-sm rounded-lg border border-outline-variant/50 text-label-md text-on-surface hover:bg-surface-container disabled:opacity-60 ${FOCUS_RING}`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={confirmText !== CONFIRM_WORD || phase === "deleting"}
                  className={`flex-[1.4] py-sm rounded-lg text-label-md font-semibold bg-error text-on-error hover:opacity-90 transition-opacity disabled:opacity-50 ${FOCUS_RING}`}
                >
                  {phase === "deleting" ? "Deleting…" : "Delete my account"}
                </button>
              </div>
            </form>
          </>
        )}
      </SheetBody>
    </Sheet>
  );
}

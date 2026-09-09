"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { X, Warning } from "@phosphor-icons/react";
import { createBrowserClient } from "@/lib/supabase";
import { apiClient, ApiError } from "@/lib/api-client";

// What a deletion actually removes — shown in the dialog so "permanent" is
// concrete, not a vague warning. Mirrors the rows DELETE /me wipes.
const REMOVED = [
  "Your saved resumes and uploaded files",
  "Job descriptions, tailoring history and interview prep",
  "Cover letters and analytics",
  "Your career profile and photo",
  "Your plan and any remaining credits",
];

export function DeleteAccountModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const supabase = createBrowserClient();

  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"form" | "deleting" | "done">("form");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase === "form") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, phase]);

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    if (!password || phase !== "form") return;
    setError("");
    setPhase("deleting");

    // Re-authenticate with the current password before doing anything
    // destructive — updateUser/deleteAccount would otherwise run off nothing
    // more than a still-open session.
    const { data: userData } = await supabase.auth.getUser();
    const email = userData.user?.email;
    if (!email) {
      setError("Your session has expired. Sign in again and retry.");
      setPhase("form");
      return;
    }
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (authError) {
      setError("That password is incorrect.");
      setPhase("form");
      return;
    }

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

    // Data + auth user are gone — tear down the local session and state.
    try {
      await supabase.auth.signOut();
    } catch {
      // already invalid server-side; nothing to do
    }
    queryClient.clear();
    setPhase("done");
    setTimeout(() => router.replace("/login"), 1200);
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-on-surface/30 backdrop-blur-sm"
        onClick={() => phase === "form" && onClose()}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-lg pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Delete account"
          className="pointer-events-auto w-full max-w-[28rem] bg-surface-container-lowest rounded-2xl border border-error/30 shadow-2xl p-lg"
        >
          <div className="flex items-start justify-between gap-md">
            <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center shrink-0">
              <Warning size={20} weight="fill" className="text-error" />
            </div>
            {phase === "form" && (
              <button
                onClick={onClose}
                aria-label="Close"
                className="text-on-surface-variant hover:bg-surface-container-high/50 p-xs rounded-full transition-colors"
              >
                <X size={18} />
              </button>
            )}
          </div>

          {phase === "done" ? (
            <>
              <h2 className="text-headline-md text-on-surface font-semibold mt-md">
                Account deleted
              </h2>
              <p className="text-body-sm text-on-surface-variant mt-xs">
                Your account and data have been removed. Taking you to the sign-in
                page…
              </p>
            </>
          ) : (
            <>
              <h2 className="text-headline-md text-on-surface font-semibold mt-md">
                Delete your account?
              </h2>
              <p className="text-body-sm text-on-surface-variant mt-xs">
                This is permanent and cannot be undone. The following will be
                deleted immediately:
              </p>
              <ul className="mt-md flex flex-col gap-xs">
                {REMOVED.map((item) => (
                  <li
                    key={item}
                    className="text-body-sm text-on-surface-variant flex items-start gap-sm"
                  >
                    <span className="text-error mt-[2px]" aria-hidden>
                      •
                    </span>
                    {item}
                  </li>
                ))}
              </ul>

              {error && (
                <div className="mt-md p-md rounded-lg bg-error-container text-on-error-container text-body-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleDelete} className="mt-md flex flex-col gap-md">
                <label className="flex flex-col gap-xs">
                  <span className="text-label-md text-on-surface-variant">
                    Enter your password to confirm
                  </span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    disabled={phase === "deleting"}
                    className="w-full px-md py-md rounded-lg border border-outline-variant bg-surface text-on-surface text-body-md placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-error disabled:opacity-60"
                  />
                </label>
                <div className="flex flex-wrap justify-end gap-sm">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={phase === "deleting"}
                    className="px-lg py-md rounded-xl text-label-md font-semibold text-on-surface-variant hover:bg-surface-container-high/50 transition-colors disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!password || phase === "deleting"}
                    className="px-lg py-md rounded-xl text-label-md font-semibold bg-error text-on-error hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {phase === "deleting" ? "Deleting…" : "Delete my account"}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </>
  );
}

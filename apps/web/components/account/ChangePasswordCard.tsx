"use client";
import { useEffect, useState } from "react";
import { Key, CheckCircle } from "@phosphor-icons/react";
import { createBrowserClient } from "@/lib/supabase";

const inputClass =
  "w-full px-md py-md rounded-lg border border-outline-variant bg-surface text-on-surface text-body-md placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60";

export function ChangePasswordCard() {
  const supabase = createBrowserClient();

  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setEmail(data.user?.email ?? null);
    })();
  }, [supabase]);

  function reset() {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError("");
    setLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (next.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (next === current) {
      setError("Your new password must be different from your current one.");
      return;
    }
    if (next !== confirm) {
      setError("New password and confirmation do not match.");
      return;
    }
    if (!email) {
      setError("Your session has expired. Sign in again and retry.");
      return;
    }

    setLoading(true);

    // Supabase's updateUser() never checks the current password — verify it
    // explicitly by re-authenticating first, so "Current password" is real.
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password: current,
    });
    if (authError) {
      setError("Your current password is incorrect.");
      setLoading(false);
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: next });
    setLoading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }

    reset();
    setOpen(false);
    setDone(true);
  }

  return (
    <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
      <h2 className="text-headline-md text-on-surface font-semibold flex items-center gap-sm">
        <Key size={20} weight="fill" className="text-primary" />
        Password
      </h2>
      <p className="text-body-sm text-on-surface-variant mt-xs">
        Change the password you use to sign in.
      </p>

      {done && !open && (
        <div className="mt-md p-md rounded-lg bg-success-container text-on-success-container text-body-sm flex items-center gap-sm">
          <CheckCircle size={18} weight="fill" className="shrink-0" />
          Your password has been updated.
        </div>
      )}

      {!open ? (
        <button
          onClick={() => {
            setDone(false);
            setOpen(true);
          }}
          className="mt-md self-start px-lg py-md rounded-xl text-label-md font-semibold text-primary border border-primary/40 bg-primary/5 hover:bg-primary/10 transition-colors"
        >
          Change password
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="mt-md flex flex-col gap-md max-w-[26rem]">
          {error && (
            <div className="p-md rounded-lg bg-error-container text-on-error-container text-body-sm">
              {error}
            </div>
          )}
          <label className="flex flex-col gap-xs">
            <span className="text-label-md text-on-surface-variant">Current password</span>
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              required
              disabled={loading}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-xs">
            <span className="text-label-md text-on-surface-variant">New password</span>
            <input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
              disabled={loading}
              placeholder="At least 8 characters"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-xs">
            <span className="text-label-md text-on-surface-variant">Confirm new password</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
              disabled={loading}
              className={inputClass}
            />
          </label>
          <div className="flex flex-wrap gap-sm">
            <button
              type="submit"
              disabled={loading}
              className="px-lg py-md rounded-xl text-label-md font-semibold bg-primary text-on-primary shadow-md hover:bg-primary-container transition-colors disabled:opacity-60"
            >
              {loading ? "Updating…" : "Update password"}
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
                setOpen(false);
              }}
              disabled={loading}
              className="px-lg py-md rounded-xl text-label-md font-semibold text-on-surface-variant hover:bg-surface-container-high/50 transition-colors disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

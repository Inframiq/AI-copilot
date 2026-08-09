"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const router = useRouter();
  const supabase = createBrowserClient();

  useEffect(() => {
    // The recovery link exchanges its code for a session via /callback before
    // landing here — if that didn't happen (direct nav, expired link), there's
    // no session to update a password against.
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
    });
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }
    setSuccess(true);
    setTimeout(() => router.push("/dashboard"), 1500);
  }

  if (hasSession === false) {
    return (
      <div className="min-h-screen flex items-center justify-center p-gutter">
        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant shadow-lg p-xl text-center max-w-[28rem] w-full">
          <p className="text-headline-md text-on-surface font-bold mb-sm">Link expired or invalid</p>
          <p className="text-body-md text-on-surface-variant mb-lg">
            This password reset link is no longer valid. Request a new one.
          </p>
          <a
            href="/forgot-password"
            className="inline-block px-lg py-md rounded-lg text-label-md text-on-primary bg-primary hover:bg-primary-container transition-colors"
          >
            Request new link
          </a>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-gutter">
        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant shadow-lg p-xl text-center max-w-[28rem] w-full">
          <p className="text-headline-md text-on-surface font-bold mb-sm">Password updated</p>
          <p className="text-body-md text-on-surface-variant">Redirecting you to your dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-gutter">
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant shadow-lg p-xl w-full max-w-[28rem]">
        <div className="flex items-center gap-md mb-xl">
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
            <span className="text-on-primary text-lg font-bold">C</span>
          </div>
          <span className="text-headline-md text-on-surface font-bold">Career Copilot</span>
        </div>

        <h1 className="text-headline-lg text-on-surface mb-md">Set a new password</h1>

        {error && (
          <div className="mb-md p-md rounded-lg bg-error-container text-on-error-container text-body-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-md">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password (min 8 characters)"
            minLength={8}
            required
            disabled={hasSession === null}
            className="w-full px-md py-md rounded-lg border border-outline-variant bg-surface text-on-surface text-body-md placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            minLength={8}
            required
            disabled={hasSession === null}
            className="w-full px-md py-md rounded-lg border border-outline-variant bg-surface text-on-surface text-body-md placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={loading || hasSession === null}
            className="w-full py-md rounded-lg text-label-md text-on-primary bg-primary shadow-md hover:bg-primary-container transition-colors disabled:opacity-60"
          >
            {loading ? "Updating…" : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}

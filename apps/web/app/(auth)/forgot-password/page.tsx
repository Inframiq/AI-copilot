"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const supabase = createBrowserClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    // Requires this exact URL (or a matching wildcard, e.g. `${origin}/**`)
    // to be listed under Supabase Dashboard → Authentication → URL
    // Configuration → Redirect URLs, for both this origin and the production
    // domain — otherwise Supabase silently redirects to the bare Site URL
    // instead, and the reset link goes nowhere useful.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/callback?next=/reset-password`,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center p-gutter">
        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant shadow-lg p-xl text-center max-w-[28rem] w-full">
          <div className="w-16 h-16 rounded-full bg-surface-container-high flex items-center justify-center mx-auto mb-lg">
            <span className="text-2xl">✉️</span>
          </div>
          <p className="text-headline-md text-on-surface font-bold mb-sm">Check your email</p>
          <p className="text-body-md text-on-surface-variant">
            If an account exists for <strong className="text-on-surface">{email}</strong>, we sent a
            password reset link to it.
          </p>
          <p className="text-body-sm text-on-surface-variant mt-md">
            <a href="/login" className="text-primary font-semibold hover:underline">
              Back to sign in
            </a>
          </p>
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

        <h1 className="text-headline-lg text-on-surface mb-sm">Reset your password</h1>
        <p className="text-body-sm text-on-surface-variant mb-md">
          Enter the email on your account and we&apos;ll send you a reset link.
        </p>

        {error && (
          <div className="mb-md p-md rounded-lg bg-error-container text-on-error-container text-body-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-md">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            required
            className="w-full px-md py-md rounded-lg border border-outline-variant bg-surface text-on-surface text-body-md placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full py-md rounded-lg text-label-md text-on-primary bg-primary shadow-md hover:bg-primary-container transition-colors disabled:opacity-60"
          >
            {loading ? "Sending…" : "Send reset link"}
          </button>
        </form>

        <p className="text-body-sm text-on-surface-variant mt-lg text-center">
          <a href="/login" className="text-primary font-semibold hover:underline">
            Back to sign in
          </a>
        </p>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase";

export default function RegisterPage() {
  const [error, setError] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const supabase = createBrowserClient();

  async function handleGoogleSignUp() {
    if (!agreed) return;
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/callback`,
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-gutter">
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant shadow-lg p-xl w-full max-w-[28rem]">
        {/* Logo */}
        <div className="flex items-center gap-md mb-xl">
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
            <span className="text-on-primary text-lg font-bold">K</span>
          </div>
          <span className="text-headline-md text-on-surface font-bold">KripaX</span>
        </div>

        <h1 className="text-headline-lg text-on-surface mb-md">Create account</h1>

        {error && (
          <div className="mb-md p-md rounded-lg bg-error-container text-on-error-container text-body-sm">
            {error}
          </div>
        )}

        <label className="flex items-start gap-sm mb-lg cursor-pointer">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-[3px] w-4 h-4 shrink-0 rounded border-outline-variant text-primary focus:ring-2 focus:ring-primary"
          />
          <span className="text-body-sm text-on-surface-variant">
            I agree to the{" "}
            <a href="/terms" target="_blank" className="text-primary hover:underline">Terms of Service</a>{" "}
            and{" "}
            <a href="/privacy" target="_blank" className="text-primary hover:underline">Privacy Policy</a>.
          </span>
        </label>

        <button
          onClick={handleGoogleSignUp}
          disabled={!agreed || loading}
          className="w-full py-md rounded-lg border border-outline-variant text-on-surface text-label-md hover:bg-surface-container-low transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-sm"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.56 2.7-3.87 2.7-6.62z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.98v2.33A9 9 0 0 0 9 18z" />
            <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.03l2.97-2.33z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.97l2.97 2.33C4.66 5.17 6.65 3.58 9 3.58z" />
          </svg>
          {loading ? "Redirecting…" : "Continue with Google"}
        </button>

        <p className="text-body-sm text-on-surface-variant mt-lg text-center">
          Already have an account?{" "}
          <a href="/login" className="text-primary font-semibold hover:underline">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}

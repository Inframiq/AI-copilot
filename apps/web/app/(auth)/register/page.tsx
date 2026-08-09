"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase";

export default function RegisterPage() {
  const [error, setError] = useState("");
  const supabase = createBrowserClient();

  async function handleGoogleSignUp() {
    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/callback`,
      },
    });
    if (error) setError(error.message);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-gutter">
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant shadow-lg p-xl w-full max-w-[28rem]">
        {/* Logo */}
        <div className="flex items-center gap-md mb-xl">
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
            <span className="text-on-primary text-lg font-bold">C</span>
          </div>
          <span className="text-headline-md text-on-surface font-bold">Career Copilot</span>
        </div>

        <h1 className="text-headline-lg text-on-surface mb-md">Create account</h1>

        {error && (
          <div className="mb-md p-md rounded-lg bg-error-container text-on-error-container text-body-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleGoogleSignUp}
          className="w-full py-md rounded-lg text-label-md text-on-primary bg-primary shadow-md hover:bg-primary-container transition-colors"
        >
          Continue with Google
        </button>

        <p className="text-body-sm text-on-surface-variant mt-lg text-center">
          Already have an account?{" "}
          <a href="/login" className="text-primary font-semibold hover:underline">
            Sign in
          </a>
        </p>

        <p className="text-caption text-on-surface-variant mt-md text-center">
          By continuing, you agree to our{" "}
          <a href="/terms" className="text-primary hover:underline">Terms</a>{" "}
          and{" "}
          <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}

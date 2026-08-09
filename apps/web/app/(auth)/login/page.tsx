"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase";

export default function LoginPage() {
  const [error, setError] = useState("");
  const supabase = createBrowserClient();

  async function handleGoogleSignIn() {
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

        <h1 className="text-headline-lg text-on-surface mb-md">Sign in</h1>

        {error && (
          <div className="mb-md p-md rounded-lg bg-error-container text-on-error-container text-body-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleGoogleSignIn}
          className="w-full py-md rounded-lg text-label-md text-on-primary bg-primary shadow-md hover:bg-primary-container transition-colors"
        >
          Continue with Google
        </button>

        <p className="text-body-sm text-on-surface-variant mt-lg text-center">
          No account?{" "}
          <a href="/register" className="text-primary font-semibold hover:underline">
            Register
          </a>
        </p>
      </div>
    </div>
  );
}

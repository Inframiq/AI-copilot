"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createBrowserClient();

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/dashboard");
  }

  async function handleOAuth(provider: "google" | "linkedin_oidc" | "github") {
    setError("");
    await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/callback`,
      },
    });
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-gutter">
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant shadow-lg p-xl w-full max-w-md">
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

        <form onSubmit={handleEmailLogin} className="flex flex-col gap-md mb-lg">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            required
            className="w-full px-md py-md rounded-lg border border-outline-variant bg-surface text-on-surface text-body-md placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
            className="w-full px-md py-md rounded-lg border border-outline-variant bg-surface text-on-surface text-body-md placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full py-md rounded-lg text-label-md text-on-primary bg-primary shadow-md hover:bg-primary-container transition-colors disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Sign in with Email"}
          </button>
        </form>

        <div className="relative mb-lg">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-outline-variant" />
          </div>
          <div className="relative flex justify-center text-body-sm">
            <span className="bg-surface-container-lowest px-sm text-on-surface-variant">or continue with</span>
          </div>
        </div>

        <div className="flex flex-col gap-sm">
          {(["google", "github", "linkedin_oidc"] as const).map((provider) => (
            <button
              key={provider}
              onClick={() => handleOAuth(provider)}
              className="w-full py-md rounded-lg border border-outline-variant text-on-surface text-label-md hover:bg-surface-container-low transition-colors"
            >
              Continue with {provider === "linkedin_oidc" ? "LinkedIn" : provider.charAt(0).toUpperCase() + provider.slice(1)}
            </button>
          ))}
        </div>

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

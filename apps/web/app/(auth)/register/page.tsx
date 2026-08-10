"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  const [resendError, setResendError] = useState("");
  const supabase = createBrowserClient();

  async function handleResend() {
    setResendState("sending");
    setResendError("");
    const { error } = await supabase.auth.resend({ type: "signup", email });
    if (error) {
      setResendError(error.message);
      setResendState("idle");
      return;
    }
    setResendState("sent");
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
      },
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    // Email confirmation is disabled, so signUp() already returns a live
    // session — go straight into onboarding instead of telling the user to
    // check an email that will never arrive. The "check your email" screen
    // below is a fallback for environments where confirmation IS required
    // (signUp() then returns no session).
    if (data.session) {
      router.push("/onboarding");
      return;
    }

    setSuccess(true);
  }

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

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-gutter">
        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant shadow-lg p-xl text-center max-w-[28rem] w-full">
          <div className="w-16 h-16 rounded-full bg-surface-container-high flex items-center justify-center mx-auto mb-lg">
            <span className="text-2xl">✉️</span>
          </div>
          <p className="text-headline-md text-on-surface font-bold mb-sm">Check your email</p>
          <p className="text-body-md text-on-surface-variant">
            We sent a confirmation link to{" "}
            <strong className="text-on-surface">{email}</strong>.
          </p>
          <p className="text-body-sm text-on-surface-variant mt-md">
            After confirming,{" "}
            <a href="/login" className="text-primary font-semibold hover:underline">
              sign in here
            </a>
            .
          </p>

          {resendError && (
            <p className="text-body-sm text-error mt-md">{resendError}</p>
          )}

          {resendState === "sent" ? (
            <p className="text-body-sm text-primary font-semibold mt-lg">
              Confirmation email resent — check your inbox.
            </p>
          ) : (
            <button
              onClick={handleResend}
              disabled={resendState === "sending"}
              className="mt-lg text-label-sm text-primary font-semibold hover:underline disabled:opacity-60"
            >
              {resendState === "sending" ? "Resending…" : "Didn't get it? Resend confirmation email"}
            </button>
          )}
        </div>
      </div>
    );
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

        <form onSubmit={handleRegister} className="flex flex-col gap-md mb-lg">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            required
            className="w-full px-md py-md rounded-lg border border-outline-variant bg-surface text-on-surface text-body-md placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary"
          />
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
            placeholder="Password (min 8 characters)"
            minLength={8}
            required
            className="w-full px-md py-md rounded-lg border border-outline-variant bg-surface text-on-surface text-body-md placeholder:text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full py-md rounded-lg text-label-md text-on-primary bg-primary shadow-md hover:bg-primary-container transition-colors disabled:opacity-60"
          >
            {loading ? "Creating account…" : "Create Account"}
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

        <button
          onClick={handleGoogleSignUp}
          className="w-full py-md rounded-lg border border-outline-variant text-on-surface text-label-md hover:bg-surface-container-low transition-colors"
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

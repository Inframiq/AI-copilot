"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Scales } from "@phosphor-icons/react";
import { apiClient, type PolicyAcceptance } from "@/lib/api-client";
import { createBrowserClient } from "@/lib/supabase";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legal-versions";

/**
 * Asks a signed-in user to agree to the current Terms and Privacy Policy
 * when the versions on record are older. Agreement is otherwise captured
 * only at sign-in, and a session can last for months, so without this a
 * policy change would reach existing users as "continued use", which the
 * Privacy Policy promises not to rely on where consent is needed.
 *
 * Says nothing while loading or if the check fails: an API hiccup must not
 * lock anyone out of their own work.
 */
export function PolicyUpdatePrompt() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { data } = useQuery<PolicyAcceptance>({
    queryKey: ["policyAcceptance"],
    queryFn: () => apiClient.getPolicyAcceptance(),
    staleTime: Infinity,
    retry: false,
  });

  if (!data) return null;
  if (data.terms_version === TERMS_VERSION && data.privacy_version === PRIVACY_VERSION) return null;
  const updated = data.terms_version !== null || data.privacy_version !== null;

  async function agree() {
    setSaving(true);
    setError("");
    try {
      await apiClient.acceptPolicies(TERMS_VERSION, PRIVACY_VERSION);
      queryClient.setQueryData<PolicyAcceptance>(["policyAcceptance"], {
        terms_version: TERMS_VERSION,
        privacy_version: PRIVACY_VERSION,
        accepted_at: new Date().toISOString(),
      });
    } catch {
      setError("That didn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    try {
      await createBrowserClient().auth.signOut();
    } catch {
      // ignore — treat as signed out either way
    }
    queryClient.clear();
    router.push("/login");
  }

  const link = "text-primary font-semibold hover:underline";
  return (
    <>
      <div className="fixed inset-0 z-[60] bg-on-surface/30 backdrop-blur-sm" />
      <div className="fixed inset-0 z-[61] flex items-center justify-center p-lg">
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="policy-update-title"
          className="w-full max-w-[28rem] bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-2xl p-lg"
        >
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Scales size={20} weight="fill" className="text-primary" />
          </div>
          <h2 id="policy-update-title" className="text-headline-md text-on-surface font-semibold mt-md">
            {updated ? "We've updated our terms" : "Please review our terms"}
          </h2>
          <p className="text-body-sm text-on-surface-variant mt-xs">
            {updated
              ? "Our Terms of Service and Privacy Policy have changed since you last agreed to them. "
              : "We don't have a record of you agreeing to our Terms of Service and Privacy Policy. "}
            Please read the{" "}
            <a href="/terms" target="_blank" className={link}>Terms of Service</a>, which include the{" "}
            <a href="/refunds" target="_blank" className={link}>Refund Policy</a>, and the{" "}
            <a href="/privacy" target="_blank" className={link}>Privacy Policy</a>{" "}
            before you continue.
          </p>
          <p className="text-body-sm text-on-surface-variant mt-sm">
            If you don&apos;t agree, you can sign out, or delete your account from the Account page.
          </p>
          {error && <p className="text-body-sm text-error mt-sm">{error}</p>}
          <div className="mt-lg flex flex-col-reverse sm:flex-row gap-sm">
            <button
              onClick={signOut}
              className="flex-1 py-md rounded-xl text-label-md text-on-surface-variant border border-outline-variant hover:bg-surface-container-low transition-colors"
            >
              Sign out
            </button>
            <button
              onClick={agree}
              disabled={saving}
              className="flex-1 py-md rounded-xl text-label-md font-semibold bg-primary text-on-primary hover:opacity-90 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : "I agree"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

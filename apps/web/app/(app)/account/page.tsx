"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lightning, Sparkle, Info, User, ArrowRight, SignOut } from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import { createBrowserClient } from "@/lib/supabase";
import { getCareerProfile } from "@/lib/career-profile-client";
import type { Subscription } from "@career-copilot/types";

// Only actions the user actively triggers with a button. Interview prep
// questions are deliberately excluded: they're generated from a tailored
// resume you already paid for, not a standalone action you can "buy".
const ACTION_LABELS: Record<string, string> = {
  tailor: "Tailor a resume to a job description",
  cover_letter: "Generate a cover letter",
  rewrite_bullet: "Rewrite or humanize a bullet",
  analyze: "Analyze a job description",
};

// Order the cost table so the headline action is first.
const ACTION_ORDER = ["tailor", "cover_letter", "rewrite_bullet", "analyze"];

const STATUS_LABEL: Record<string, string> = { working: "Working", student: "Student" };

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center justify-between py-sm gap-md">
      <span className="text-body-md text-on-surface-variant">{label}</span>
      <span className="text-body-md text-on-surface font-medium text-right truncate">
        {value || "—"}
      </span>
    </div>
  );
}

export default function AccountPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const supabase = createBrowserClient();

  const { data: sub, isLoading: subLoading, isError: subError } = useQuery<Subscription>({
    queryKey: ["subscription"],
    queryFn: () => apiClient.getSubscription(),
  });
  const { data: profile } = useQuery({
    queryKey: ["careerProfile"],
    queryFn: () => getCareerProfile(),
  });

  async function handleSignOut() {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore — treat as signed out either way
    }
    queryClient.clear();
    router.push("/login");
  }

  const pct =
    sub && sub.credits_allotment > 0
      ? Math.max(0, Math.min(100, (sub.credits_remaining / sub.credits_allotment) * 100))
      : 0;
  const tailorCost = sub?.costs?.tailor ?? 10;
  const low = !!sub && sub.credits_remaining < tailorCost;
  const tailorsLeft = sub ? Math.floor(sub.credits_remaining / tailorCost) : 0;

  return (
    <div className="max-w-[900px] mx-auto p-gutter pb-xxl flex flex-col gap-section">
      <section className="pt-lg pb-md">
        <h1
          className="text-headline-xl text-on-surface font-bold mb-sm"
          style={{ letterSpacing: "-0.02em" }}
        >
          Account
        </h1>
        <p className="text-body-lg text-on-surface-variant">
          Your details, plan, and credit balance.
        </p>
      </section>

      {/* Your details */}
      <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
        <div className="flex items-center justify-between mb-md">
          <h2 className="text-headline-md text-on-surface font-semibold flex items-center gap-sm">
            <User size={20} weight="fill" className="text-primary" />
            Your details
          </h2>
          <Link
            href="/profile"
            className="text-label-md text-primary font-semibold flex items-center gap-xs hover:underline"
          >
            Edit in My Profile
            <ArrowRight size={16} />
          </Link>
        </div>
        {profile ? (
          <div className="flex flex-col divide-y divide-outline-variant/20">
            <DetailRow label="Name" value={profile.contact?.name} />
            <DetailRow label="Email" value={profile.contact?.email} />
            <DetailRow label="Phone" value={profile.contact?.phone} />
            <DetailRow
              label="Status"
              value={profile.role_status ? STATUS_LABEL[profile.role_status] : undefined}
            />
          </div>
        ) : (
          <p className="text-body-sm text-on-surface-variant">
            Your profile isn&apos;t set up yet.{" "}
            <Link href="/onboarding" className="text-primary font-semibold hover:underline">
              Finish setting it up
            </Link>
            .
          </p>
        )}
      </div>

      {subError ? (
        <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
          <p className="text-body-md text-on-surface font-medium">Couldn&apos;t load your plan</p>
          <p className="text-body-sm text-on-surface-variant mt-xs">
            Refresh the page to try again.
          </p>
        </div>
      ) : subLoading || !sub ? (
        <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 h-40 animate-pulse" />
      ) : (
        <>
          {/* Plan */}
          <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 flex items-center justify-between gap-md">
            <div>
              <div className="flex items-center gap-sm">
                <span className="text-headline-md text-on-surface font-semibold capitalize">
                  {sub.plan} plan
                </span>
                <span
                  className={`text-caption font-semibold px-sm py-[2px] rounded-full capitalize ${
                    sub.status === "active"
                      ? "bg-success-accent/10 text-success-accent"
                      : "bg-error/10 text-error"
                  }`}
                >
                  {sub.status}
                </span>
              </div>
              <p className="text-body-sm text-on-surface-variant mt-xs">
                {sub.renews && sub.current_period_end
                  ? `Credits refill on ${new Date(sub.current_period_end).toLocaleDateString()}.`
                  : "One-time credit grant — it does not refill each month."}
              </p>
            </div>
            <Sparkle size={32} weight="fill" className="text-primary shrink-0" />
          </div>

          {/* Credits */}
          <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
            <div className="flex items-baseline justify-between mb-md">
              <span className="text-label-md text-on-surface-variant flex items-center gap-xs">
                <Lightning size={16} weight="fill" className={low ? "text-error" : "text-primary"} />
                Credits remaining
              </span>
              <span className={`text-headline-xl font-bold ${low ? "text-error" : "text-on-surface"}`}>
                {sub.credits_remaining}
                <span className="text-headline-md text-on-surface-variant/60 font-normal">
                  {" "}
                  / {sub.credits_allotment}
                </span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-surface-container-high overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${low ? "bg-error" : "bg-primary"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-body-sm text-on-surface-variant mt-sm">
              {low
                ? "Not enough for another resume tailor."
                : `Enough for about ${tailorsLeft} more resume ${tailorsLeft === 1 ? "tailor" : "tailors"}.`}
            </p>
          </div>

          {/* Costs */}
          <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
            <h2 className="text-headline-md text-on-surface font-semibold mb-md">What credits cost</h2>
            <div className="flex flex-col divide-y divide-outline-variant/20">
              {ACTION_ORDER.filter((a) => a in sub.costs).map((action) => {
                const cost = sub.costs[action];
                return (
                  <div key={action} className="flex items-center justify-between py-sm">
                    <span className="text-body-md text-on-surface">
                      {ACTION_LABELS[action] ?? action}
                    </span>
                    <span className="text-label-md font-semibold text-on-surface-variant">
                      {cost === 0 ? "Free" : `${cost} ${cost === 1 ? "credit" : "credits"}`}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="text-body-sm text-on-surface-variant mt-md">
              Interview prep questions are generated from a resume you&apos;ve
              already tailored — they don&apos;t cost extra.
            </p>
          </div>

          {/* Upgrade */}
          <Link
            href="/plans"
            className="bg-surface-container-low rounded-2xl p-lg border border-outline-variant/20 flex items-center justify-between gap-md hover:bg-surface-container transition-colors"
          >
            <div className="flex items-start gap-md">
              <Info size={20} className="text-on-surface-variant shrink-0 mt-[2px]" />
              <div>
                <p className="text-body-md text-on-surface font-medium">Need more credits?</p>
                <p className="text-body-sm text-on-surface-variant mt-xs">
                  See plans — Premium refills your credits every month.
                </p>
              </div>
            </div>
            <ArrowRight size={18} className="text-on-surface-variant shrink-0" />
          </Link>
        </>
      )}

      {/* Sign out */}
      <button
        onClick={handleSignOut}
        className="self-start flex items-center gap-sm px-lg py-md rounded-xl text-label-md font-semibold text-error border border-error/40 bg-error/5 hover:bg-error/10 transition-colors"
      >
        <SignOut size={18} weight="bold" />
        Sign out
      </button>
    </div>
  );
}

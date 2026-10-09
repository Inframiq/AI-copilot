"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lightning, Sparkle, Info, User, ArrowRight, SignOut, Warning, Trash, Compass } from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import { createBrowserClient } from "@/lib/supabase";
import { getCareerProfile } from "@/lib/career-profile-client";
import { DeleteAccountModal } from "@/components/account/DeleteAccountModal";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import type { Subscription } from "@career-copilot/types";

// Every action that calls a model costs credits; the server's price list
// (sub.costs) is the source of truth, these are just its names.
const ACTION_LABELS: Record<string, string> = {
  tailor: "Tailor a resume to a job description",
  generate_resume: "Generate a resume from your profile",
  cover_letter: "Generate a cover letter",
  prep_questions: "Make interview prep questions for a job",
  rewrite_bullet: "Rewrite or humanize a bullet",
  restructure_notes: "Tidy your notes into resume points",
  analyze: "Analyze a job description",
  parse_resume: "Read an uploaded resume",
};

// Order the cost table so the headline action is first.
const ACTION_ORDER = [
  "tailor", "generate_resume", "cover_letter", "prep_questions",
  "rewrite_bullet", "restructure_notes", "analyze", "parse_resume",
];

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
  const [showDelete, setShowDelete] = useState(false);

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
    <div className="w-full min-w-0 max-w-[900px] mx-auto p-gutter pb-xxl flex flex-col gap-section">
      <section className="pt-xs sm:pt-lg sm:pb-md">
        <h1
          className="text-headline-xl text-on-surface font-bold mb-sm"
          style={{ letterSpacing: "-0.02em" }}
        >
          Account
        </h1>
        <p className="hidden sm:block text-body-lg text-on-surface-variant">
          Your details, plan, and credit balance.
        </p>
      </section>

      {/* Your details */}
      <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
        <div className="flex items-center justify-between gap-sm mb-sm sm:mb-md">
          <h2 className="text-headline-md text-on-surface font-semibold flex items-center gap-xs sm:gap-sm">
            <User size={20} weight="fill" className="text-primary shrink-0" />
            Your details
            <InfoTooltip text="Pulled from My Profile — edit it there and it updates everywhere, including every resume and cover letter Copilot generates." />
          </h2>
          <Link
            href="/profile"
            className="shrink-0 text-label-md text-primary font-semibold flex items-center gap-xs hover:underline"
          >
            <span className="sm:hidden">Edit</span>
            <span className="hidden sm:inline">Edit in My Profile</span>
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
          {/* Plan beside Credits — on a phone too */}
          <div className="grid grid-cols-2 gap-gutter">
          <div className="min-w-0 bg-surface-container-lowest rounded-2xl p-md sm:p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 flex items-center justify-between gap-md">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-sm gap-y-xs">
                <span className="text-headline-md text-on-surface font-semibold capitalize">
                  {sub.plan} plan
                </span>
                <InfoTooltip text="Your plan sets how many credits you get and whether they refill monthly or are a one-time grant." />
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
            <Sparkle size={32} weight="fill" className="hidden sm:block text-primary shrink-0" />
          </div>

          {/* Credits */}
          <div className="min-w-0 bg-surface-container-lowest rounded-2xl p-md sm:p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
            <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-xs mb-sm sm:mb-md">
              <span className="text-label-md text-on-surface-variant flex items-center gap-xs">
                <Lightning size={16} weight="fill" className={low ? "text-error" : "text-primary"} />
                <span className="sm:hidden">Credits</span>
                <span className="hidden sm:inline">Credits remaining</span>
                <InfoTooltip text="Everything that uses AI spends credits — see the table below for exact costs." />
              </span>
              <span className={`text-headline-xl font-bold ${low ? "text-error" : "text-on-surface"}`}>
                {sub.credits_remaining}
                <span className="text-headline-md text-on-surface-variant/60 font-normal">
                  {" "}
                  of {sub.credits_allotment}
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
          </div>

          {/* Costs */}
          <div className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5">
            <h2 className="text-headline-md text-on-surface font-semibold mb-md flex items-center gap-sm">
              What credits cost
              <InfoTooltip text="How many credits each action deducts from your balance." />
            </h2>
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
              You&apos;re only charged when AI actually runs: reopening an analysis
              you&apos;ve already done, or interview questions you already have, is free.
            </p>
          </div>

        </>
      )}

      {/* Upgrade beside Help */}
      <div className="grid grid-cols-2 gap-gutter">
        {sub && !subError && (
          <Link
            href="/plans"
            className="min-w-0 bg-surface-container-low rounded-2xl p-md sm:p-lg border border-outline-variant/20 flex items-center justify-between gap-sm sm:gap-md hover:bg-surface-container active:bg-surface-container transition-colors"
          >
            <div className="flex items-start gap-sm sm:gap-md min-w-0">
              <Info size={20} className="hidden sm:block text-on-surface-variant shrink-0 mt-[2px]" />
              <div className="min-w-0">
                <p className="text-body-md text-on-surface font-medium">Need more credits?</p>
                <p className="text-body-sm text-on-surface-variant mt-xs">
                  <span className="sm:hidden">See plans</span>
                  <span className="hidden sm:inline">See plans — Premium refills your credits every month.</span>
                </p>
              </div>
            </div>
            <ArrowRight size={18} className="text-on-surface-variant shrink-0" />
          </Link>
        )}

        {/* Help */}
        <Link
          href="/dashboard?tour=1"
          className={`min-w-0 bg-surface-container-lowest rounded-2xl p-md sm:p-lg border border-outline-variant/20 shadow-lg shadow-on-surface/5 flex items-center justify-between gap-sm sm:gap-md hover:bg-surface-container-low active:bg-surface-container-low transition-colors w-full ${sub && !subError ? "" : "col-span-2"}`}
        >
          <div className="flex items-center gap-sm sm:gap-md min-w-0">
            <Compass size={20} weight="fill" className="hidden sm:block text-primary shrink-0" />
            <div className="min-w-0">
              <p className="text-body-md text-on-surface font-medium">Replay guide</p>
              <p className="text-body-sm text-on-surface-variant mt-xs">
                <span className="sm:hidden">Quick tour</span>
                <span className="hidden sm:inline">See the quick tour of what each section does, again.</span>
              </p>
            </div>
          </div>
          <ArrowRight size={18} className="text-on-surface-variant shrink-0" />
        </Link>
      </div>

      {/* Sign out */}
      <button
        onClick={handleSignOut}
        className="self-start flex items-center gap-sm px-lg py-md rounded-xl text-label-md font-semibold text-error border border-error/40 bg-error/5 hover:bg-error/10 transition-colors"
      >
        <SignOut size={18} weight="bold" />
        Sign out
      </button>

      {/* Danger zone */}
      <div className="rounded-2xl p-lg border border-error/40 bg-error/5">
        <h2 className="text-headline-md text-on-surface font-semibold flex items-center gap-sm">
          <Warning size={20} weight="fill" className="text-error" />
          Danger zone
          <InfoTooltip text="Deletes your resumes, cover letters, job descriptions, career profile, and plan — immediately and permanently. See the Privacy Policy for exactly what happens to backups." />
        </h2>
        <p className="text-body-sm text-on-surface-variant mt-xs">
          Permanently delete your account and everything in it. This cannot be
          undone.
        </p>
        <button
          onClick={() => setShowDelete(true)}
          className="mt-md flex items-center gap-sm px-lg py-md rounded-xl text-label-md font-semibold text-on-error bg-error hover:opacity-90 transition-opacity"
        >
          <Trash size={18} weight="bold" />
          Delete account
        </button>
      </div>

      {showDelete && <DeleteAccountModal onClose={() => setShowDelete(false)} />}

      {/* Legal */}
      <p className="text-body-sm text-on-surface-variant text-center pt-md">
        <Link href="/terms" className="hover:text-on-surface hover:underline">
          Terms of Service
        </Link>
        <span className="mx-sm text-outline-variant">·</span>
        <Link href="/privacy" className="hover:text-on-surface hover:underline">
          Privacy Policy
        </Link>
        <span className="mx-sm text-outline-variant">·</span>
        <Link href="/refunds" className="hover:text-on-surface hover:underline">
          Refund Policy
        </Link>
        <span className="mx-sm text-outline-variant">·</span>
        <Link href="/cookies" className="hover:text-on-surface hover:underline">
          Cookie Policy
        </Link>
        <span className="mx-sm text-outline-variant">·</span>
        <Link href="/data-deletion" className="hover:text-on-surface hover:underline">
          Delete your data
        </Link>
      </p>
    </div>
  );
}

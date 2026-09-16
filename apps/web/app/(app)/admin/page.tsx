"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Star, LockSimple, ArrowsClockwise } from "@phosphor-icons/react";
import { apiClient, ApiError } from "@/lib/api-client";
import type { FeedbackAdmin, AdminUser } from "@career-copilot/types";

type Tab = "users" | "feedback";

// Admin-only — every endpoint here returns 403 for any account not in the
// backend's ADMIN_EMAILS allowlist, surfaced below as a plain "no access"
// state rather than gating navigation to this route client-side.
export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("users");

  return (
    <div className="p-xl max-w-4xl mx-auto flex flex-col gap-lg">
      <h1 className="text-title-lg text-on-surface font-semibold">Admin</h1>

      <div className="flex items-center gap-sm border-b border-outline-variant/20">
        {(["users", "feedback"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-lg py-sm text-label-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {t === "users" ? "Users" : "Feedback"}
          </button>
        ))}
      </div>

      {tab === "users" ? <UsersTab /> : <FeedbackTab />}
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="p-xl flex flex-col items-center justify-center gap-md text-center h-full">
      <LockSimple size={32} className="text-on-surface-variant" />
      <p className="text-body-md text-on-surface-variant">You don&apos;t have access to this page.</p>
    </div>
  );
}

function UsersTab() {
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<AdminUser[]>({
    queryKey: ["admin-users"],
    queryFn: () => apiClient.getAdminUsers(),
    retry: false,
  });

  const planMutation = useMutation({
    mutationFn: ({ userId, plan }: { userId: string; plan: "free" | "premium" }) =>
      apiClient.updateUserPlan(userId, plan),
    onMutate: ({ userId }) => setPendingId(userId),
    onSettled: () => setPendingId(null),
    onSuccess: (updated) => {
      queryClient.setQueryData<AdminUser[]>(["admin-users"], (old) =>
        old?.map((u) => (u.id === updated.id ? updated : u))
      );
    },
  });

  const refreshMutation = useMutation({
    mutationFn: (userId: string) => apiClient.refreshUserCredits(userId),
    onMutate: (userId) => setPendingId(userId),
    onSettled: () => setPendingId(null),
    onSuccess: (updated) => {
      queryClient.setQueryData<AdminUser[]>(["admin-users"], (old) =>
        old?.map((u) => (u.id === updated.id ? updated : u))
      );
    },
  });

  if (error instanceof ApiError && error.status === 403) return <AccessDenied />;

  return (
    <div className="flex flex-col gap-sm">
      {isLoading && <p className="text-body-sm text-on-surface-variant">Loading...</p>}

      {data?.map((u) => {
        const isPending = pendingId === u.id;
        return (
          <div
            key={u.id}
            className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 flex flex-col sm:flex-row sm:items-center gap-md justify-between"
          >
            <div className="min-w-0">
              <p className="text-body-md text-on-surface font-medium truncate">{u.email ?? u.id}</p>
              <p className="text-label-sm text-on-surface-variant">
                {u.plan} · {u.status} · {u.credits_remaining}/{u.credits_allotment} credits
                {u.current_period_end && ` · renews ${new Date(u.current_period_end).toLocaleDateString()}`}
              </p>
            </div>
            <div className="flex items-center gap-sm shrink-0">
              <button
                onClick={() =>
                  planMutation.mutate({ userId: u.id, plan: u.plan === "premium" ? "free" : "premium" })
                }
                disabled={isPending}
                className="px-md py-xs rounded-lg text-label-sm text-on-primary bg-primary hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {u.plan === "premium" ? "Downgrade to Free" : "Upgrade to Pro"}
              </button>
              <button
                onClick={() => refreshMutation.mutate(u.id)}
                disabled={isPending}
                aria-label="Refresh credits"
                className="p-sm rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors disabled:opacity-40"
              >
                <ArrowsClockwise size={16} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-[2px]">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={16}
          weight={n <= rating ? "fill" : "regular"}
          className={n <= rating ? "text-tertiary" : "text-outline-variant"}
        />
      ))}
    </div>
  );
}

function FeedbackTab() {
  const { data, isLoading, error } = useQuery<FeedbackAdmin[]>({
    queryKey: ["feedback-admin"],
    queryFn: () => apiClient.getFeedback(),
    retry: false,
  });

  if (error instanceof ApiError && error.status === 403) return <AccessDenied />;

  return (
    <div className="flex flex-col gap-sm">
      {isLoading && <p className="text-body-sm text-on-surface-variant">Loading...</p>}

      {data && data.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">No feedback submitted yet.</p>
      )}

      {data?.map((f) => (
        <div
          key={f.id}
          className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 flex flex-col gap-xs"
        >
          <div className="flex items-center justify-between">
            <Stars rating={f.rating} />
            <span className="text-label-sm text-on-surface-variant">
              {new Date(f.created_at).toLocaleString()}
            </span>
          </div>
          {f.comment && <p className="text-body-sm text-on-surface whitespace-pre-wrap">{f.comment}</p>}
          {f.page && <p className="text-label-sm text-on-surface-variant">from {f.page}</p>}
        </div>
      ))}
    </div>
  );
}

"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Star, LockSimple, ArrowsClockwise } from "@phosphor-icons/react";
import { apiClient, ApiError } from "@/lib/api-client";
import type { FeedbackAdmin, AdminUser, DeletionRequestAdmin, DeletionRequestStatus } from "@career-copilot/types";

type Tab = "users" | "feedback" | "deletion";

const TAB_LABELS: Record<Tab, string> = {
  users: "Users",
  feedback: "Feedback",
  deletion: "Deletion requests",
};

// Admin-only — every endpoint here returns 403 for any account not in the
// backend's ADMIN_EMAILS allowlist, surfaced below as a plain "no access"
// state rather than gating navigation to this route client-side.
export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("users");

  return (
    <div className="p-xl max-w-5xl mx-auto flex flex-col gap-lg">
      <h1 className="text-title-lg text-on-surface font-semibold">Admin</h1>

      <div className="flex items-center gap-sm border-b border-outline-variant/20">
        {(["users", "feedback", "deletion"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-lg py-sm text-label-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "users" ? <UsersTab /> : tab === "feedback" ? <FeedbackTab /> : <DeletionRequestsTab />}
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
    <div className="flex flex-col gap-md">
      <p className="text-body-sm text-on-surface-variant">
        {isLoading ? "Loading..." : `${data?.length ?? 0} user${data?.length === 1 ? "" : "s"}`}
      </p>

      {data && data.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-outline-variant/20">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container text-label-sm text-on-surface-variant">
                <th className="px-md py-sm font-semibold">Name</th>
                <th className="px-md py-sm font-semibold">Email</th>
                <th className="px-md py-sm font-semibold">Plan</th>
                <th className="px-md py-sm font-semibold">Status</th>
                <th className="px-md py-sm font-semibold">Credits</th>
                <th className="px-md py-sm font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {data.map((u) => {
                const isPending = pendingId === u.id;
                const isActive = u.status === "active";
                return (
                  <tr key={u.id} className="border-t border-outline-variant/20 bg-surface-container-lowest">
                    <td className="px-md py-sm text-body-sm text-on-surface">{u.name ?? "—"}</td>
                    <td className="px-md py-sm text-body-sm text-on-surface truncate max-w-[220px]">
                      {u.email ?? "—"}
                    </td>
                    <td className="px-md py-sm text-body-sm">
                      <span
                        className={`px-sm py-[2px] rounded-full text-label-sm font-medium ${
                          u.plan === "premium"
                            ? "bg-primary-fixed text-on-primary-fixed"
                            : "bg-surface-container-high text-on-surface-variant"
                        }`}
                      >
                        {u.plan === "premium" ? "Paid" : "Free"}
                      </span>
                    </td>
                    <td className="px-md py-sm text-body-sm">
                      <span
                        className={`px-sm py-[2px] rounded-full text-label-sm font-medium ${
                          isActive
                            ? "bg-success-container text-on-success-container"
                            : "bg-error-container text-on-error-container"
                        }`}
                      >
                        {isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-md py-sm text-body-sm text-on-surface-variant whitespace-nowrap">
                      {u.credits_remaining}/{u.credits_allotment}
                    </td>
                    <td className="px-md py-sm">
                      <div className="flex items-center justify-end gap-sm">
                        <button
                          onClick={() =>
                            planMutation.mutate({
                              userId: u.id,
                              plan: u.plan === "premium" ? "free" : "premium",
                            })
                          }
                          disabled={isPending}
                          className="px-md py-xs rounded-lg text-label-sm text-on-primary bg-primary hover:opacity-90 transition-opacity disabled:opacity-40 whitespace-nowrap"
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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
    <div className="flex flex-col gap-md">
      <p className="text-body-sm text-on-surface-variant">
        {isLoading ? "Loading..." : `${data?.length ?? 0} submission${data?.length === 1 ? "" : "s"}`}
      </p>

      {data && data.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">No feedback submitted yet.</p>
      )}

      {data && data.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-outline-variant/20">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container text-label-sm text-on-surface-variant">
                <th className="px-md py-sm font-semibold">Name</th>
                <th className="px-md py-sm font-semibold">Email</th>
                <th className="px-md py-sm font-semibold">Rating</th>
                <th className="px-md py-sm font-semibold">Feedback</th>
                <th className="px-md py-sm font-semibold">Date</th>
              </tr>
            </thead>
            <tbody>
              {data.map((f) => (
                <tr key={f.id} className="border-t border-outline-variant/20 bg-surface-container-lowest align-top">
                  <td className="px-md py-sm text-body-sm text-on-surface whitespace-nowrap">{f.name ?? "—"}</td>
                  <td className="px-md py-sm text-body-sm text-on-surface truncate max-w-[220px]">
                    {f.email ?? "—"}
                  </td>
                  <td className="px-md py-sm">
                    <Stars rating={f.rating} />
                  </td>
                  <td className="px-md py-sm text-body-sm text-on-surface whitespace-pre-wrap max-w-[320px]">
                    {f.comment ?? "—"}
                    {f.page && <div className="text-label-sm text-on-surface-variant mt-xs">from {f.page}</div>}
                  </td>
                  <td className="px-md py-sm text-label-sm text-on-surface-variant whitespace-nowrap">
                    {new Date(f.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Requests from the public /data-deletion page. Anyone can send one, so
 * nothing here deletes anything: confirm by email that the request came from
 * the address given, delete the data (for an account, via Supabase or the
 * user's own Account page), then record the outcome.
 */
function DeletionRequestsTab() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<DeletionRequestAdmin[]>({
    queryKey: ["deletion-requests-admin"],
    queryFn: () => apiClient.getDeletionRequests(),
    retry: false,
  });
  const update = useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: DeletionRequestStatus; note: string | null }) =>
      apiClient.updateDeletionRequest(id, status, note),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["deletion-requests-admin"] }),
  });

  if (error instanceof ApiError && error.status === 403) return <AccessDenied />;

  function close(r: DeletionRequestAdmin, status: "completed" | "declined") {
    const note = window.prompt(
      status === "completed"
        ? "What was deleted, and how was the requester verified?"
        : "Why was this declined? (This is kept as the record.)",
      r.resolution_note ?? "",
    );
    if (note === null) return;
    update.mutate({ id: r.id, status, note: note.trim() || null });
  }

  const open = data?.filter((r) => r.status === "open").length ?? 0;

  return (
    <div className="flex flex-col gap-md">
      <p className="text-body-sm text-on-surface-variant">
        {isLoading
          ? "Loading..."
          : `${open} open of ${data?.length ?? 0}. Reply within 7 days to verify, and finish within 30 days of confirmation.`}
      </p>

      {data && data.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">No deletion requests yet.</p>
      )}

      {data && data.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-outline-variant/20">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container text-label-sm text-on-surface-variant">
                <th className="px-md py-sm font-semibold">Received</th>
                <th className="px-md py-sm font-semibold">Requester</th>
                <th className="px-md py-sm font-semibold">Request</th>
                <th className="px-md py-sm font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className="border-t border-outline-variant/20 bg-surface-container-lowest align-top">
                  <td className="px-md py-sm text-label-sm text-on-surface-variant whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-md py-sm text-body-sm text-on-surface max-w-[240px]">
                    <div className="truncate">{r.email}</div>
                    {r.name && <div className="text-label-sm text-on-surface-variant">{r.name}</div>}
                    <div className="text-label-sm text-on-surface-variant mt-xs">
                      {r.requester_type === "account_holder" ? "Says they have an account" : "Says they aren't a user"}
                      {" · "}
                      <span className={r.has_account ? "text-primary font-semibold" : ""}>
                        {r.has_account ? "account found" : "no account with this email"}
                      </span>
                    </div>
                  </td>
                  <td className="px-md py-sm text-body-sm text-on-surface whitespace-pre-wrap max-w-[320px]">
                    {r.details ?? "—"}
                  </td>
                  <td className="px-md py-sm text-body-sm text-on-surface min-w-[180px]">
                    {r.status === "open" ? (
                      <div className="flex flex-col gap-xs">
                        <span className="text-label-sm font-semibold text-error">Open</span>
                        <div className="flex gap-sm">
                          <button
                            onClick={() => close(r, "completed")}
                            disabled={update.isPending}
                            className="text-label-sm text-primary hover:underline disabled:opacity-50"
                          >
                            Mark completed
                          </button>
                          <button
                            onClick={() => close(r, "declined")}
                            disabled={update.isPending}
                            className="text-label-sm text-on-surface-variant hover:underline disabled:opacity-50"
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-xs">
                        <span className="text-label-sm font-semibold capitalize">{r.status}</span>
                        {r.resolved_at && (
                          <span className="text-label-sm text-on-surface-variant">
                            {new Date(r.resolved_at).toLocaleDateString()}
                          </span>
                        )}
                        {r.resolution_note && (
                          <span className="text-label-sm text-on-surface-variant whitespace-pre-wrap">
                            {r.resolution_note}
                          </span>
                        )}
                        <button
                          onClick={() => update.mutate({ id: r.id, status: "open", note: r.resolution_note })}
                          disabled={update.isPending}
                          className="self-start text-label-sm text-on-surface-variant hover:underline disabled:opacity-50"
                        >
                          Reopen
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

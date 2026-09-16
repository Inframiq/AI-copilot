"use client";
import { useQuery } from "@tanstack/react-query";
import { Star, LockSimple } from "@phosphor-icons/react";
import { apiClient, ApiError } from "@/lib/api-client";
import type { FeedbackAdmin } from "@career-copilot/types";

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

// Admin-only — the backend returns 403 for any account not in
// settings.admin_emails, which we surface as a plain "not authorized" state
// rather than gating navigation to this route client-side.
export default function FeedbackAdminPage() {
  const { data, isLoading, error } = useQuery<FeedbackAdmin[]>({
    queryKey: ["feedback-admin"],
    queryFn: () => apiClient.getFeedback(),
    retry: false,
  });

  if (error instanceof ApiError && error.status === 403) {
    return (
      <div className="p-xl flex flex-col items-center justify-center gap-md text-center h-full">
        <LockSimple size={32} className="text-on-surface-variant" />
        <p className="text-body-md text-on-surface-variant">You don&apos;t have access to this page.</p>
      </div>
    );
  }

  return (
    <div className="p-xl max-w-3xl mx-auto flex flex-col gap-lg">
      <h1 className="text-title-lg text-on-surface font-semibold">User feedback</h1>

      {isLoading && <p className="text-body-sm text-on-surface-variant">Loading...</p>}

      {data && data.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">No feedback submitted yet.</p>
      )}

      <div className="flex flex-col gap-sm">
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
    </div>
  );
}

"use client";
import { CloudSlash, ArrowClockwise } from "@phosphor-icons/react";

/**
 * Shown when a page's data queries fail to reach the API — almost always the
 * FastAPI backend being unreachable (spun down, redeploying, network blip)
 * rather than a real "you have no data" state. Without this, every list on
 * the page falls back to its empty default (`= []`) and the UI renders a
 * fully-populated "0 resumes / 0 applications / no analyses yet" screen,
 * which reads as "my data got deleted" instead of "the server is down".
 */
export function ConnectionErrorBanner({
  show,
  onRetry,
  isRetrying = false,
  message = "Can't reach the server right now — this page may be showing incomplete data. Your saved work is safe.",
}: {
  show: boolean;
  onRetry?: () => void;
  isRetrying?: boolean;
  message?: string;
}) {
  if (!show) return null;
  return (
    <div
      role="alert"
      className="rounded-2xl border border-error/30 bg-error-container/25 p-md flex items-center gap-md flex-wrap"
    >
      <CloudSlash size={20} weight="fill" className="text-error shrink-0" />
      <p className="text-label-md text-on-error-container flex-1 min-w-[12rem]">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying}
          className="flex items-center gap-xs text-label-sm text-error border border-error/30 px-md py-xs rounded-lg hover:bg-error/10 transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ArrowClockwise size={14} className={isRetrying ? "animate-spin" : ""} />
          {isRetrying ? "Retrying…" : "Retry"}
        </button>
      )}
    </div>
  );
}

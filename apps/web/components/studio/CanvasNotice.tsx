"use client";

/**
 * The states where there is no document to show: waiting, empty, failed.
 *
 * They used to share one flat treatment — a dashed drop-zone frame, a 13px
 * "title" barely larger than the 11px detail under it, and no semantics — so
 * a failure read the same as a wait and a screen reader was told neither.
 * Each now announces itself correctly and carries a tone that matches what
 * happened, while keeping the document's width so the page does not jump
 * when the résumé arrives.
 */
export function CanvasNotice({
  tone = "neutral",
  icon,
  title,
  detail,
  action,
}: {
  /** "working" waits politely; "problem" interrupts, and looks like it. */
  tone?: "neutral" | "working" | "problem";
  icon: React.ReactNode;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  const problem = tone === "problem";
  return (
    <section
      role={problem ? "alert" : tone === "working" ? "status" : undefined}
      aria-live={tone === "working" ? "polite" : undefined}
      className={`mx-auto flex w-full max-w-[8.5in] flex-col items-center gap-sm rounded-2xl border px-lg py-xxl text-center ${
        problem
          ? "border-error/30 bg-error-container/30"
          : "border-outline-variant/40 bg-surface"
      }`}
    >
      <span className={problem ? "text-error" : "text-on-surface-variant/70"}>{icon}</span>
      <h2 className="text-body-lg font-semibold text-on-surface">{title}</h2>
      <p className="max-w-prose text-body-sm text-on-surface-variant">{detail}</p>
      {action && <div className="mt-sm">{action}</div>}
    </section>
  );
}

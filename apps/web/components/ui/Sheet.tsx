"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";
import { FOCUS_RING } from "@/lib/focus";

/**
 * A decision that needs an answer before going on: a sheet from the bottom
 * on phones, a centred card from sm up. Closing it — the X, Escape, a click
 * outside — always means the cautious answer (onClose).
 *
 * Rendered into <body>, not where it is used: the page's entry animation
 * transforms its content, and a transformed ancestor traps position:fixed —
 * the sheet then sat under the phone's tab bar, which took its taps.
 */
export function Sheet({
  labelledBy,
  describedBy,
  onClose,
  dismissible = true,
  role = "dialog",
  children,
}: {
  labelledBy: string;
  describedBy?: string;
  onClose: () => void;
  /** False while something is in flight that must not be walked away from
   * (deleting, saving): no X, and Escape or a click outside do nothing. */
  dismissible?: boolean;
  /** "alertdialog" for a question that has to be answered before going on. */
  role?: "dialog" | "alertdialog";
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismissible && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, dismissible]);

  // Keyboard focus starts inside, so Tab and Enter act on the sheet.
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [mounted]);

  if (!mounted) return null;
  return createPortal(
    <>
      <div className="sheet-backdrop-enter fixed inset-0 z-[70] bg-on-surface/40 backdrop-blur-[2px]" onClick={dismissible ? onClose : undefined} />
      <div className="fixed inset-0 z-[71] flex items-end sm:items-center justify-center sm:p-lg pointer-events-none">
        <div
          ref={panel}
          role={role}
          aria-modal="true"
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          className="sheet-enter pointer-events-auto relative w-full sm:max-w-[30rem] max-h-[92dvh] overflow-y-auto bg-surface-container-lowest rounded-t-2xl sm:rounded-2xl border border-outline-variant/30 shadow-2xl pb-[env(safe-area-inset-bottom)]"
        >
          <div className="sm:hidden mx-auto mt-sm h-1 w-10 rounded-full bg-outline-variant/70" aria-hidden />
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className={`absolute right-sm top-sm p-sm rounded-full text-on-surface-variant hover:bg-surface-container ${FOCUS_RING}`}
            >
              <X size={18} />
            </button>
          )}
          {children}
        </div>
      </div>
    </>,
    document.body,
  );
}

/** The top of a sheet: a small label saying what kind of decision this is,
 * the question itself, and a line on what it means. */
export function SheetHeader({
  eyebrow,
  tone = "text-primary",
  titleId,
  title,
  descriptionId,
  children,
}: {
  eyebrow: string;
  tone?: string;
  titleId: string;
  title: React.ReactNode;
  descriptionId?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="pr-xl">
      <p className={`font-label-caps text-label-caps uppercase ${tone}`}>{eyebrow}</p>
      <h2 id={titleId} className="mt-sm text-headline-md text-on-surface">
        {title}
      </h2>
      {children && (
        <div id={descriptionId} className="mt-xs text-body-sm text-on-surface-variant">
          {children}
        </div>
      )}
    </div>
  );
}

/** The padded body every sheet's content sits in. */
export function SheetBody({ children }: { children: React.ReactNode }) {
  return <div className="px-md sm:px-lg pt-md sm:pt-lg pb-md sm:pb-lg flex flex-col gap-md">{children}</div>;
}

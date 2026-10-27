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
  children,
}: {
  labelledBy: string;
  describedBy?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Keyboard focus starts inside, so Tab and Enter act on the sheet.
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [mounted]);

  if (!mounted) return null;
  return createPortal(
    <>
      <div className="sheet-backdrop-enter fixed inset-0 z-[70] bg-on-surface/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="fixed inset-0 z-[71] flex items-end sm:items-center justify-center sm:p-lg pointer-events-none">
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          className="sheet-enter pointer-events-auto relative w-full sm:max-w-[30rem] max-h-[92dvh] overflow-y-auto bg-surface-container-lowest rounded-t-2xl sm:rounded-2xl border border-outline-variant/30 shadow-2xl pb-[env(safe-area-inset-bottom)]"
        >
          <div className="sm:hidden mx-auto mt-sm h-1 w-10 rounded-full bg-outline-variant/70" aria-hidden />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`absolute right-sm top-sm p-sm rounded-full text-on-surface-variant hover:bg-surface-container ${FOCUS_RING}`}
          >
            <X size={18} />
          </button>
          {children}
        </div>
      </div>
    </>,
    document.body,
  );
}

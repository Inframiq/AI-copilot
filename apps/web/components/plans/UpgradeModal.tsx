"use client";
import { useEffect } from "react";
import { X, Sparkle } from "@phosphor-icons/react";

export function UpgradeModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-on-surface/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-lg pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Premium is not yet available"
          className="pointer-events-auto w-full max-w-[26rem] bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-2xl p-lg"
        >
          <div className="flex items-start justify-between gap-md">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Sparkle size={20} weight="fill" className="text-primary" />
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="text-on-surface-variant hover:bg-surface-container-high/50 p-xs rounded-full transition-colors"
            >
              <X size={18} />
            </button>
          </div>
          <h2 className="text-headline-md text-on-surface font-semibold mt-md">
            Premium is not yet available
          </h2>
          <p className="text-body-sm text-on-surface-variant mt-xs">
            Premium purchases will open soon. The account remains on the Free plan until then.
          </p>
          <button
            onClick={onClose}
            className="mt-lg w-full py-md rounded-xl text-label-md font-semibold bg-primary text-on-primary hover:opacity-90 transition-colors"
          >
            OK
          </button>
        </div>
      </div>
    </>
  );
}

"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, EnvelopeSimple, Question, X } from "@phosphor-icons/react";

export const SUPPORT_EMAIL = "support@inframiq.com";
/** A mail link with the subject filled in, so requests arrive labelled. */
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("KripaX support request")}`;

/**
 * "Need help?" in the top bar, beside "Send feedback", on every page and at
 * every width. Opens a small panel with the support address, a button that
 * starts an email, and one that copies the address: a bare mailto link does
 * nothing for someone with no mail app set up.
 */
export function HelpButton() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard access: the address is on screen to copy by hand.
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Need help?"
        title="Need help?"
        className="p-sm rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors shrink-0"
      >
        <Question size={20} />
      </button>

      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40 bg-on-surface/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-lg pointer-events-none">
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="help-title"
                className="pointer-events-auto w-full max-w-[26rem] bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-2xl p-lg flex flex-col gap-md"
              >
                <div className="flex items-start justify-between gap-md">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Question size={20} weight="fill" className="text-primary" />
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                    className="text-on-surface-variant hover:bg-surface-container-high/50 p-xs rounded-full transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="flex flex-col gap-xs">
                  <h2 id="help-title" className="text-headline-md text-on-surface font-semibold">Need help?</h2>
                  <p className="text-body-sm text-on-surface-variant">
                    For questions about your account, credits or a feature, email the support team at{" "}
                    <span className="font-semibold text-on-surface">{SUPPORT_EMAIL}</span>.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-sm">
                  <a
                    href={SUPPORT_MAILTO}
                    className="flex items-center justify-center gap-xs py-sm rounded-xl text-label-md font-semibold bg-primary text-on-primary hover:opacity-90 transition-opacity"
                  >
                    <EnvelopeSimple size={16} />
                    Email support
                  </a>
                  <button
                    type="button"
                    onClick={copy}
                    className="flex items-center justify-center gap-xs py-sm rounded-xl text-label-md font-semibold border border-outline-variant/40 text-on-surface hover:bg-surface-container-high/50 transition-colors"
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    {copied ? "Copied" : "Copy address"}
                  </button>
                </div>
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import { CircleNotch, IdentificationBadge, X } from "@phosphor-icons/react";
import type { Resume } from "@career-copilot/types";
import { apiClient } from "@/lib/api-client";
import { useHeadlineConfirmStore } from "@/stores/headline-confirm-store";

const MAX_LENGTH = 120;

/**
 * Right after a résumé upload: "is this your headline?" — the line under the
 * name, which the parser misreads most often. The person keeps it, fixes it
 * or adds one; Skip (or closing) leaves the résumé exactly as it was read.
 * Mounted once, app-wide, in app/providers.tsx.
 */
export function HeadlineConfirmModal() {
  const resume = useHeadlineConfirmStore((s) => s.resume);
  const resolve = useHeadlineConfirmStore((s) => s.resolve);

  useEffect(() => {
    useHeadlineConfirmStore.setState((s) => ({ mounted: s.mounted + 1 }));
    return () => useHeadlineConfirmStore.setState((s) => ({ mounted: s.mounted - 1 }));
  }, []);

  if (!resume || !resolve) return null;
  return <HeadlineDialog key={resume.id} resume={resume} resolve={resolve} />;
}

function HeadlineDialog({ resume, resolve }: { resume: Resume; resolve: (resume: Resume) => void }) {
  const read = (resume.content.headline ?? "").trim();
  const [value, setValue] = useState(read);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const found = read.length > 0;
  const next = value.trim();

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && resolve(resume);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, resolve, resume]);

  async function confirm() {
    if (next === read) return resolve(resume);
    setSaving(true);
    setError(null);
    try {
      const saved = await apiClient.updateResume(resume.id, {
        content: { ...resume.content, headline: next || undefined },
        expected_updated_at: resume.updated_at,
      });
      resolve(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save it. Try again.");
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-on-surface/30 backdrop-blur-sm" onClick={() => !saving && resolve(resume)} />
      <div className="fixed inset-0 z-[71] flex items-end sm:items-center justify-center p-sm sm:p-lg pointer-events-none">
        <form
          role="dialog"
          aria-modal="true"
          aria-labelledby="headline-confirm-title"
          aria-describedby="headline-confirm-help"
          onSubmit={(e) => { e.preventDefault(); if (!saving) void confirm(); }}
          className="pointer-events-auto w-full max-w-[30rem] bg-surface-container-lowest rounded-2xl border border-outline-variant/20 shadow-2xl"
        >
          <div className="p-md sm:p-lg pb-sm flex items-start gap-md">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <IdentificationBadge size={20} className="text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 id="headline-confirm-title" className="text-headline-md text-on-surface font-semibold">
                {found ? "Is this your headline?" : "Add a headline?"}
              </h2>
              <p id="headline-confirm-help" className="text-body-sm text-on-surface-variant mt-xs">
                {found
                  ? "It's the line under your name. We read it from your résumé — fix it if it's off."
                  : "We didn't find one on your résumé. It's the line under your name — your role and what you focus on."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => resolve(resume)}
              disabled={saving}
              aria-label="Skip"
              className="shrink-0 p-xs -m-xs rounded-full text-on-surface-variant hover:bg-surface-container-high/50 disabled:opacity-40"
            >
              <X size={18} />
            </button>
          </div>

          <div className="px-md sm:px-lg py-xs">
            <label htmlFor="headline-confirm-input" className="sr-only">Headline</label>
            <input
              id="headline-confirm-input"
              ref={inputRef}
              value={value}
              onChange={(e) => { setValue(e.target.value); setError(null); }}
              maxLength={MAX_LENGTH}
              disabled={saving}
              placeholder="e.g. Supply Chain Analyst | SAP · Power BI"
              className="w-full rounded-xl border border-outline-variant/40 bg-surface px-sm py-sm text-body-md text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
            />
            {error && <p role="alert" className="text-caption text-error pt-xs">{error}</p>}
          </div>

          <div className="p-md sm:p-lg pt-sm flex gap-sm">
            <button
              type="button"
              onClick={() => resolve(resume)}
              disabled={saving}
              className="flex-1 py-sm rounded-xl border border-outline-variant/40 text-label-md text-on-surface hover:bg-surface-container disabled:opacity-50"
            >
              Skip
            </button>
            <button
              type="submit"
              disabled={saving || (!found && !next)}
              className="flex-1 inline-flex items-center justify-center gap-xs py-sm rounded-xl bg-primary text-on-primary text-label-md font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {saving && <CircleNotch size={16} className="animate-spin motion-reduce:animate-none" />}
              {saving ? "Saving…" : next === read ? "Looks right" : "Save headline"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

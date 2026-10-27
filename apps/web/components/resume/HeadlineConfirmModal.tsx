"use client";
import { useEffect, useRef, useState } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import type { Resume } from "@career-copilot/types";
import { apiClient } from "@/lib/api-client";
import { FOCUS_RING } from "@/lib/focus";
import { Sheet, SheetBody, SheetHeader } from "@/components/ui/Sheet";
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
  }, []);

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

  // Skip, the X, Escape or a click outside all leave the résumé as it was
  // read; not while a save is on its way.
  return (
    <Sheet
      labelledBy="headline-confirm-title"
      describedBy="headline-confirm-help"
      onClose={() => resolve(resume)}
      dismissible={!saving}
    >
      <form onSubmit={(e) => { e.preventDefault(); if (!saving) void confirm(); }}>
        <SheetBody>
          <SheetHeader
            eyebrow="Uploaded résumé"
            titleId="headline-confirm-title"
            title={found ? "Is this your headline?" : "Add a headline?"}
            descriptionId="headline-confirm-help"
          >
            {found
              ? "It's the line under your name, as read from your résumé. Fix it if it's off."
              : "None was found on your résumé. It's the line under your name: your role and what you focus on."}
          </SheetHeader>

          <div>
            <label htmlFor="headline-confirm-input" className="sr-only">Headline</label>
            <input
              id="headline-confirm-input"
              ref={inputRef}
              value={value}
              onChange={(e) => { setValue(e.target.value); setError(null); }}
              maxLength={MAX_LENGTH}
              disabled={saving}
              placeholder="e.g. Supply Chain Analyst | SAP · Power BI"
              className="w-full rounded-lg border border-outline-variant/60 bg-surface px-md py-sm text-body-md text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary disabled:opacity-60"
            />
            {error && <p role="alert" className="text-caption text-error pt-xs">{error}</p>}
          </div>

          <div className="flex gap-sm">
            <button
              type="button"
              onClick={() => resolve(resume)}
              disabled={saving}
              className={`flex-1 py-sm rounded-lg border border-outline-variant/50 text-label-md text-on-surface hover:bg-surface-container disabled:opacity-50 ${FOCUS_RING}`}
            >
              Skip
            </button>
            <button
              type="submit"
              disabled={saving || (!found && !next)}
              className={`flex-[1.4] inline-flex items-center justify-center gap-xs py-sm rounded-lg bg-primary text-on-primary text-label-md font-semibold hover:bg-primary-container disabled:opacity-50 ${FOCUS_RING}`}
            >
              {saving && <CircleNotch size={16} className="animate-spin motion-reduce:animate-none" />}
              {saving ? "Saving…" : next === read ? "Looks right" : "Save headline"}
            </button>
          </div>
        </SheetBody>
      </form>
    </Sheet>
  );
}

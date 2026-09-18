"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowsClockwise, Layout, SpinnerGap } from "@phosphor-icons/react";
import { useResumeStore } from "@/stores/resume-store";
import { TemplateGallery } from "./TemplateGallery";
import { SpacingPopover } from "./SpacingPopover";
import { TypePopover } from "./TypePopover";

// Four triggers on one floating pill replace PreviewPanel's wrapping bar of
// five equal-weight controls, plus its two mutually-exclusive regenerate
// buttons and a third, disabled "Preview up to date" label that was a
// button doing nothing. Exactly one refresh control lives here, and there
// is no download control anywhere in the dock — export lives in the
// command bar (Task 11); a second download here would just duplicate it.
export function DockToolbar({
  onRefresh,
  isRefreshing,
  isStale,
}: {
  onRefresh: () => void;
  isRefreshing: boolean;
  isStale: boolean;
}) {
  const templateId = useResumeStore((s) => s.templateId);
  const setTemplateId = useResumeStore((s) => s.setTemplateId);

  const [galleryOpen, setGalleryOpen] = useState(false);
  const galleryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!galleryOpen) return;
    function handleClick(e: MouseEvent) {
      if (galleryRef.current && !galleryRef.current.contains(e.target as Node)) setGalleryOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [galleryOpen]);

  const refreshLabel = isRefreshing ? "Refreshing…" : isStale ? "Update preview" : "Refresh preview";

  return (
    <div className="flex items-center gap-xs rounded-full border border-desk-line bg-desk-raised px-sm py-xs shadow-2xl">
      <TypePopover />
      <SpacingPopover />

      <div ref={galleryRef} className="relative">
        <button
          type="button"
          aria-label="Template"
          aria-haspopup="dialog"
          aria-expanded={galleryOpen}
          onClick={() => setGalleryOpen((o) => !o)}
          className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
            galleryOpen ? "bg-primary/20 text-primary" : "text-on-desk hover:bg-desk-line/60"
          }`}
        >
          <Layout size={18} />
        </button>
        {galleryOpen && (
          <div
            role="dialog"
            aria-label="Template gallery"
            className="absolute bottom-full left-1/2 mb-sm w-72 -translate-x-1/2 rounded-2xl border border-desk-line bg-desk-raised p-md shadow-2xl"
          >
            <TemplateGallery
              value={templateId}
              onChange={(id) => {
                setTemplateId(id);
                setGalleryOpen(false);
              }}
            />
          </div>
        )}
      </div>

      <div className="mx-xs h-6 w-px bg-desk-line" />

      {/* Cosmetic readout — no page-count/zoom state exists yet to drive it;
          a future task can wire real values in without changing this shape. */}
      <span className="tabular whitespace-nowrap px-sm text-label-sm text-on-desk">Page 1 · 100%</span>

      <div className="mx-xs h-6 w-px bg-desk-line" />

      <button
        type="button"
        onClick={onRefresh}
        disabled={isRefreshing}
        className={`flex items-center gap-xs rounded-full px-md py-sm text-label-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          isStale
            ? "bg-primary text-on-primary hover:bg-primary-container"
            : "text-on-desk hover:bg-desk-line/60"
        }`}
      >
        {isRefreshing ? (
          <SpinnerGap size={16} className="animate-spin" />
        ) : (
          <ArrowsClockwise size={16} />
        )}
        {refreshLabel}
      </button>
    </div>
  );
}

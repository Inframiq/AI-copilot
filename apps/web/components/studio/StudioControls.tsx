"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowsOutLineVertical, Cards, TextAa } from "@phosphor-icons/react";
import { useResumeStore } from "@/stores/resume-store";
import { TemplateGallery } from "@/components/studio/preview/TemplateGallery";
import { TypePanel } from "@/components/studio/preview/TypePopover";
import { SpacingPanel } from "@/components/studio/preview/SpacingPopover";
import { FOCUS_RING } from "@/lib/focus";

/**
 * Template, type and spacing for the document on screen.
 *
 * These controls lived in the preview dock. Deleting the dock left them with
 * no caller at all, so the whole app had no way to change template — the only
 * live setTemplateId was the photo modal reverting one. This is the home the
 * design always intended for them.
 *
 * They open downward and wear the surface palette: the dock sat at the bottom
 * of the screen in a dark chrome, and both assumptions are wrong in a header.
 */
function Popover({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-9 items-center gap-xs rounded-xl px-sm text-label-sm transition-colors ${FOCUS_RING} ${
          open
            ? "bg-primary/10 text-primary"
            : "text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
        }`}
      >
        {icon}
        <span className="hidden lg:inline">{label}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={label}
          // Five thumbnails at page aspect ratio overrun a laptop viewport, so the
          // panel scrolls inside itself rather than off the bottom of the screen.
          className="absolute top-full right-0 z-20 mt-sm max-h-[70vh] w-72 overflow-y-auto rounded-2xl border border-outline-variant/40 bg-surface p-md shadow-2xl"
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function StudioControls() {
  const templateId = useResumeStore((s) => s.templateId);
  const setTemplateId = useResumeStore((s) => s.setTemplateId);

  return (
    <div className="flex shrink-0 items-center gap-xs">
      <Popover label="Template" icon={<Cards size={16} />}>
        <TemplateGallery value={templateId} onChange={setTemplateId} />
      </Popover>
      <Popover label="Type" icon={<TextAa size={16} />}>
        <TypePanel />
      </Popover>
      <Popover label="Spacing" icon={<ArrowsOutLineVertical size={16} />}>
        <SpacingPanel />
      </Popover>
    </div>
  );
}

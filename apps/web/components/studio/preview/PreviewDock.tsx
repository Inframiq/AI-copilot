"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { FileText, SpinnerGap } from "@phosphor-icons/react";
import { useResumeStore } from "@/stores/resume-store";
import { UnderfillWarning } from "@/components/resume/UnderfillWarning";
import { DockToolbar } from "./DockToolbar";

// Re-exported so callers (and Task 11's command bar) can reuse the same
// preset/font tables the popovers render from, without a second copy.
export { SPACING_PRESETS } from "./SpacingPopover";
export { FONT_CHOICES } from "./TypePopover";

// #toolbar=0 hides the browser's own PDF chrome — export lives in the
// command bar, and a second download button there read as a duplicate.
function withHiddenToolbar(url: string): string {
  return url.includes("#") ? url : `${url}#toolbar=0`;
}

export function PreviewDock({
  url,
  isRefreshing,
  isStale,
  onRefresh,
}: {
  url: string | null;
  isRefreshing: boolean;
  isStale: boolean;
  onRefresh: () => void;
}) {
  const previewUnderfilled = useResumeStore((s) => s.previewUnderfilled);
  // Cross-fade: hold the previous frame until the new one paints. The old
  // panel swapped src directly and flashed a blank/dark frame that read as
  // a failure.
  const [shown, setShown] = useState<string | null>(url);
  const [incoming, setIncoming] = useState<string | null>(null);
  const firstRef = useRef(true);

  useEffect(() => {
    if (url === shown) return;
    if (firstRef.current || shown === null) {
      firstRef.current = false;
      setShown(url);
      return;
    }
    setIncoming(url);
  }, [url, shown]);

  return (
    <div className="relative flex flex-col h-full bg-desk">
      <div className="flex-1 overflow-y-auto p-lg">
        {url && <UnderfillWarning show={previewUnderfilled} className="w-full mb-md" />}

        {url ? (
          <div
            className="relative w-full mx-auto max-w-[640px] rounded-lg overflow-hidden shadow-2xl bg-white"
            style={{ aspectRatio: "1 / 1.414" }}
          >
            {shown && (
              <iframe
                key={shown}
                src={withHiddenToolbar(shown)}
                title="Resume preview"
                className="absolute inset-0 w-full h-full"
              />
            )}
            <AnimatePresence>
              {incoming && (
                <motion.iframe
                  key={incoming}
                  src={withHiddenToolbar(incoming)}
                  title="Resume preview (updating)"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.25 }}
                  onLoad={() => {
                    setShown(incoming);
                    setIncoming(null);
                  }}
                  className="absolute inset-0 w-full h-full"
                />
              )}
            </AnimatePresence>
            {isRefreshing && (
              <span className="absolute top-sm right-sm rounded-full bg-desk-raised/90 p-xs">
                <SpinnerGap size={16} className="text-on-desk animate-spin" />
              </span>
            )}
          </div>
        ) : (
          <div
            className="w-full mx-auto max-w-[640px] rounded-lg border-2 border-dashed border-desk-line flex items-center justify-center"
            style={{ aspectRatio: "1 / 1.414" }}
          >
            <div className="text-center px-lg">
              <div className="w-14 h-14 rounded-full bg-desk-raised flex items-center justify-center mx-auto mb-md">
                <FileText size={28} className="text-on-desk" />
              </div>
              <p className="text-body-md font-semibold text-white mb-xs">No preview yet</p>
              <p className="text-body-sm text-on-desk">
                Refresh the preview to render your resume.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="absolute bottom-lg left-1/2 -translate-x-1/2">
        <DockToolbar onRefresh={onRefresh} isRefreshing={isRefreshing} isStale={isStale} />
      </div>
    </div>
  );
}

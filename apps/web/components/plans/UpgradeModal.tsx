"use client";
import { FOCUS_RING } from "@/lib/focus";
import { Sheet, SheetBody, SheetHeader } from "@/components/ui/Sheet";

export function UpgradeModal({ onClose }: { onClose: () => void }) {
  return (
    <Sheet labelledBy="upgrade-title" describedBy="upgrade-help" onClose={onClose}>
      <SheetBody>
        <SheetHeader eyebrow="Premium" titleId="upgrade-title" title="Premium is not yet available" descriptionId="upgrade-help">
          Premium purchases will open soon. The account remains on the Free plan until then.
        </SheetHeader>
        <button
          onClick={onClose}
          data-autofocus
          className={`w-full py-sm rounded-lg text-label-md font-semibold bg-primary text-on-primary hover:bg-primary-container transition-colors ${FOCUS_RING}`}
        >
          OK
        </button>
      </SheetBody>
    </Sheet>
  );
}

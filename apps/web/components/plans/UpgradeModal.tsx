"use client";
import { FOCUS_RING } from "@/lib/focus";
import { Sheet, SheetBody, SheetHeader } from "@/components/ui/Sheet";

/** Purchases aren't open yet: what Upgrade (on Free) or Renew (on Premium)
 * leads to until they are. */
export function UpgradeModal({ onClose, mode = "upgrade" }: { onClose: () => void; mode?: "upgrade" | "renew" }) {
  return (
    <Sheet labelledBy="upgrade-title" describedBy="upgrade-help" onClose={onClose}>
      <SheetBody>
        {mode === "renew" ? (
          <SheetHeader eyebrow="Premium" titleId="upgrade-title" title="Renewal is not yet available" descriptionId="upgrade-help">
            Online renewal will open soon. The plan and its credits stay as they are until then.
          </SheetHeader>
        ) : (
          <SheetHeader eyebrow="Premium" titleId="upgrade-title" title="Premium is not yet available" descriptionId="upgrade-help">
            Premium purchases will open soon. The account remains on the Free plan until then.
          </SheetHeader>
        )}
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

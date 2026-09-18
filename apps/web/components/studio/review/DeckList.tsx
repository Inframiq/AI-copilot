"use client";
import { Check, ArrowUUpLeft } from "@phosphor-icons/react";
import type { BulletChange } from "@/stores/tailoring-store";

// The skimmer's path out of the deck, and the only place bulk acceptance
// lives. The old "Accept All" button sat on a screen where every bullet
// already defaulted to accept, so it was a no-op announcing a fact.
export function DeckList({
  changes,
  decisions,
  onJump,
  onTakeAllRemaining,
}: {
  changes: BulletChange[];
  decisions: Record<string, "accept" | "reject">;
  onJump: (index: number) => void;
  onTakeAllRemaining: () => void;
}) {
  const undecided = changes.filter((c) => !(c.key in decisions)).length;

  return (
    <div className="flex flex-col gap-sm">
      {changes.map((change, i) => {
        const decision = decisions[change.key];
        return (
          <button
            key={change.key}
            type="button"
            onClick={() => onJump(i)}
            className="flex items-center gap-md px-md py-sm rounded-xl border border-outline-variant/30 bg-surface-container-lowest text-left hover:border-primary/40 transition-colors"
          >
            <span className="tabular text-caption text-on-surface-variant w-5 shrink-0">
              {i + 1}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-label-caps text-on-surface-variant truncate">
                {change.company} · {change.jobTitle}
              </span>
              <span className="block text-body-sm text-on-surface truncate">
                {change.tailored}
              </span>
            </span>
            {decision === "accept" && (
              <Check size={15} weight="bold" className="text-primary shrink-0" />
            )}
            {decision === "reject" && (
              <ArrowUUpLeft size={15} className="text-on-surface-variant shrink-0" />
            )}
          </button>
        );
      })}

      <button
        type="button"
        onClick={onTakeAllRemaining}
        disabled={undecided === 0}
        className="mt-xs w-full py-sm rounded-xl text-label-md text-primary border border-primary/40 hover:bg-primary/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Take all remaining{undecided > 0 ? ` (${undecided})` : ""}
      </button>
    </div>
  );
}

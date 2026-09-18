"use client";
import { ArrowLeft, ArrowRight, Eye } from "@phosphor-icons/react";
import { SECTION_ORDER, sectionStates, type SectionId } from "@/lib/section-completeness";
import { FOCUS_RING } from "@/lib/focus";

// Labels live in section-completeness; read them once rather than keeping a
// second copy that could drift from the stepper's.
const LABEL = Object.fromEntries(
  sectionStates(null).map((s) => [s.id, s.label]),
) as Record<SectionId, string>;

/**
 * Previous / Continue, with the last section's primary action becoming
 * Preview Resume — the handoff out of the Builder and into the Studio.
 * Both buttons name their destination so the move is never a guess.
 */
export function BuilderNav({
  current,
  onPrevious,
  onNext,
  onPreview,
}: {
  current: SectionId;
  onPrevious: () => void;
  onNext: () => void;
  onPreview: () => void;
}) {
  const i = SECTION_ORDER.indexOf(current);
  const prev = i > 0 ? SECTION_ORDER[i - 1] : null;
  const next = i < SECTION_ORDER.length - 1 ? SECTION_ORDER[i + 1] : null;

  return (
    <div className="flex shrink-0 items-center justify-between gap-md border-t border-outline-variant/30 bg-surface px-lg py-md">
      <button
        type="button"
        onClick={onPrevious}
        disabled={!prev}
        className={`flex items-center gap-xs rounded-xl px-md py-sm text-label-md text-on-surface-variant transition-colors hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
      >
        <ArrowLeft size={16} />
        {prev ? `Previous: ${LABEL[prev]}` : "Previous"}
      </button>

      {next ? (
        <button
          type="button"
          onClick={onNext}
          className={`flex items-center gap-xs rounded-xl bg-primary px-lg py-sm text-label-md text-on-primary transition-opacity hover:opacity-90 ${FOCUS_RING}`}
        >
          {`Continue to ${LABEL[next]}`}
          <ArrowRight size={16} />
        </button>
      ) : (
        <button
          type="button"
          onClick={onPreview}
          className={`flex items-center gap-xs rounded-xl bg-primary px-lg py-sm text-label-md text-on-primary transition-opacity hover:opacity-90 ${FOCUS_RING}`}
        >
          <Eye size={16} />
          Preview Resume
        </button>
      )}
    </div>
  );
}

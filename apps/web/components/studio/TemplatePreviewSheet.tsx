"use client";
import Image from "next/image";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { FOCUS_RING } from "@/lib/focus";
import { Sheet, SheetBody, SheetHeader } from "@/components/ui/Sheet";

type PreviewTemplate = { id: string; label: string; description: string };

/**
 * A template shown full size before choosing it. The card thumbnails crop to
 * the top of the page; this shows the whole sample page, with previous/next
 * to compare the others without closing.
 */
export function TemplatePreviewSheet({
  templates,
  index,
  selectedId,
  onIndexChange,
  onUse,
  onClose,
}: {
  templates: readonly PreviewTemplate[];
  index: number;
  selectedId: string;
  onIndexChange: (index: number) => void;
  onUse: (id: string) => void;
  onClose: () => void;
}) {
  const t = templates[index];
  const count = templates.length;
  const step = (by: number) => onIndexChange((index + by + count) % count);
  const isSelected = t.id === selectedId;
  const arrow = `shrink-0 p-sm rounded-full border border-outline-variant/40 text-on-surface-variant hover:bg-surface-container hover:text-on-surface ${FOCUS_RING}`;

  return (
    <Sheet labelledBy="template-preview-title" describedBy="template-preview-help" onClose={onClose} wide>
      <SheetBody>
        <SheetHeader
          eyebrow={`Template preview · ${index + 1} of ${count}`}
          titleId="template-preview-title"
          title={t.label}
          descriptionId="template-preview-help"
        >
          {t.description}
        </SheetHeader>

        <div
          className="flex items-center gap-xs sm:gap-sm"
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") step(-1);
            if (e.key === "ArrowRight") step(1);
          }}
        >
          <button type="button" onClick={() => step(-1)} aria-label="Previous template" className={arrow}>
            <CaretLeft size={16} />
          </button>
          <div className="flex-1 min-w-0 flex justify-center rounded-xl bg-surface-container p-xs sm:p-sm">
            <Image
              key={t.id}
              src={`/resume-templates/${t.id}.png`}
              alt={`${t.label} template, full sample page`}
              width={834}
              height={1179}
              sizes="(max-width: 640px) 80vw, 34rem"
              className="h-auto w-auto max-w-full max-h-[58dvh] rounded-md bg-white shadow-sm"
            />
          </div>
          <button type="button" onClick={() => step(1)} aria-label="Next template" className={arrow}>
            <CaretRight size={16} />
          </button>
        </div>

        <div className="flex gap-sm">
          <button
            type="button"
            onClick={onClose}
            className={`flex-1 py-sm rounded-lg border border-outline-variant/50 text-label-md text-on-surface hover:bg-surface-container ${FOCUS_RING}`}
          >
            Back to templates
          </button>
          <button
            type="button"
            onClick={() => onUse(t.id)}
            data-autofocus
            className={`flex-[1.4] py-sm rounded-lg bg-primary text-on-primary text-label-md font-semibold hover:bg-primary-container ${FOCUS_RING}`}
          >
            {isSelected ? "Keep this template" : "Use this template"}
          </button>
        </div>
      </SheetBody>
    </Sheet>
  );
}

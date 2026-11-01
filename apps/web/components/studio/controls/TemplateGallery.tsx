"use client";
import Image from "next/image";
import { Check } from "@phosphor-icons/react";
import { TEMPLATE_SET_LABELS, setOfTemplate, templatesInSet, type TemplateSet } from "@/lib/resume-templates";

// A template is chosen by looking at it. The old picker was a native
// <select> while thumbnails sat unused in public/resume-templates/.
//
// Grouped by set — Student / fresher and Working professional, as the
// Builder's tabs — with the set of the template in use first, so switching
// to a sibling design is the short reach and the other set is still there.
export function TemplateGallery({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const current = setOfTemplate(value);
  const order: TemplateSet[] = current === "student" ? ["student", "professional"] : ["professional", "student"];
  return (
    <div className="flex flex-col gap-md">
      {order.map((set) => (
        <div key={set} role="radiogroup" aria-label={`${TEMPLATE_SET_LABELS[set]} templates`} className="flex flex-col gap-xs">
          <span className="px-xs text-label-sm text-on-surface-variant">{TEMPLATE_SET_LABELS[set]}</span>
          <div className="grid grid-cols-2 gap-sm">
            {templatesInSet(set).map((t) => {
              const selected = t.id === value;
              return (
                <button
                  key={t.id}
                  role="radio"
                  aria-checked={selected}
                  aria-label={t.label}
                  onClick={() => onChange(t.id)}
                  className={`relative flex flex-col gap-xs rounded-xl border-2 p-xs transition-all ${
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-outline-variant/40 hover:border-primary/40"
                  }`}
                >
                  <span className="relative block w-full overflow-hidden rounded-lg bg-white" style={{ aspectRatio: "1 / 1.414" }}>
                    <Image
                      src={`/resume-templates/${t.id}.png`}
                      alt=""
                      fill
                      sizes="140px"
                      className="object-cover object-top"
                    />
                  </span>
                  <span className="text-caption text-on-surface truncate px-xs">{t.label}</span>
                  {"photo" in t && (
                    // A photo is fine for a direct send, but not what a job
                    // portal's parser wants (the ATS reference: no photos).
                    <span className="px-xs text-caption text-on-surface-variant">Photo · not for job portals</span>
                  )}
                  {selected && (
                    <span className="absolute top-1 right-1 rounded-full bg-primary text-on-primary p-0.5">
                      <Check size={11} weight="bold" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

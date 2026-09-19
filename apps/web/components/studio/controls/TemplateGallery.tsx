"use client";
import Image from "next/image";
import { Check } from "@phosphor-icons/react";
import { RESUME_TEMPLATES } from "@/lib/resume-templates";

// A template is chosen by looking at it. The old picker was a native
// <select> while thumbnails sat unused in public/resume-templates/.
export function TemplateGallery({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Resume template" className="grid grid-cols-2 gap-sm">
      {RESUME_TEMPLATES.map((t) => {
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
            {selected && (
              <span className="absolute top-1 right-1 rounded-full bg-primary text-on-primary p-0.5">
                <Check size={11} weight="bold" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

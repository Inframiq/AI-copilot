"use client";
import { useState } from "react";
import { useResumeStore } from "@/stores/resume-store";
import { SECTION_ORDER, type SectionId } from "@/lib/section-completeness";
import { BuilderHeader } from "./BuilderHeader";
import { SectionStepper } from "./SectionStepper";
import { SectionBody } from "./SectionBody";
import { BuilderNav } from "./BuilderNav";
import { ContextRail } from "./ContextRail";

/**
 * The guided Builder: one section at a time, with two-way navigation.
 *
 * Holds only which section is open. Everything else — the résumé itself,
 * autosave, JD context — already lives in resume-store and tailoring-store,
 * so moving between the Builder and the Studio loses nothing.
 */
export function BuilderShell({
  title,
  onBack,
  backLabel,
  onPreview,
}: {
  title: string;
  onBack: () => void;
  backLabel: string;
  onPreview: () => void;
}) {
  const content = useResumeStore((s) => s.content);
  const [current, setCurrent] = useState<SectionId>("contact");
  const i = SECTION_ORDER.indexOf(current);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <BuilderHeader title={title} onBack={onBack} backLabel={backLabel} />
      <SectionStepper content={content} current={current} onSelect={setCurrent} />

      {/* The section is the focus; the rail sits beside it on wide screens and
          stacks underneath on narrow ones rather than competing for width. */}
      <div className="flex flex-1 flex-col gap-xl overflow-y-auto px-lg py-xl lg:flex-row lg:justify-center">
        <main className="w-full max-w-3xl">
          <SectionBody id={current} />
        </main>
        <ContextRail />
      </div>

      <BuilderNav
        current={current}
        onPrevious={() => i > 0 && setCurrent(SECTION_ORDER[i - 1])}
        onNext={() => i < SECTION_ORDER.length - 1 && setCurrent(SECTION_ORDER[i + 1])}
        onPreview={onPreview}
      />
    </div>
  );
}

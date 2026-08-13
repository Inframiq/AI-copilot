"use client";
import { EnvelopeSimple } from "@phosphor-icons/react";
import { Card } from "@/components/ui/Card";

export default function CoverLettersPage() {
  return (
    <div className="max-w-[1440px] mx-auto p-gutter pb-xxl flex flex-col gap-xl">
      <section className="pb-md">
        <h1 className="text-headline-xl text-on-surface mb-xs font-bold" style={{ letterSpacing: "-0.02em" }}>
          Cover Letters
        </h1>
        <p className="text-body-lg text-on-surface-variant">
          AI-generated cover letters tailored to a job description and your resume.
        </p>
      </section>

      <Card className="flex flex-col items-center justify-center gap-md py-xxl text-center">
        <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
          <EnvelopeSimple size={28} className="text-primary" />
        </div>
        <p className="text-headline-md text-on-surface font-bold">Coming soon</p>
        <p className="text-body-sm text-on-surface-variant" style={{ maxWidth: "28rem" }}>
          Generate a cover letter from any tailored resume and job description, edit it, and export it as a PDF.
        </p>
      </Card>
    </div>
  );
}

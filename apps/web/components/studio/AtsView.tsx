"use client";
import { CheckCircle, CircleNotch, Info, WarningCircle } from "@phosphor-icons/react";
import type { AtsCheckOut, AtsFinding } from "@career-copilot/types";
import { CanvasNotice } from "./CanvasNotice";

/** "experience.1.start" → "Experience 2"; "contact.email" → "Contact". */
function where(field?: string): string | null {
  if (!field) return null;
  const [section, index] = field.split(".");
  const name = section.charAt(0).toUpperCase() + section.slice(1);
  return /^\d+$/.test(index ?? "") ? `${name} ${Number(index) + 1}` : name;
}

function FindingRow({ finding }: { finding: AtsFinding }) {
  const error = finding.level === "error";
  const place = where(finding.field);
  return (
    <li className="flex gap-xs rounded-xl bg-surface px-sm py-xs">
      <span className={`mt-0.5 shrink-0 ${error ? "text-error" : "text-on-surface-variant"}`}>
        {error ? <WarningCircle size={14} weight="fill" /> : <Info size={14} />}
      </span>
      <span className="min-w-0 text-caption text-on-surface">
        {place && <span className="font-semibold">{place}: </span>}
        {finding.message}
      </span>
    </li>
  );
}

/**
 * What an ATS reads out of the export, beside what that reading misses.
 *
 * The text on the right is pulled out of the very PDF Export downloads — the
 * ATS reference's own test ("copy all the text and paste it into Notepad;
 * it should read top to bottom like a normal résumé"), done for the user.
 * Side by side at every width; on a phone both columns shrink with the
 * phone type scale rather than stacking.
 */
export function AtsView({
  data,
  isPending,
  isError,
  onRetry,
}: {
  data: AtsCheckOut | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  if (isError) {
    return (
      <CanvasNotice
        tone="problem"
        icon={<WarningCircle size={28} />}
        title="The ATS check didn't run"
        detail="The résumé itself is unaffected. This is usually temporary."
        action={
          <button
            type="button"
            onClick={onRetry}
            className="mt-xs rounded-xl bg-primary px-lg py-sm text-label-md text-on-primary transition-opacity hover:opacity-90"
          >
            Try again
          </button>
        }
      />
    );
  }
  if (isPending || !data) {
    return (
      <CanvasNotice
        tone="working"
        icon={<CircleNotch size={28} className="animate-spin" />}
        title="Reading the export"
        detail="Rendering the PDF and pulling its text out the way a parser does."
      />
    );
  }

  const errors = data.findings.filter((f) => f.level === "error");
  const warnings = data.findings.filter((f) => f.level === "warning");

  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-sm sm:gap-lg">
      <section aria-label="ATS check" className="flex min-w-0 flex-col gap-sm">
        <div
          role="status"
          className={`flex items-start gap-xs rounded-2xl border px-sm py-sm ${
            errors.length ? "border-error/30 bg-error-container/30" : "border-primary/20 bg-primary/5"
          }`}
        >
          <span className={`mt-0.5 shrink-0 ${errors.length ? "text-error" : "text-primary"}`}>
            {errors.length ? <WarningCircle size={16} weight="fill" /> : <CheckCircle size={16} weight="fill" />}
          </span>
          <span className="text-label-sm text-on-surface">
            {errors.length
              ? `${errors.length} ${errors.length === 1 ? "problem" : "problems"} an ATS would trip on`
              : "Reads cleanly: name, contact, headings, dates and links all come through."}
          </span>
        </div>
        {errors.length > 0 && (
          <ul aria-label="Problems" className="flex flex-col gap-xs">
            {errors.map((f, i) => <FindingRow key={`e${i}`} finding={f} />)}
          </ul>
        )}
        {warnings.length > 0 && (
          <>
            <h2 className="px-xs text-label-sm text-on-surface-variant">Worth fixing</h2>
            <ul aria-label="Suggestions" className="flex flex-col gap-xs">
              {warnings.map((f, i) => <FindingRow key={`w${i}`} finding={f} />)}
            </ul>
          </>
        )}
        <p className="px-xs text-caption text-on-surface-variant">
          {data.page_count} {data.page_count === 1 ? "page" : "pages"}. Checked on the exact PDF Export
          downloads.
        </p>
      </section>

      <section aria-label="Text an ATS reads" className="flex min-w-0 flex-col gap-xs">
        <h2 className="px-xs text-label-sm text-on-surface-variant">Text an ATS reads</h2>
        <pre className="min-w-0 overflow-x-auto whitespace-pre-wrap break-words rounded-2xl border border-outline-variant/40 bg-surface p-sm font-mono text-caption leading-relaxed text-on-surface">
          {data.text.trim()}
        </pre>
      </section>
    </div>
  );
}

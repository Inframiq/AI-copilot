"use client";
import { useId, useState } from "react";
import { CalendarBlank, CaretLeft, CaretRight } from "@phosphor-icons/react";
import { Sheet, SheetBody, SheetHeader } from "@/components/ui/Sheet";
import { FOCUS_RING } from "@/lib/focus";
import {
  MONTHS,
  PRESENT,
  endsBeforeStart,
  formatMonthYear,
  isPresent,
  isStandardDate,
  monthBefore,
  parseMonthYear,
  tidyDate,
} from "@/lib/month-year";

const THIS_YEAR = new Date().getFullYear();
// Recent years first; far enough back for a long career, and a few ahead
// for an internship that's already offered.
const YEARS = Array.from({ length: THIS_YEAR + 6 - 1960 + 1 }, (_, i) => THIS_YEAR + 6 - i);

/**
 * Picks a month and year: choose the year, tap the month. Saves the standard
 * form (lib/month-year): "Jan 2022", "2022" with "Year only", or "Present".
 * With `start`, nothing before it can be picked — an end never comes before
 * its start.
 */
export function MonthYearSheet({ title, value, start, allowPresent = false, onPick, onClose }: {
  title: string;
  value: string;
  /** For an end date: the start it can't come before. */
  start?: string;
  allowPresent?: boolean;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const current = parseMonthYear(value);
  const startDate = parseMonthYear(start);
  const [year, setYear] = useState(current?.year ?? startDate?.year ?? THIS_YEAR);
  const titleId = useId();
  const choose = (v: string) => {
    onPick(v);
    onClose();
  };
  const step = (by: number) => setYear((y) => Math.min(YEARS[0], Math.max(YEARS[YEARS.length - 1], y + by)));
  const btn = `rounded-xl px-sm py-sm text-label-md transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${FOCUS_RING}`;

  return (
    <Sheet labelledBy={titleId} onClose={onClose}>
      <SheetBody>
        <SheetHeader eyebrow="Date" titleId={titleId} title={title} />
        <div className="flex items-center justify-between gap-sm">
          <button type="button" onClick={() => step(-1)} aria-label="Year before" disabled={year <= YEARS[YEARS.length - 1]}
            className={`${btn} text-on-surface-variant hover:bg-surface-container`}>
            <CaretLeft size={18} />
          </button>
          <select
            aria-label="Year"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className={`flex-1 max-w-[10rem] rounded-xl border border-outline-variant/40 bg-surface-container-lowest px-md py-sm text-center text-headline-md text-on-surface tabular-nums ${FOCUS_RING}`}
          >
            {YEARS.map((y) => (
              <option key={y} value={y} disabled={monthBefore(start, y, 11)}>{y}</option>
            ))}
          </select>
          <button type="button" onClick={() => step(1)} aria-label="Year after" disabled={year >= YEARS[0]}
            className={`${btn} text-on-surface-variant hover:bg-surface-container`}>
            <CaretRight size={18} />
          </button>
        </div>
        <div role="group" aria-label={`Months of ${year}`} className="grid grid-cols-4 gap-xs">
          {MONTHS.map((name, m) => {
            const chosen = current?.year === year && current.month === m;
            return (
              <button
                key={name}
                type="button"
                data-autofocus={chosen || (!current && m === 0) ? true : undefined}
                aria-pressed={chosen}
                aria-label={`${name} ${year}`}
                disabled={monthBefore(start, year, m)}
                onClick={() => choose(formatMonthYear({ year, month: m }))}
                className={`${btn} ${chosen ? "bg-primary text-on-primary" : "bg-surface-container-low text-on-surface hover:bg-secondary-container"}`}
              >
                {name}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-xs border-t border-outline-variant/30 pt-sm">
          <button type="button" onClick={() => choose(String(year))} disabled={monthBefore(start, year, null)}
            className={`${btn} text-primary hover:bg-primary/5`}>
            {year} only
          </button>
          {allowPresent && (
            <button type="button" onClick={() => choose(PRESENT)} aria-pressed={isPresent(value)}
              className={`${btn} text-primary hover:bg-primary/5`}>
              {PRESENT}
            </button>
          )}
          {value.trim() && (
            <button type="button" onClick={() => choose("")}
              className={`${btn} ml-auto text-on-surface-variant hover:bg-surface-container`}>
              Clear
            </button>
          )}
        </div>
      </SheetBody>
    </Sheet>
  );
}

/**
 * A date field: shows the date and opens MonthYearSheet. A date typed before
 * the picker is shown in the standard form ("January 2022" as "Jan 2022")
 * and saved that way once picked; text that isn't a date says so.
 */
export function MonthYearField({ id, label, value, onChange, start, allowPresent, placeholder = "Month, year", className = "" }: {
  id?: string;
  /** The field's name, for the sheet's title and screen readers: "Start", "End". */
  label: string;
  value: string;
  onChange: (value: string) => void;
  start?: string;
  allowPresent?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const hintId = useId();
  const shown = tidyDate(value);
  const notADate = !!value.trim() && !isStandardDate(shown);
  const beforeStart = endsBeforeStart(start, value);
  const problem = notADate ? "Not a date the résumé can read. Pick one." : beforeStart ? "Ends before it starts." : null;

  return (
    <>
      <button
        id={id}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`${label}: ${shown || "not set"}`}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? hintId : undefined}
        className={`${className} flex items-center justify-between gap-xs text-left ${problem ? "border-error!" : ""}`}
      >
        <span className={`truncate ${shown ? "" : "text-on-surface-variant/50"}`}>{shown || placeholder}</span>
        <CalendarBlank size={16} className="shrink-0 text-on-surface-variant/70" />
      </button>
      {problem && <p id={hintId} className="text-caption text-error">{problem}</p>}
      {open && (
        <MonthYearSheet
          title={`${label} date`}
          value={value}
          start={start}
          allowPresent={allowPresent}
          onPick={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

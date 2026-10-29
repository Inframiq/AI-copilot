"use client";
import { useEffect, useRef } from "react";
import { Plus, Trash, X } from "@phosphor-icons/react";
import { Sheet, SheetBody, SheetHeader } from "@/components/ui/Sheet";
import { wordCount } from "@/lib/misc-points";
import {
  EXTRA_SECTIONS,
  PROFILE_LIMITS as L,
  SECTION_INFO,
  capWords,
  type ExtraSection,
  type LanguageEntry,
  type LineSection,
  type ProfileSections,
} from "@/lib/profile-sections";
import { SectionHeader, cardCls, inputCls, textareaCls } from "./ProfileFormParts";

const removeBtnCls =
  "w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-error/10 hover:text-error transition-colors";
const addRowCls =
  "self-start flex items-center gap-xs px-md py-xs rounded-full text-label-sm font-semibold text-primary bg-primary/5 hover:bg-primary/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

/** A paragraph capped at `maxWords` (and the database's `maxChars`), with a
 * running count. Text over the cap from an upload stays until it's edited. */
function CappedText({ id, value, onChange, maxWords, maxChars, rows, placeholder }: {
  id: string; value: string; onChange: (v: string) => void;
  maxWords: number; maxChars: number; rows: number; placeholder: string;
}) {
  const count = wordCount(value);
  return (
    <div className="flex flex-col gap-xs">
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(capWords(e.target.value, maxWords))}
        maxLength={maxChars}
        rows={rows}
        placeholder={placeholder}
        className={`${textareaCls} leading-relaxed`}
      />
      <span className={`self-end tabular-nums text-caption ${count > maxWords ? "text-error font-semibold" : "text-on-surface-variant"}`}>
        {count} / {maxWords} words
      </span>
    </div>
  );
}

/** Always on the Profile, after Contact. */
export function SummaryCard({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <section className={cardCls}>
      <SectionHeader
        title="Summary"
        info="Two or three sentences on who you are and what you do best. A résumé started from your profile opens with it."
      />
      <CappedText
        id="profile-summary"
        value={value}
        onChange={onChange}
        maxWords={L.summaryWords}
        maxChars={L.summaryChars}
        rows={4}
        placeholder="Backend engineer with four years building payment APIs in Go and PostgreSQL…"
      />
    </section>
  );
}

function LanguagesEditor({ value, onChange }: { value: LanguageEntry[]; onChange: (v: LanguageEntry[]) => void }) {
  const set = (i: number, patch: Partial<LanguageEntry>) =>
    onChange(value.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  return (
    <div className="flex flex-col gap-sm">
      {value.map((lang, i) => (
        <div key={i} className="flex items-center gap-xs sm:gap-sm">
          <input
            aria-label={`Language ${i + 1}`}
            value={lang.name}
            onChange={(e) => set(i, { name: e.target.value })}
            maxLength={L.languageChars}
            placeholder={SECTION_INFO.languages.placeholder}
            className={`${inputCls} min-w-0 flex-1`}
          />
          <input
            aria-label={`Language ${i + 1} level`}
            value={lang.level}
            onChange={(e) => set(i, { level: e.target.value })}
            maxLength={L.languageChars}
            placeholder="Native, B2…"
            className={`${inputCls} min-w-0 flex-1`}
          />
          <button type="button" onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            aria-label={`Remove language ${i + 1}`} className={removeBtnCls}>
            <Trash size={14} />
          </button>
        </div>
      ))}
      <button type="button" disabled={value.length >= L.languages}
        onClick={() => onChange([...value, { name: "", level: "" }])} className={addRowCls}>
        <Plus size={14} weight="bold" /> Add language
      </button>
    </div>
  );
}

function LinesEditor({ section, value, onChange }: {
  section: LineSection; value: string[]; onChange: (v: string[]) => void;
}) {
  const { label, placeholder, item } = SECTION_INFO[section];
  const listRef = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  useEffect(() => {
    if (!focusLast.current) return;
    focusLast.current = false;
    [...(listRef.current?.querySelectorAll("input") ?? [])].at(-1)?.focus();
  }, [value.length]);
  return (
    <div ref={listRef} className="flex flex-col gap-sm">
      {value.map((line, i) => (
        <div key={i} className="flex items-center gap-xs sm:gap-sm">
          <input
            aria-label={`${label} ${i + 1}`}
            value={line}
            onChange={(e) => onChange(value.map((l, idx) => (idx === i ? e.target.value : l)))}
            onKeyDown={(e) => {
              // Enter starts the next one, as in a list.
              if (e.key === "Enter" && line.trim() && i === value.length - 1 && value.length < L.items) {
                e.preventDefault();
                focusLast.current = true;
                onChange([...value, ""]);
              }
            }}
            maxLength={L.itemChars}
            placeholder={i === 0 ? placeholder : undefined}
            className={`${inputCls} min-w-0 flex-1`}
          />
          <button type="button" onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            aria-label={`Remove ${item} ${i + 1}`} className={removeBtnCls}>
            <Trash size={14} />
          </button>
        </div>
      ))}
      <button type="button" disabled={value.length >= L.items}
        onClick={() => { focusLast.current = true; onChange([...value, ""]); }} className={addRowCls}>
        <Plus size={14} weight="bold" /> Add {item}
      </button>
    </div>
  );
}

/** One added section: its editor, and Remove to take it off the Profile. */
export function ExtraSectionCard({ section, sections, onChange, onRemove }: {
  section: ExtraSection;
  sections: ProfileSections;
  onChange: (patch: Partial<ProfileSections>) => void;
  onRemove: () => void;
}) {
  const { label, hint, placeholder } = SECTION_INFO[section];
  return (
    <section id={`profile-section-${section}`} className={cardCls}>
      <SectionHeader
        title={label}
        info={hint}
        action={
          <button type="button" onClick={onRemove} aria-label={`Remove ${label} section`} title="Remove section"
            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-error/10 hover:text-error transition-colors">
            <X size={16} />
          </button>
        }
      />
      {section === "objective" ? (
        <CappedText
          id="profile-objective"
          value={sections.objective ?? ""}
          onChange={(v) => onChange({ objective: v })}
          maxWords={L.objectiveWords}
          maxChars={L.objectiveChars}
          rows={3}
          placeholder={placeholder}
        />
      ) : section === "languages" ? (
        <LanguagesEditor value={sections.languages} onChange={(languages) => onChange({ languages })} />
      ) : (
        <LinesEditor section={section} value={sections[section]} onChange={(v) => onChange({ [section]: v })} />
      )}
    </section>
  );
}

/** "+ Add section": a full-width button, and the sheet of what's left. */
export function AddSectionButton({ hidden, onPick, open, setOpen }: {
  /** Sections already on the Profile — not offered again. */
  hidden: readonly ExtraSection[];
  onPick: (s: ExtraSection) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const left = EXTRA_SECTIONS.filter((s) => !hidden.includes(s));
  if (left.length === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="w-full py-lg flex items-center justify-center gap-sm rounded-2xl border-2 border-dashed border-outline-variant/50 text-label-md font-semibold text-primary hover:border-primary/50 hover:bg-primary/5 transition-colors"
      >
        <Plus size={18} weight="bold" /> Add section
      </button>
      {open && (
        <Sheet labelledBy="add-section-title" describedBy="add-section-help" onClose={() => setOpen(false)}>
          <SheetBody>
            <SheetHeader eyebrow="My Profile" titleId="add-section-title" title="Add a section" descriptionId="add-section-help">
              Each section is printed on résumés made from your profile.
            </SheetHeader>
            <ul className="flex flex-col gap-xs">
              {left.map((s, i) => (
                <li key={s}>
                  <button
                    type="button"
                    data-autofocus={i === 0 ? true : undefined}
                    onClick={() => { onPick(s); setOpen(false); }}
                    className="w-full text-left flex items-start gap-sm rounded-xl px-md py-sm border border-outline-variant/30 hover:border-primary/40 hover:bg-primary/5 focus-visible:border-primary transition-colors outline-none"
                  >
                    <Plus size={16} weight="bold" className="mt-0.5 shrink-0 text-primary" />
                    <span className="min-w-0">
                      <span className="block text-label-md font-semibold text-on-surface">{SECTION_INFO[s].label}</span>
                      <span className="block text-body-sm text-on-surface-variant">{SECTION_INFO[s].hint}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </SheetBody>
        </Sheet>
      )}
    </>
  );
}

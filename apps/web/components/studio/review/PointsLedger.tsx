"use client";
import { useMemo, useState } from "react";
import { ArrowsClockwise, CaretRight, PencilSimple, Sparkle } from "@phosphor-icons/react";
import type { ResumeContent } from "@career-copilot/types";
import type { AtsFix, BulletRationale } from "@/lib/api-client";
import type { BulletChange } from "@/stores/tailoring-store";
import { classifyChange } from "@/lib/point-kind";
import { FOCUS_RING } from "@/lib/focus";
import { BulletDiff } from "./BulletDiff";

type Decision = "accept" | "reject";
type Filter = "all" | "reworded" | "adds_terms" | "ai";

/**
 * Every point tailoring produced, sorted by where it came from — the review's
 * one real question is "is this still true of me?", and the answer differs by
 * provenance:
 *
 *   Reworded       your facts, new words              → start ticked
 *   Adds a JD term your bullet + a term you never used → start unticked
 *   Written by AI  not in your résumé at all          → locked until you
 *                                                       confirm you did it
 *
 * The edge of each row is its provenance mark: solid for your own words,
 * dotted where a term was added, a dashed draft outline for AI-written text
 * that turns solid once you vouch for it.
 */
export function PointsLedger({
  changes,
  decisions,
  rationale,
  original,
  aiFixes,
  roles,
  fixExperienceIndex,
  busy,
  revertedReasons,
  onDecide,
  onFixDecide,
  onFixRole,
  onRewrite,
  onEdit,
}: {
  changes: BulletChange[];
  /** bulletDecisions: rewrites by change key, AI fixes under `fix:${id}`. */
  decisions: Record<string, Decision>;
  rationale: Record<string, BulletRationale>;
  original: ResumeContent;
  /** The AI-written fixes: new bullets and the headline. */
  aiFixes: AtsFix[];
  /** "Title · Company" per experience entry, for placing a new bullet. */
  roles: string[];
  fixExperienceIndex: Record<string, number>;
  busy?: Record<string, "rewrite" | "humanize" | null>;
  revertedReasons?: Record<string, string[]>;
  onDecide: (key: string, d: Decision) => void;
  onFixDecide: (id: string, d: Decision) => void;
  onFixRole: (id: string, experienceIndex: number) => void;
  onRewrite: (change: BulletChange, mode: "rewrite" | "humanize") => void;
  onEdit: (change: BulletChange, text: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const { reworded, addsTerms } = useMemo(() => {
    const reworded: BulletChange[] = [];
    const addsTerms: { change: BulletChange; newTerms: string[] }[] = [];
    for (const change of changes) {
      const { kind, newTerms } = classifyChange(change, rationale[change.key], original);
      if (kind === "reworded") reworded.push(change);
      else addsTerms.push({ change, newTerms });
    }
    return { reworded, addsTerms };
  }, [changes, rationale, original]);

  const total = reworded.length + addsTerms.length + aiFixes.length;
  if (total === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-outline-variant/50 p-xl text-center">
        <p className="text-body-md text-on-surface-variant">
          No bullets were rewritten. That is not a verdict on fit — the score above
          says how well you match; the skill and gap fixes below are how to raise it.
        </p>
      </div>
    );
  }

  const tabs: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "All", count: total },
    { id: "reworded", label: "Reworded", count: reworded.length },
    { id: "adds_terms", label: "Adds JD terms", count: addsTerms.length },
    { id: "ai", label: "Written by AI", count: aiFixes.length },
  ];
  const show = (f: Filter) => filter === "all" || filter === f;
  const untickedReworded = reworded.filter((c) => decisions[c.key] === "reject");

  return (
    <section aria-label="Tailored points" className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <div role="group" aria-label="Show" className="flex flex-wrap gap-xs">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={filter === t.id}
              onClick={() => setFilter(t.id)}
              className={`rounded-full px-md py-xs text-label-sm transition-colors ${FOCUS_RING} ${
                filter === t.id
                  ? "bg-inverse-surface text-inverse-on-surface"
                  : "bg-surface-container text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {t.label} <span className="tabular opacity-70">{t.count}</span>
            </button>
          ))}
        </div>
        {untickedReworded.length > 0 && (
          <button
            type="button"
            onClick={() => untickedReworded.forEach((c) => onDecide(c.key, "accept"))}
            className={`rounded-lg px-sm py-xs text-label-sm text-primary hover:bg-primary/10 ${FOCUS_RING}`}
          >
            Accept all reworded
          </button>
        )}
      </div>

      {show("reworded") && reworded.length > 0 && (
        <Group title="Reworded from your résumé" hint="Same facts, new words — safe to accept">
          {reworded.map((change) => (
            <ChangeRow
              key={change.key}
              change={change}
              edge="solid"
              checked={decisions[change.key] !== "reject"}
              busy={busy?.[change.key] ?? null}
              reverted={revertedReasons?.[change.key]}
              onToggle={(on) => onDecide(change.key, on ? "accept" : "reject")}
              onRewrite={(m) => onRewrite(change, m)}
              onEdit={(t) => onEdit(change, t)}
            />
          ))}
        </Group>
      )}

      {show("adds_terms") && addsTerms.length > 0 && (
        <Group
          title="Adds a job-description term"
          hint="Your work, plus a term your résumé never uses — tick only if it is true"
        >
          {addsTerms.map(({ change, newTerms }) => (
            <ChangeRow
              key={change.key}
              change={change}
              edge="dotted"
              newTerms={newTerms}
              checked={decisions[change.key] === "accept"}
              busy={busy?.[change.key] ?? null}
              reverted={revertedReasons?.[change.key]}
              onToggle={(on) => onDecide(change.key, on ? "accept" : "reject")}
              onRewrite={(m) => onRewrite(change, m)}
              onEdit={(t) => onEdit(change, t)}
            />
          ))}
        </Group>
      )}

      {show("ai") && aiFixes.length > 0 && (
        <Group
          title="Written by AI — not in your résumé"
          hint="Add only what you have actually done; you will be asked about it"
        >
          {aiFixes.map((fix) => (
            <AiRow
              key={fix.id}
              fix={fix}
              roles={roles}
              role={fixExperienceIndex[fix.id] ?? fix.experience_index ?? 0}
              checked={decisions[`fix:${fix.id}`] === "accept"}
              onToggle={(on) => onFixDecide(fix.id, on ? "accept" : "reject")}
              onRole={(i) => onFixRole(fix.id, i)}
            />
          ))}
        </Group>
      )}
    </section>
  );
}

function Group({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-x-md gap-y-xs border-b border-outline-variant/30 pb-xs">
        <h3 className="text-label-md font-semibold text-on-surface">{title}</h3>
        <p className="text-caption text-on-surface-variant">{hint}</p>
      </header>
      <ul className="flex flex-col gap-sm">{children}</ul>
    </section>
  );
}

const EDGE = {
  solid: "border-l-[3px] border-l-success",
  dotted: "border-l-[3px] border-dotted border-l-tertiary",
};

function ChangeRow({
  change,
  edge,
  newTerms = [],
  checked,
  busy,
  reverted,
  onToggle,
  onRewrite,
  onEdit,
}: {
  change: BulletChange;
  edge: keyof typeof EDGE;
  newTerms?: string[];
  checked: boolean;
  busy: "rewrite" | "humanize" | null;
  reverted?: string[];
  onToggle: (on: boolean) => void;
  onRewrite: (mode: "rewrite" | "humanize") => void;
  onEdit: (text: string) => void;
}) {
  const [showWas, setShowWas] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(change.tailored);
  const where = [change.company, change.jobTitle].filter(Boolean).join(" · ");
  const id = `point-${change.key}`;

  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== change.tailored) onEdit(next);
  }

  return (
    <li
      className={`flex gap-md rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-md transition-opacity ${EDGE[edge]} ${
        checked ? "" : "opacity-70"
      }`}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        aria-label={`Use this rewrite: ${change.tailored}`}
        className={`mt-1 h-4 w-4 shrink-0 accent-primary ${FOCUS_RING}`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-xs">
        <div className="flex flex-wrap items-center gap-x-sm gap-y-xs">
          <span className="truncate text-label-caps text-on-surface-variant">{where}</span>
          {newTerms.map((t) => (
            <span
              key={t}
              className="rounded-full bg-tertiary-container px-sm text-caption text-on-tertiary-container"
            >
              adds: {t}
            </span>
          ))}
        </div>

        {editing ? (
          <textarea
            autoFocus
            aria-label="Edit rewrite"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
            }}
            rows={3}
            className="w-full resize-none rounded-lg border border-primary/50 bg-surface px-sm py-xs text-body-md leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        ) : (
          <label htmlFor={id} className="cursor-pointer text-body-md leading-relaxed text-on-surface">
            <NewTermMarks text={change.tailored} original={change.original} terms={newTerms} changeKey={change.key} />
          </label>
        )}

        {showWas && (
          <p className="text-body-sm leading-relaxed text-on-surface-variant">
            <span className="mr-xs text-label-caps">Was</span>
            <BulletDiff
              original={change.original}
              tailored={change.tailored}
              side="removed"
              testId={`bullet-diff-removed-${change.key}`}
            />
          </p>
        )}

        {(reverted?.length ?? 0) > 0 && (
          <p className="text-caption text-tertiary">Kept your version — the rewrite {reverted!.join("; ")}.</p>
        )}

        <div className="flex flex-wrap items-center gap-xs">
          <RowAction onClick={() => setShowWas((v) => !v)} pressed={showWas}>
            <CaretRight size={12} className={`transition-transform ${showWas ? "rotate-90" : ""}`} />
            {showWas ? "Hide original" : "Show original"}
          </RowAction>
          <RowAction
            onClick={() => {
              setDraft(change.tailored);
              setEditing(true);
            }}
          >
            <PencilSimple size={12} /> Edit
          </RowAction>
          <RowAction onClick={() => onRewrite("rewrite")} disabled={!!busy}>
            <ArrowsClockwise size={12} className={busy === "rewrite" ? "animate-spin" : ""} /> Rewrite
          </RowAction>
          <RowAction onClick={() => onRewrite("humanize")} disabled={!!busy}>
            <Sparkle size={12} className={busy === "humanize" ? "animate-pulse" : ""} /> Humanize
          </RowAction>
        </div>
      </div>
    </li>
  );
}

/** The rewrite, with changed words tinted and every added JD term marked
 * with a wavy underline — the words the candidate is newly vouching for. */
function NewTermMarks({
  text,
  original,
  terms,
  changeKey,
}: {
  text: string;
  original: string;
  terms: string[];
  changeKey: string;
}) {
  if (terms.length === 0) {
    return <BulletDiff original={original} tailored={text} side="added" testId={`bullet-diff-added-${changeKey}`} />;
  }
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})`, "gi"));
  const lower = new Set(terms.map((t) => t.toLowerCase()));
  return (
    <>
      {parts.map((p, i) =>
        lower.has(p.toLowerCase()) ? (
          <mark
            key={i}
            className="bg-transparent font-medium text-on-surface underline decoration-tertiary decoration-wavy decoration-2 underline-offset-4"
          >
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function AiRow({
  fix,
  roles,
  role,
  checked,
  onToggle,
  onRole,
}: {
  fix: AtsFix;
  roles: string[];
  role: number;
  checked: boolean;
  onToggle: (on: boolean) => void;
  onRole: (i: number) => void;
}) {
  // Already accepted (e.g. restored from an earlier choice) counts as vouched.
  const [vouched, setVouched] = useState(checked);
  const id = `ai-${fix.id}`;
  const label = fix.type === "headline" ? "New headline" : "New bullet";

  return (
    <li
      className={`flex gap-md rounded-xl border-2 p-md transition-colors ${
        vouched
          ? "border-solid border-outline-variant/60 bg-surface-container-lowest"
          : "border-dashed border-outline-variant bg-transparent"
      }`}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={!vouched}
        onChange={(e) => onToggle(e.target.checked)}
        aria-label={`Add this ${label.toLowerCase()}: ${fix.text}`}
        className={`mt-1 h-4 w-4 shrink-0 accent-primary disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-xs">
        <div className="flex flex-wrap items-center gap-x-sm gap-y-xs">
          <span className="text-label-caps text-on-surface-variant">{label}</span>
          {fix.type === "bullet" && roles.length > 0 && (
            <select
              aria-label="Add to role"
              value={role}
              onChange={(e) => onRole(Number(e.target.value))}
              className={`max-w-[16rem] truncate rounded-md border border-outline-variant/50 bg-surface px-xs py-0.5 text-caption text-on-surface ${FOCUS_RING}`}
            >
              {roles.map((r, i) => (
                <option key={i} value={i}>
                  → {r}
                </option>
              ))}
            </select>
          )}
          {fix.score_delta > 0 && (
            <span className="tabular text-label-sm font-semibold text-primary">+{fix.score_delta} pts</span>
          )}
          <span className="text-caption text-on-surface-variant">for “{fix.gap}”</span>
        </div>
        <label htmlFor={id} className={`text-body-md leading-relaxed ${vouched ? "text-on-surface" : "text-on-surface-variant italic"}`}>
          {fix.text}
        </label>
        <label className="flex w-fit cursor-pointer items-center gap-xs text-caption text-on-surface-variant">
          <input
            type="checkbox"
            checked={vouched}
            onChange={(e) => {
              setVouched(e.target.checked);
              // Withdrawing the confirmation withdraws the claim.
              if (!e.target.checked && checked) onToggle(false);
            }}
            className={`h-3.5 w-3.5 accent-primary ${FOCUS_RING}`}
          />
          I have actually done this
        </label>
      </div>
    </li>
  );
}

function RowAction({
  children,
  onClick,
  disabled,
  pressed,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className={`flex items-center gap-1 rounded-md px-xs py-0.5 text-caption text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface disabled:opacity-40 ${FOCUS_RING}`}
    >
      {children}
    </button>
  );
}

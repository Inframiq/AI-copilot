"use client";
import { useMemo, useState } from "react";
import {
  ArrowsClockwise,
  CaretRight,
  Checks,
  PencilSimple,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import type { ResumeContent } from "@career-copilot/types";
import type { AtsFix, BulletRationale } from "@/lib/api-client";
import type { BulletChange } from "@/stores/tailoring-store";
import { classifyChange } from "@/lib/point-kind";
import { FOCUS_RING } from "@/lib/focus";
import { BulletDiff } from "./BulletDiff";

type Decision = "accept" | "reject";
type Filter = "all" | "reworded" | "adds_terms" | "ai";
type Provenance = "reworded" | "adds_terms" | "ai";

/**
 * Every point tailoring produced, sorted by where it came from — the review's
 * one real question is "is this still true of me?", and the answer differs by
 * provenance:
 *
 *   Reworded       your facts, new words              → start on
 *   Adds a JD term your bullet + a term you never used → start off
 *   Written by AI  not in your résumé at all          → locked until you
 *                                                       confirm you did it
 *
 * Each point is a card with its own switch and its own "+N pts". A card that
 * is on lifts off the page; one that is off sits flat and faded, so the
 * résumé you are about to apply reads straight off the list.
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
  onBulk,
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
  /** Many decisions in one update (and one re-score). */
  onBulk: (decisions: Record<string, Decision>) => void;
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
  const onCount =
    changes.filter((c) => decisions[c.key] !== "reject").length +
    aiFixes.filter((f) => decisions[`fix:${f.id}`] === "accept").length;

  // Auto-select: every point built on the user's own bullets. AI-written
  // points are left as they are — they need the user's word, not a click.
  function autoSelect() {
    const next: Record<string, Decision> = {};
    for (const c of changes) next[c.key] = "accept";
    onBulk(next);
  }
  function clearAll() {
    const next: Record<string, Decision> = {};
    for (const c of changes) next[c.key] = "reject";
    for (const f of aiFixes) next[`fix:${f.id}`] = "reject";
    onBulk(next);
  }

  return (
    <section aria-label="Tailored points" className="flex flex-col gap-lg">
      <div className="flex flex-col gap-sm rounded-2xl bg-surface-container-low p-sm sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-label="Show" className="flex flex-wrap gap-xs">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={filter === t.id}
              onClick={() => setFilter(t.id)}
              className={`rounded-full px-md py-xs text-label-sm transition-colors ${FOCUS_RING} ${
                filter === t.id
                  ? "bg-inverse-surface text-inverse-on-surface shadow-sm"
                  : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
              }`}
            >
              {t.label} <span className="tabular opacity-70">{t.count}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-xs">
          <span className="tabular px-xs text-caption text-on-surface-variant">
            {onCount} of {total} on
          </span>
          <button
            type="button"
            onClick={autoSelect}
            title="Turns on every point built on your own bullets. AI-written points stay as they are."
            className={`flex items-center gap-1 rounded-full bg-primary px-md py-xs text-label-sm text-on-primary shadow-sm transition-opacity hover:opacity-90 ${FOCUS_RING}`}
          >
            <Checks size={14} weight="bold" /> Auto-select
          </button>
          <button
            type="button"
            onClick={clearAll}
            className={`flex items-center gap-1 rounded-full px-md py-xs text-label-sm text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface ${FOCUS_RING}`}
          >
            <X size={14} /> Clear all
          </button>
        </div>
      </div>

      {show("reworded") && reworded.length > 0 && (
        <Group title="Reworded from your résumé" hint="Same facts, new words — safe to accept">
          {reworded.map((change) => (
            <ChangeCard
              key={change.key}
              change={change}
              provenance="reworded"
              points={rationale[change.key]?.score_delta}
              on={decisions[change.key] !== "reject"}
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
          hint="Your work, plus a term your résumé never uses — turn on only if it is true"
        >
          {addsTerms.map(({ change, newTerms }) => (
            <ChangeCard
              key={change.key}
              change={change}
              provenance="adds_terms"
              newTerms={newTerms}
              points={rationale[change.key]?.score_delta}
              on={decisions[change.key] === "accept"}
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
            <AiCard
              key={fix.id}
              fix={fix}
              roles={roles}
              role={fixExperienceIndex[fix.id] ?? fix.experience_index ?? 0}
              on={decisions[`fix:${fix.id}`] === "accept"}
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
    <section aria-label={title} className="flex flex-col gap-md">
      <header className="flex flex-wrap items-baseline justify-between gap-x-md gap-y-xs px-xs">
        <h3 className="text-label-md font-semibold text-on-surface">{title}</h3>
        <p className="text-caption text-on-surface-variant">{hint}</p>
      </header>
      <ul className="flex flex-col gap-md">{children}</ul>
    </section>
  );
}

const PROVENANCE: Record<Provenance, { label: string; dot: string; bar: string }> = {
  reworded: { label: "Reworded", dot: "bg-success", bar: "bg-success" },
  adds_terms: {
    label: "Adds JD term",
    dot: "bg-tertiary",
    // Dotted: a solid line broken where something new was put in.
    bar: "bg-[repeating-linear-gradient(to_bottom,var(--color-tertiary)_0_4px,transparent_4px_8px)]",
  },
  ai: { label: "Written by AI", dot: "bg-outline", bar: "" },
};

/** The card shell: lifted with a primary ring when on, flat and faded when
 * off. `draft` gives the dashed outline of an unconfirmed AI point. */
function Card({
  on,
  provenance,
  draft = false,
  children,
}: {
  on: boolean;
  provenance: Provenance;
  draft?: boolean;
  children: React.ReactNode;
}) {
  const bar = PROVENANCE[provenance].bar;
  return (
    <li
      data-on={on}
      className={`relative overflow-hidden rounded-2xl transition-all duration-200 motion-reduce:transition-none ${
        draft
          ? "border-2 border-dashed border-outline-variant bg-transparent"
          : on
            ? "-translate-y-0.5 border border-primary/30 bg-surface-container-lowest shadow-[0_6px_20px_-8px_rgba(27,58,143,0.35)] ring-1 ring-primary/20 motion-reduce:translate-y-0"
            : "border border-outline-variant/40 bg-surface-container-low/60 shadow-none"
      }`}
    >
      {bar && <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${bar} ${on ? "" : "opacity-50"}`} />}
      <div className={`flex flex-col gap-sm p-md pl-lg transition-opacity ${on || draft ? "" : "opacity-60"}`}>
        {children}
      </div>
    </li>
  );
}

function CardHeader({
  provenance,
  where,
  points,
  children,
}: {
  provenance: Provenance;
  where?: string;
  points?: number;
  children: React.ReactNode;
}) {
  const p = PROVENANCE[provenance];
  return (
    <div className="flex items-start justify-between gap-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-x-sm gap-y-xs">
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface-container px-sm py-0.5 text-caption font-medium text-on-surface">
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${p.dot}`} />
          {p.label}
        </span>
        {where && <span className="truncate text-caption text-on-surface-variant">{where}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-sm">
        {points !== undefined && points > 0 && (
          <span className="tabular rounded-full bg-primary/10 px-sm py-0.5 text-label-sm font-semibold text-primary">
            +{points} pts
          </span>
        )}
        {children}
      </div>
    </div>
  );
}

function Switch({
  on,
  disabled,
  label,
  onChange,
}: {
  on: boolean;
  disabled?: boolean;
  label: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING} ${
        on ? "bg-primary" : "bg-outline-variant"
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-surface-container-lowest shadow transition-transform duration-200 motion-reduce:transition-none ${
          on ? "translate-x-5" : ""
        }`}
      />
    </button>
  );
}

function ChangeCard({
  change,
  provenance,
  newTerms = [],
  points,
  on,
  busy,
  reverted,
  onToggle,
  onRewrite,
  onEdit,
}: {
  change: BulletChange;
  provenance: Provenance;
  newTerms?: string[];
  points?: number;
  on: boolean;
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

  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== change.tailored) onEdit(next);
  }

  return (
    <Card on={on} provenance={provenance}>
      <CardHeader provenance={provenance} where={where} points={points}>
        <Switch on={on} label={`Use this rewrite: ${change.tailored}`} onChange={onToggle} />
      </CardHeader>

      {newTerms.length > 0 && (
        <div className="flex flex-wrap gap-xs">
          {newTerms.map((t) => (
            <span
              key={t}
              className="rounded-md bg-tertiary-container px-sm py-0.5 text-caption font-medium text-on-tertiary-container"
            >
              adds: {t}
            </span>
          ))}
        </div>
      )}

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
          className="w-full resize-none rounded-xl border border-primary/50 bg-surface px-sm py-xs text-body-md leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      ) : (
        <p className="text-body-md leading-relaxed text-on-surface">
          <NewTermMarks text={change.tailored} original={change.original} terms={newTerms} changeKey={change.key} />
        </p>
      )}

      {showWas && (
        <p className="rounded-xl bg-surface-container px-sm py-xs text-body-sm leading-relaxed text-on-surface-variant">
          <span className="mr-xs text-label-caps">Original</span>
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

      <div className="-ml-xs flex flex-wrap items-center gap-xs border-t border-outline-variant/20 pt-xs">
        <CardAction onClick={() => setShowWas((v) => !v)} pressed={showWas}>
          <CaretRight size={12} className={`transition-transform ${showWas ? "rotate-90" : ""}`} />
          {showWas ? "Hide original" : "Show original"}
        </CardAction>
        <CardAction
          onClick={() => {
            setDraft(change.tailored);
            setEditing(true);
          }}
        >
          <PencilSimple size={12} /> Edit
        </CardAction>
        <CardAction onClick={() => onRewrite("rewrite")} disabled={!!busy}>
          <ArrowsClockwise size={12} className={busy === "rewrite" ? "animate-spin" : ""} /> Rewrite
        </CardAction>
        <CardAction onClick={() => onRewrite("humanize")} disabled={!!busy}>
          <Sparkle size={12} className={busy === "humanize" ? "animate-pulse" : ""} /> Humanize
        </CardAction>
      </div>
    </Card>
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

function AiCard({
  fix,
  roles,
  role,
  on,
  onToggle,
  onRole,
}: {
  fix: AtsFix;
  roles: string[];
  role: number;
  on: boolean;
  onToggle: (on: boolean) => void;
  onRole: (i: number) => void;
}) {
  // Already on (e.g. restored from an earlier choice) counts as vouched.
  const [vouched, setVouched] = useState(on);
  const label = fix.type === "headline" ? "New headline" : "New bullet";

  return (
    <Card on={on} provenance="ai" draft={!vouched}>
      <CardHeader provenance="ai" where={`${label} for “${fix.gap}”`} points={fix.score_delta}>
        <Switch
          on={on}
          disabled={!vouched}
          label={`Add this ${label.toLowerCase()}: ${fix.text}`}
          onChange={onToggle}
        />
      </CardHeader>
      <p className={`text-body-md leading-relaxed ${vouched ? "text-on-surface" : "italic text-on-surface-variant"}`}>
        {fix.text}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-sm border-t border-outline-variant/20 pt-xs">
        <label className="flex cursor-pointer items-center gap-xs text-label-sm text-on-surface">
          <input
            type="checkbox"
            checked={vouched}
            onChange={(e) => {
              setVouched(e.target.checked);
              // Withdrawing the confirmation withdraws the claim.
              if (!e.target.checked && on) onToggle(false);
            }}
            className={`h-4 w-4 accent-primary ${FOCUS_RING}`}
          />
          I have actually done this
        </label>
        {fix.type === "bullet" && roles.length > 0 && (
          <select
            aria-label="Add to role"
            value={role}
            onChange={(e) => onRole(Number(e.target.value))}
            className={`max-w-[16rem] truncate rounded-lg border border-outline-variant/50 bg-surface px-sm py-xs text-caption text-on-surface ${FOCUS_RING}`}
          >
            {roles.map((r, i) => (
              <option key={i} value={i}>
                Add to: {r}
              </option>
            ))}
          </select>
        )}
      </div>
    </Card>
  );
}

function CardAction({
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
      className={`flex items-center gap-1 rounded-md px-xs py-1 text-caption text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface disabled:opacity-40 ${FOCUS_RING}`}
    >
      {children}
    </button>
  );
}

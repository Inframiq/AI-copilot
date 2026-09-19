"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowsClockwise,
  CaretRight,
  Checks,
  LockSimple,
  PencilSimple,
  Sparkle,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { ResumeContent } from "@career-copilot/types";
import type { AtsFix, BulletRationale, RevertedBullet } from "@/lib/api-client";
import type { BulletChange } from "@/stores/tailoring-store";
import { classifyChange } from "@/lib/point-kind";
import { FOCUS_RING, PRESS } from "@/lib/focus";
import { BulletDiff } from "./BulletDiff";

type Decision = "accept" | "reject";
type Filter = "all" | "reworded" | "adds_terms" | "ai";
type Provenance = "reworded" | "adds_terms" | "ai";

/** Auto-select: every point built on the user's own bullets. AI-written
 * points are left alone — they need the user's word, not a click. */
export function autoSelectDecisions(changes: BulletChange[]): Record<string, Decision> {
  return Object.fromEntries(changes.map((c) => [c.key, "accept" as const]));
}

/** Clear all: every point off, AI-written included. */
export function clearDecisions(changes: BulletChange[], aiFixes: AtsFix[]): Record<string, Decision> {
  return {
    ...Object.fromEntries(changes.map((c) => [c.key, "reject" as const])),
    ...Object.fromEntries(aiFixes.map((f) => [`fix:${f.id}`, "reject" as const])),
  };
}

export function countPointsOn(
  changes: BulletChange[],
  aiFixes: AtsFix[],
  decisions: Record<string, string>,
): number {
  return (
    changes.filter((c) => decisions[c.key] !== "reject").length +
    aiFixes.filter((f) => decisions[`fix:${f.id}`] === "accept").length
  );
}

/**
 * Every point tailoring produced, sorted by where it came from — the review's
 * one real question is "is this still true of me?", and the answer differs by
 * provenance:
 *
 *   Reworded       your facts, new words              → start on
 *   Adds a JD term your bullet + a term you never used → start off
 *   Written by AI  not in your résumé at all          → off until you
 *                                                       confirm you did it
 *
 * Within a group the points that move the score most come first. Each card
 * has its own switch and "+N pts"; one that is on lifts off the page, one
 * that is off sits flat and faded.
 */
export function PointsLedger({
  changes,
  decisions,
  rationale,
  original,
  jdTerms = [],
  aiFixes,
  roles,
  fixExperienceIndex,
  liveDeltas,
  liveBulletDeltas,
  reverted = [],
  busy,
  rewriteErrors,
  revertedReasons,
  bulkActionsClassName = "",
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
  /** Every phrase the JD is scored on — see classifyChange. */
  jdTerms?: string[];
  /** The AI-written fixes: new bullets and the headline. */
  aiFixes: AtsFix[];
  /** "Title · Company" per experience entry, for placing a new bullet. */
  roles: string[];
  fixExperienceIndex: Record<string, number>;
  /** What each fix is worth GIVEN what is currently selected, by fix id.
   * AtsFix.score_delta is measured once at pipeline time against a single
   * hypothetical — every rewrite on, no fixes — so it is wrong as soon as the
   * user changes anything. Absent until the first live score lands, and the
   * pipeline value stands in until then. */
  liveDeltas?: Record<string, number>;
  /** The same for each rewritten bullet, by review key. The pipeline measures
   * a rewrite as a leave-one-out from the all-accepted state, so with other
   * rewrites off it understates what this one is worth. */
  liveBulletDeltas?: Record<string, number>;
  /** Rewrites the fact-lock refused during tailoring; those bullets kept
   * the candidate's own text. */
  reverted?: RevertedBullet[];
  busy?: Record<string, "rewrite" | "humanize" | null>;
  /** Why an inline Rewrite/Humanize failed, by change key. */
  rewriteErrors?: Record<string, string>;
  /** Fact-lock reasons from an inline Rewrite/Humanize, by change key. */
  revertedReasons?: Record<string, string[]>;
  /** e.g. "lg:hidden" when a rail elsewhere carries the same actions. */
  bulkActionsClassName?: string;
  onDecide: (key: string, d: Decision) => void;
  /** Many decisions in one update (and one re-score). */
  onBulk: (decisions: Record<string, Decision>) => void;
  onFixDecide: (id: string, d: Decision) => void;
  onFixRole: (id: string, experienceIndex: number) => void;
  onRewrite: (change: BulletChange, mode: "rewrite" | "humanize") => void;
  onEdit: (change: BulletChange, text: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  // Held here, not per card: a card unmounts when its group is filtered
  // out, and its confirmation used to vanish with it.
  const [vouched, setVouched] = useState<Record<string, boolean>>({});

  const { reworded, addsTerms } = useMemo(() => {
    const pts = (c: BulletChange) =>
      liveBulletDeltas?.[c.key] ?? rationale[c.key]?.score_delta ?? 0;
    const reworded: BulletChange[] = [];
    const addsTerms: { change: BulletChange; newTerms: string[] }[] = [];
    for (const change of changes) {
      const { kind, newTerms } = classifyChange(change, rationale[change.key], original, jdTerms);
      if (kind === "reworded") reworded.push(change);
      else addsTerms.push({ change, newTerms });
    }
    reworded.sort((a, b) => pts(b) - pts(a));
    addsTerms.sort((a, b) => pts(b.change) - pts(a.change));
    return { reworded, addsTerms };
  }, [changes, rationale, original, jdTerms]);

  const fixPoints = useCallback(
    (f: AtsFix) => liveDeltas?.[f.id] ?? f.score_delta,
    [liveDeltas],
  );
  const sortedAi = useMemo(
    () => [...aiFixes].sort((a, b) => fixPoints(b) - fixPoints(a)),
    [aiFixes, fixPoints],
  );

  const total = reworded.length + addsTerms.length + aiFixes.length;
  if (total === 0) {
    return (
      <div className="flex flex-col gap-md">
        <div className="rounded-3xl border border-dashed border-outline-variant/50 p-xl text-center">
          <p className="text-body-md text-on-surface-variant">
            No bullets were rewritten. That is not a verdict on fit — the score says how
            well you match; the skills below are how to raise it.
          </p>
        </div>
        <KeptAsWritten reverted={reverted} />
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
  const onCount = countPointsOn(changes, aiFixes, decisions);
  const isVouched = (f: AtsFix) => vouched[f.id] ?? decisions[`fix:${f.id}`] === "accept";

  const cardFor = (change: BulletChange, provenance: Provenance, newTerms?: string[]) => (
    <ChangeCard
      key={change.key}
      change={change}
      provenance={provenance}
      newTerms={newTerms}
      points={liveBulletDeltas?.[change.key] ?? rationale[change.key]?.score_delta}
      // Same rule as buildMergedContent: a rewrite with no decision yet is
      // applied, so it must show as on (runTailoring seeds every key).
      on={decisions[change.key] !== "reject"}
      busy={busy?.[change.key] ?? null}
      error={rewriteErrors?.[change.key]}
      reverted={revertedReasons?.[change.key]}
      onToggle={(on) => onDecide(change.key, on ? "accept" : "reject")}
      onRewrite={(m) => onRewrite(change, m)}
      onEdit={(t) => onEdit(change, t)}
    />
  );

  return (
    <section aria-label="Tailored points" className="flex flex-col gap-lg">
      <div className="flex flex-col gap-sm rounded-2xl border border-outline-variant/30 bg-surface-container-low p-xs sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-label="Show" className="-mx-xs flex gap-1 overflow-x-auto px-xs [scrollbar-width:none] sm:flex-wrap">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={filter === t.id}
              disabled={t.id !== "all" && t.count === 0}
              onClick={() => setFilter(t.id)}
              className={`shrink-0 whitespace-nowrap rounded-xl px-md py-xs text-label-sm disabled:cursor-not-allowed disabled:opacity-40 ${PRESS} ${FOCUS_RING} ${
                filter === t.id
                  ? "bg-surface-container-lowest font-semibold text-on-surface shadow-sm"
                  : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
              }`}
            >
              {t.label}{" "}
              <span className={`tabular ${filter === t.id ? "text-primary" : "opacity-70"}`}>{t.count}</span>
            </button>
          ))}
        </div>
        <div className={`flex items-center gap-xs px-xs ${bulkActionsClassName}`}>
          <span className="tabular text-caption text-on-surface-variant">
            {onCount} of {total} on
          </span>
          <button
            type="button"
            onClick={() => onBulk(autoSelectDecisions(changes))}
            title="Turns on every point built on your own bullets. AI-written points stay as they are."
            className={`flex items-center gap-1 rounded-xl bg-primary px-md py-xs text-label-sm font-semibold text-on-primary active:brightness-90 ${PRESS} ${FOCUS_RING}`}
          >
            <Checks size={14} weight="bold" /> Auto-select
          </button>
          <button
            type="button"
            onClick={() => onBulk(clearDecisions(changes, aiFixes))}
            className={`flex items-center gap-1 rounded-xl px-md py-xs text-label-sm text-on-surface-variant hover:bg-surface-container hover:text-on-surface active:bg-surface-container-high ${PRESS} ${FOCUS_RING}`}
          >
            <X size={14} /> Clear all
          </button>
        </div>
      </div>

      {show("reworded") && reworded.length > 0 && (
        <Group title="Reworded from your résumé" hint="Same facts, new words — safe to accept">
          {reworded.map((c) => cardFor(c, "reworded"))}
        </Group>
      )}

      {show("adds_terms") && addsTerms.length > 0 && (
        <Group
          title="Adds a job-description term"
          hint="Your work, plus a term your résumé never uses — turn on only if it is true"
        >
          {addsTerms.map(({ change, newTerms }) => cardFor(change, "adds_terms", newTerms))}
        </Group>
      )}

      {show("ai") && aiFixes.length > 0 && (
        <Group
          title="Written by AI — not in your résumé"
          hint="Add only what you have actually done; you will be asked about it"
        >
          {sortedAi.map((fix) => (
            <AiCard
              key={fix.id}
              fix={fix}
              points={liveDeltas?.[fix.id]}
              roles={roles}
              role={fixExperienceIndex[fix.id] ?? fix.experience_index ?? 0}
              on={decisions[`fix:${fix.id}`] === "accept"}
              vouched={isVouched(fix)}
              onVouch={(yes) => {
                setVouched((v) => ({ ...v, [fix.id]: yes }));
                // Confirming is the decision to add it; withdrawing the
                // confirmation withdraws the claim.
                onFixDecide(fix.id, yes ? "accept" : "reject");
              }}
              onToggle={(on) => onFixDecide(fix.id, on ? "accept" : "reject")}
              onRole={(i) => onFixRole(fix.id, i)}
            />
          ))}
        </Group>
      )}

      {filter === "all" && <KeptAsWritten reverted={reverted} />}
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

/** Rewrites the fact-lock refused: the bullet kept the candidate's own text.
 * Listed so an untouched bullet reads as a decision, not as nothing done. */
function KeptAsWritten({ reverted }: { reverted: RevertedBullet[] }) {
  if (reverted.length === 0) return null;
  return (
    <details data-testid="fact-lock-notice" className="group rounded-2xl border border-outline-variant/30 bg-surface-container-low">
      <summary
        className={`flex cursor-pointer list-none items-center gap-sm rounded-2xl px-md py-sm text-label-md text-on-surface hover:bg-surface-container ${FOCUS_RING}`}
      >
        <LockSimple size={16} className="text-on-surface-variant" />
        <span className="font-semibold">
          {reverted.length} bullet{reverted.length === 1 ? "" : "s"} kept as you wrote {reverted.length === 1 ? "it" : "them"}
        </span>
        <span className="text-caption text-on-surface-variant">— the rewrite broke a fact-checking rule</span>
        <CaretRight size={14} className="ml-auto transition-transform group-open:rotate-90" />
      </summary>
      <ul className="flex flex-col gap-sm px-md pb-md">
        {reverted.map((r) => (
          <li key={r.bullet_id} className="rounded-xl bg-surface-container-lowest p-sm text-body-sm">
            <p className="text-on-surface">“{r.original_text}”</p>
            <p className="text-caption text-on-surface-variant">{r.reasons.join("; ")}</p>
          </li>
        ))}
      </ul>
    </details>
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

/** True for a moment after `on` changes — the card's switch flash. */
function useFlash(on: boolean): boolean {
  const first = useRef(true);
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setFlashing(true);
    const t = setTimeout(() => setFlashing(false), 600);
    return () => clearTimeout(t);
  }, [on]);
  return flashing;
}

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
  const flashing = useFlash(on);
  const bar = PROVENANCE[provenance].bar;
  return (
    <li
      data-on={on}
      className={`relative overflow-hidden rounded-3xl transition-all duration-200 motion-reduce:transition-none ${
        flashing ? "point-flash" : ""
      } ${
        draft
          ? "border-2 border-dashed border-outline-variant bg-transparent"
          : on
            ? "-translate-y-0.5 border border-primary/30 bg-surface-container-lowest shadow-[0_10px_30px_-14px_rgba(27,58,143,0.45)] ring-1 ring-primary/20 motion-reduce:translate-y-0"
            : "border border-outline-variant/40 bg-surface-container-low/60 shadow-none"
      }`}
    >
      {bar && <span aria-hidden className={`absolute inset-y-0 left-0 w-1.5 ${bar} ${on ? "" : "opacity-40"}`} />}
      <div className={`flex flex-col gap-sm p-md pl-lg transition-opacity sm:p-lg sm:pl-xl ${on || draft ? "" : "opacity-60"}`}>
        {children}
      </div>
    </li>
  );
}

function CardHeader({
  provenance,
  where,
  points,
  zeroHint = "Wording only — this point doesn't change the score",
  children,
}: {
  provenance: Provenance;
  where?: string;
  points?: number;
  /** Why this is worth nothing. A rewrite scoring zero is wording; a fix
   * scoring zero is redundant, and saying "wording only" about a whole new
   * bullet is simply false. */
  zeroHint?: string;
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
        {points !== undefined && (
          points > 0 ? (
            <span className="tabular rounded-full bg-primary/10 px-sm py-0.5 text-label-sm font-semibold text-primary">
              +{points} pts
            </span>
          ) : (
            <span
              title={zeroHint}
              className="tabular rounded-full bg-surface-container px-sm py-0.5 text-label-sm text-on-surface-variant"
            >
              ±0
            </span>
          )
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
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 active:scale-95 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING} ${
        on ? "bg-primary hover:bg-primary/90" : "bg-outline-variant hover:bg-outline"
      }`}
    >
      <span
        aria-hidden
        className={`absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-surface-container-lowest shadow transition-transform duration-200 motion-reduce:transition-none ${
          on ? "translate-x-5" : ""
        }`}
      >
        {on && <Checks size={11} weight="bold" className="text-primary" />}
      </span>
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
  error,
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
  error?: string;
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
          className="w-full resize-none rounded-2xl border border-primary/50 bg-surface px-md py-sm text-body-md leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      ) : (
        <p className={`text-body-md leading-relaxed text-on-surface transition-opacity ${busy ? "opacity-50" : ""}`}>
          <NewTermMarks text={change.tailored} original={change.original} terms={newTerms} changeKey={change.key} />
        </p>
      )}

      {showWas && (
        <p className="rounded-2xl bg-surface-container px-md py-sm text-body-sm leading-relaxed text-on-surface-variant">
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
        <p className="text-caption text-tertiary">
          The new wording was discarded — it {reverted!.join("; ")}. The previous text is kept.
        </p>
      )}

      {error && (
        <p role="alert" className="flex items-center gap-xs rounded-xl bg-error-container px-sm py-xs text-caption text-on-error-container">
          <WarningCircle size={14} weight="fill" /> {error}
        </p>
      )}

      <div className="-ml-xs flex flex-wrap items-center gap-1 border-t border-outline-variant/20 pt-xs">
        <CardAction onClick={() => setShowWas((v) => !v)} pressed={showWas}>
          <CaretRight size={12} className={`transition-transform ${showWas ? "rotate-90" : ""}`} />
          {showWas ? "Hide original" : "Show original"}
        </CardAction>
        <CardAction
          onClick={() => {
            setDraft(change.tailored);
            setEditing(true);
          }}
          pressed={editing}
        >
          <PencilSimple size={12} /> Edit
        </CardAction>
        <CardAction onClick={() => onRewrite("rewrite")} disabled={!!busy} title="Rewrite this point again — uses a credit">
          <ArrowsClockwise size={12} className={busy === "rewrite" ? "animate-spin" : ""} />
          {busy === "rewrite" ? "Rewriting…" : "Rewrite"}
        </CardAction>
        <CardAction onClick={() => onRewrite("humanize")} disabled={!!busy} title="Make it sound more natural — uses a credit">
          <Sparkle size={12} className={busy === "humanize" ? "animate-pulse" : ""} />
          {busy === "humanize" ? "Humanizing…" : "Humanize"}
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
  points,
  roles,
  role,
  on,
  vouched,
  onVouch,
  onToggle,
  onRole,
}: {
  fix: AtsFix;
  /** Live value; falls back to the pipeline one when no score has landed. */
  points?: number;
  roles: string[];
  role: number;
  on: boolean;
  vouched: boolean;
  onVouch: (yes: boolean) => void;
  onToggle: (on: boolean) => void;
  onRole: (i: number) => void;
}) {
  const label = fix.type === "headline" ? "New headline" : "New bullet";

  return (
    <Card on={on} provenance="ai" draft={!vouched}>
      <CardHeader
        provenance="ai"
        where={`${label} for “${fix.gap}”`}
        points={points ?? fix.score_delta}
        zeroHint={`Already covered — “${fix.gap}” is met by something else you have selected`}
      >
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
        <label
          className={`flex cursor-pointer items-center gap-xs rounded-xl px-sm py-xs text-label-sm ${PRESS} ${
            vouched ? "bg-primary/10 text-primary" : "text-on-surface hover:bg-surface-container"
          }`}
        >
          <input
            type="checkbox"
            checked={vouched}
            onChange={(e) => onVouch(e.target.checked)}
            className={`h-4 w-4 accent-primary ${FOCUS_RING}`}
          />
          I have actually done this
        </label>
        {fix.type === "bullet" && roles.length > 0 && (
          <select
            aria-label="Add to role"
            value={role}
            onChange={(e) => onRole(Number(e.target.value))}
            className={`max-w-[16rem] truncate rounded-xl border border-outline-variant/50 bg-surface px-sm py-xs text-caption text-on-surface ${FOCUS_RING}`}
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
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      title={title}
      className={`flex items-center gap-1 rounded-lg px-sm py-1 text-caption disabled:cursor-not-allowed disabled:opacity-40 ${PRESS} ${FOCUS_RING} ${
        pressed
          ? "bg-primary/10 text-primary"
          : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface active:bg-surface-container-high"
      }`}
    >
      {children}
    </button>
  );
}

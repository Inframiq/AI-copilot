"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUUpLeft, ListBullets, CheckCircle } from "@phosphor-icons/react";
import type { BulletChange } from "@/stores/tailoring-store";
import type { BulletRationale } from "@/lib/api-client";
import { ChangeCard } from "./ChangeCard";
import { DeckList } from "./DeckList";

type Decision = "accept" | "reject";

export function TriageDeck({
  changes,
  decisions,
  importance,
  rationale,
  revertedReasons,
  busy,
  onDecide,
  onRewrite,
  onEdit,
  onTakeAllRemaining,
  onComplete,
}: {
  changes: BulletChange[];
  decisions: Record<string, Decision>;
  importance?: Record<string, string>;
  /** Agent 2's per-bullet responsibility + keywords, keyed by change key. */
  rationale?: Record<string, BulletRationale>;
  /** Fact-lock reasons from an inline Rewrite/Humanize, keyed by change key. */
  revertedReasons?: Record<string, string[]>;
  busy?: Record<string, "rewrite" | "humanize" | null>;
  onDecide: (key: string, d: Decision) => void;
  onRewrite: (change: BulletChange, mode: "rewrite" | "humanize") => void;
  onEdit: (change: BulletChange, text: string) => void;
  onTakeAllRemaining: () => void;
  onComplete?: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [exitDir, setExitDir] = useState<1 | -1>(1);
  const [lastDecided, setLastDecided] = useState<number | null>(null);
  const [showList, setShowList] = useState(false);
  const completedRef = useRef(false);

  const done = index >= changes.length;

  useEffect(() => {
    if (done && changes.length > 0 && !completedRef.current) {
      completedRef.current = true;
      onComplete?.();
    }
    if (!done) completedRef.current = false;
  }, [done, changes.length, onComplete]);

  const decide = useCallback(
    (d: Decision) => {
      const change = changes[index];
      if (!change) return;
      setExitDir(d === "accept" ? 1 : -1);
      onDecide(change.key, d);
      setLastDecided(index);
      setIndex((i) => i + 1);
    },
    [changes, index, onDecide]
  );

  const undo = useCallback(() => {
    if (lastDecided === null) return;
    setIndex(lastDecided);
    setLastDecided(null);
  }, [lastDecided]);

  useEffect(() => {
    if (showList) return;
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      // Never steal keys from an inline edit.
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      const change = changes[index];
      if (e.key === "ArrowRight") { e.preventDefault(); decide("accept"); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); decide("reject"); }
      else if (e.key.toLowerCase() === "r" && change) { e.preventDefault(); onRewrite(change, "rewrite"); }
      else if (e.key.toLowerCase() === "h" && change) { e.preventDefault(); onRewrite(change, "humanize"); }
      else if (e.key === "Backspace") { e.preventDefault(); undo(); }
      else if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); onTakeAllRemaining(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [changes, index, decide, undo, onRewrite, onTakeAllRemaining, showList]);

  if (changes.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-outline-variant/50 p-xl text-center">
        <p className="text-body-md text-on-surface-variant">
          No bullets were rewritten. That is not a verdict on fit — the score above
          says how well you match; the skill and gap fixes below are how to raise it.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex items-center justify-between gap-sm">
        <div className="flex items-center gap-sm min-w-0">
          <p className="tabular text-label-caps text-on-surface-variant whitespace-nowrap">
            {done ? `${changes.length} of ${changes.length} reviewed` : `change ${index + 1} of ${changes.length}`}
          </p>
          <div aria-hidden className="flex items-center gap-1">
            {changes.map((c, i) => (
              <span
                key={c.key}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  i === index ? "bg-primary" : i < index ? "bg-primary/40" : "bg-outline-variant/50"
                }`}
              />
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowList((v) => !v)}
          className="flex items-center gap-xs text-caption text-on-surface-variant hover:text-primary transition-colors shrink-0"
        >
          <ListBullets size={14} />
          {showList ? "back to deck" : "see all"}
        </button>
      </header>

      {showList ? (
        <DeckList
          changes={changes}
          decisions={decisions}
          onJump={(i) => { setIndex(i); setShowList(false); }}
          onTakeAllRemaining={onTakeAllRemaining}
        />
      ) : done ? (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-xl text-center flex flex-col items-center gap-sm">
          <CheckCircle size={32} weight="fill" className="text-primary" />
          <p className="text-body-md font-semibold text-on-surface">All changes reviewed</p>
          <p className="text-body-sm text-on-surface-variant">
            Nothing is saved yet — generate a preview to see the result.
          </p>
        </div>
      ) : (
        <div className="relative">
          {/* Peek cards convey queue depth — you feel how much is left. */}
          {[2, 1].map((offset) =>
            changes[index + offset] ? (
              <div
                key={offset}
                aria-hidden
                className="absolute inset-x-0 top-0 rounded-2xl border border-outline-variant/25 bg-surface-container-lowest h-full"
                style={{
                  transform: `translateY(${offset * 10}px) scale(${1 - offset * 0.04})`,
                  zIndex: -offset,
                }}
              />
            ) : null
          )}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={changes[index].key}
              initial={{ opacity: 0, y: 14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: exitDir * 420, rotate: exitDir * 6 }}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
            >
              <ChangeCard
                change={changes[index]}
                importance={importance?.[changes[index].key]}
                decision={decisions[changes[index].key]}
                rationale={rationale?.[changes[index].key]}
                revertedReasons={revertedReasons?.[changes[index].key]}
                busy={busy?.[changes[index].key] ?? null}
                onDecide={decide}
                onRewrite={(mode) => onRewrite(changes[index], mode)}
                onEdit={(text) => onEdit(changes[index], text)}
              />
            </motion.div>
          </AnimatePresence>
        </div>
      )}

      {lastDecided !== null && !showList && (
        <div className="flex items-center justify-between gap-sm px-md py-sm rounded-xl bg-surface-container text-caption text-on-surface-variant">
          <span>
            {decisions[changes[lastDecided]?.key] === "reject"
              ? "Kept your original."
              : "Took the tailored version."}
          </span>
          <button
            type="button"
            onClick={undo}
            className="flex items-center gap-xs text-primary font-semibold hover:underline"
          >
            <ArrowUUpLeft size={13} />
            Undo
          </button>
        </div>
      )}

      {!showList && !done && (
        <p className="text-caption text-on-surface-variant text-center">
          ← keep mine · → take it · R rewrite · H humanize · ⌫ undo · ⇧↵ take all remaining
        </p>
      )}
    </div>
  );
}

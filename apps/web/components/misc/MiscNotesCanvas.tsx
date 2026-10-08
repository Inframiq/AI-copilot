"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, NotePencil, Spinner, WarningCircle, X } from "@phosphor-icons/react";
import { apiClient } from "@/lib/api-client";
import { appendMiscPoints, getCareerProfile, type CareerProfile } from "@/lib/career-profile-client";
import {
  BULLET_SECTIONS, BULLET_WORDS, isMiscSection, MAX_MISC_POINTS, MAX_NOTE_CHARS, MISC_SECTION_LABEL,
  MISC_SECTIONS, RESTRUCTURE_NOTES_CREDITS, wordCount, type MiscPoint, type MiscSection,
} from "@/lib/misc-points";
import { FOCUS_RING, PRESS } from "@/lib/focus";

interface Draft {
  key: string;
  text: string;
  section: MiscSection;
  flags: string[];
  /** The AI's question for a detail the note didn't give. */
  ask: string;
}

type Phase = "writing" | "cleaning" | "preview" | "saving" | "saved";

const credits = `${RESTRUCTURE_NOTES_CREDITS} credit${RESTRUCTURE_NOTES_CREDITS === 1 ? "" : "s"}`;

/**
 * A notepad for the moment a user remembers something about themselves —
 * mid-tailoring or mid-analysis, related to this job or not. Save tidies it
 * with AI (a credit), shows the points to edit, and only what they confirm
 * goes into the profile's Miscellaneous section, offered in every later
 * tailoring review.
 *
 * Anything that would stop the save at the end — no profile yet, the
 * database not ready, the profile full — is said before a credit is spent.
 */
export function MiscNotesCanvas() {
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useQuery({ queryKey: ["careerProfile"], queryFn: getCareerProfile });
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("writing");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);

  const saved = profile?.miscellaneous;
  const room = MAX_MISC_POINTS - (saved?.length ?? 0);
  const blocker: React.ReactNode = isLoading
    ? null
    : !profile
      ? <>Save your <Link href="/profile" className="underline">profile</Link> once first, then notes can be kept in it.</>
      : !Array.isArray(saved)
        ? "Saving notes to your profile isn't available yet."
        : room <= 0
          ? <>Your profile already keeps {MAX_MISC_POINTS} points — remove some from <Link href="/profile#miscellaneous" className="underline">Miscellaneous</Link> first.</>
          : null;
  const tooLong = text.length > MAX_NOTE_CHARS;
  const kept = drafts.filter((d) => d.text.trim());

  async function handleTidy() {
    setError(null);
    setPhase("cleaning");
    try {
      const { points } = await apiClient.restructureNotes(text.trim());
      setDrafts(
        points.map((p) => ({
          key: crypto.randomUUID(),
          text: p.text,
          section: isMiscSection(p.section) ? p.section : "miscellaneous",
          flags: p.flags ?? [],
          ask: p.ask ?? "",
        })),
      );
      setPhase("preview");
    } catch (err) {
      const message = err instanceof Error && err.message ? ` — ${err.message}` : "";
      setError(`Couldn't tidy your note${message}. Your text is unchanged; try again.`);
      setPhase("writing");
    } finally {
      // Spent or refunded either way — keep the meter honest.
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
    }
  }

  async function handleSave() {
    if (kept.length === 0) return;
    setError(null);
    setPhase("saving");
    const now = new Date().toISOString();
    const points: MiscPoint[] = kept.map((d) => ({
      id: crypto.randomUUID(), text: d.text.trim(), section: d.section, created_at: now,
    }));
    try {
      const updated = await appendMiscPoints(points);
      queryClient.setQueryData<CareerProfile | null>(["careerProfile"], updated);
      setSavedCount(points.length);
      setText("");
      setDrafts([]);
      setPhase("saved");
    } catch (err) {
      const message = err instanceof Error && err.message ? ` — ${err.message}` : "";
      setError(`Couldn't save to your profile${message}. Nothing was lost; try again.`);
      setPhase("preview");
    }
  }

  function updateDraft(key: string, patch: Partial<Draft>) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }

  return (
    <section
      aria-label="Notes for your profile"
      className="flex flex-col gap-md rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-lg shadow-sm"
    >
      <header className="flex flex-col gap-xs">
        <h2 className="flex items-center gap-sm text-body-lg font-semibold text-on-surface">
          <NotePencil size={20} className="text-primary" />
          Remembered something about yourself?
        </h2>
        <p className="text-body-sm text-on-surface-variant">
          Write it here — for this job or not. It&rsquo;s tidied up and kept in your profile, ready to add to any
          résumé you tailor.
        </p>
      </header>

      {(phase === "writing" || phase === "cleaning") && (
        <>
          <textarea
            aria-label="Your note"
            value={text}
            readOnly={phase === "cleaning"}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="e.g. led the college robotics club for two years, won the inter-college hackathon in 2024"
            className={`w-full resize-y rounded-2xl border border-outline-variant/50 bg-surface p-md text-body-md text-on-surface placeholder:text-on-surface-variant/60 ${FOCUS_RING}`}
          />
          <div className="flex flex-wrap items-center justify-between gap-sm">
            <span className={`tabular text-caption ${tooLong ? "text-error" : "text-on-surface-variant"}`}>
              {text.length} / {MAX_NOTE_CHARS}
            </span>
            <button
              type="button"
              onClick={handleTidy}
              disabled={!text.trim() || tooLong || !!blocker || isLoading || phase === "cleaning"}
              className={`flex items-center gap-xs rounded-xl bg-primary px-md py-sm text-label-md font-semibold text-on-primary active:brightness-90 disabled:cursor-not-allowed disabled:opacity-50 ${PRESS} ${FOCUS_RING}`}
            >
              {phase === "cleaning" && <Spinner size={16} className="animate-spin" />}
              {phase === "cleaning" ? "Tidying…" : "Save"}
              <span className="font-normal opacity-80">· uses {credits}</span>
            </button>
          </div>
          {blocker && <p className="text-body-sm text-on-surface-variant">{blocker}</p>}
        </>
      )}

      {(phase === "preview" || phase === "saving") && (
        <>
          <p className="text-body-sm text-on-surface">
            Here&rsquo;s your note as résumé points. Edit, re-file or remove any, then save them to your profile.
          </p>
          {kept.length === 0 && (
            <p className="text-body-sm text-on-surface-variant">Every point is removed — discard, or write the note again.</p>
          )}
          <ul className="flex flex-col gap-sm">
            {drafts.map((d, i) => (
              <li key={d.key} className="flex flex-col gap-xs rounded-2xl border border-outline-variant/40 bg-surface p-sm">
                <div className="flex items-start gap-sm">
                  <textarea
                    aria-label={`Point ${i + 1}`}
                    value={d.text}
                    onChange={(e) => updateDraft(d.key, { text: e.target.value })}
                    rows={2}
                    className={`flex-1 resize-y rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-sm text-body-md text-on-surface ${FOCUS_RING}`}
                  />
                  <button
                    type="button"
                    aria-label={`Remove point ${i + 1}`}
                    onClick={() => setDrafts((prev) => prev.filter((x) => x.key !== d.key))}
                    className={`rounded-lg p-xs text-on-surface-variant hover:bg-surface-container hover:text-on-surface ${PRESS} ${FOCUS_RING}`}
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-sm">
                  <select
                    aria-label={`Section for point ${i + 1}`}
                    value={d.section}
                    onChange={(e) => updateDraft(d.key, { section: e.target.value as MiscSection })}
                    className={`rounded-xl border border-outline-variant/50 bg-surface px-sm py-xs text-caption text-on-surface ${FOCUS_RING}`}
                  >
                    {MISC_SECTIONS.map((s) => (
                      <option key={s} value={s}>
                        {MISC_SECTION_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  {BULLET_SECTIONS.has(d.section) && <BulletLength text={d.text} />}
                  {d.flags.map((f) => (
                    <span key={f} className="flex items-center gap-1 text-caption text-tertiary">
                      <WarningCircle size={14} weight="fill" /> {f}
                    </span>
                  ))}
                </div>
                {d.ask && (
                  <p className="text-caption text-on-surface-variant">
                    <span className="font-semibold text-on-surface">Make it stronger:</span> {d.ask} Add the
                    answer above if you know it.
                  </p>
                )}
              </li>
            ))}
          </ul>
          {kept.length > room && (
            <p className="text-body-sm text-error">
              Only {room} more fit in your profile — remove {kept.length - room} here or some from your profile first.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-sm">
            <button
              type="button"
              onClick={() => {
                setDrafts([]);
                setPhase("writing");
              }}
              disabled={phase === "saving"}
              className={`rounded-xl px-md py-sm text-label-md text-on-surface-variant hover:bg-surface-container hover:text-on-surface disabled:opacity-50 ${PRESS} ${FOCUS_RING}`}
            >
              Discard <span className="opacity-70">(the credit is already spent)</span>
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={kept.length === 0 || kept.length > room || phase === "saving"}
              className={`flex items-center gap-xs rounded-xl bg-primary px-md py-sm text-label-md font-semibold text-on-primary active:brightness-90 disabled:cursor-not-allowed disabled:opacity-50 ${PRESS} ${FOCUS_RING}`}
            >
              {phase === "saving" && <Spinner size={16} className="animate-spin" />}
              {phase === "saving" ? "Saving…" : "Save to profile"}
            </button>
          </div>
        </>
      )}

      {phase === "saved" && (
        <div role="status" className="flex flex-wrap items-center gap-sm text-body-md text-on-surface">
          <CheckCircle size={20} weight="fill" className="text-success" />
          Saved {savedCount} point{savedCount === 1 ? "" : "s"} to your profile.
          <Link href="/profile#miscellaneous" className={`text-primary underline ${FOCUS_RING}`}>
            See them
          </Link>
          <button
            type="button"
            onClick={() => setPhase("writing")}
            className={`rounded-xl px-sm py-xs text-label-md text-primary hover:bg-primary/10 ${PRESS} ${FOCUS_RING}`}
          >
            Write another
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="flex items-start gap-xs text-body-sm text-error">
          <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" /> {error}
        </p>
      )}
    </section>
  );
}

/** A bullet's length against what a strong one runs. Short is said, not
 * fixed: only the user knows the detail that would make it longer. */
function BulletLength({ text }: { text: string }) {
  const words = wordCount(text);
  const { preferMin, preferMax, max } = BULLET_WORDS;
  const [tone, note] =
    words > max
      ? ["text-error", `long — keep it under ${max}`]
      : words < preferMin
        ? ["text-tertiary", `short — strong bullets run ${preferMin}–${preferMax}`]
        : words > preferMax
          ? ["text-on-surface-variant", `a little long — ${preferMin}–${preferMax} reads best`]
          : ["text-success", "a good length"];
  return (
    <span className={`tabular text-caption ${tone}`}>
      {words} words · {note}
    </span>
  );
}

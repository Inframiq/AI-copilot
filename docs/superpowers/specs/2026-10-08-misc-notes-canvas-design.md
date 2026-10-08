# Miscellaneous notes canvas — design

Date: 2026-10-08
Status: draft, awaiting review

## Purpose

While tailoring or analysing a job, a user often remembers something about
themselves that isn't on the résumé — a project, an award, a responsibility,
a tool they used. Today they have to leave, open the profile, find the right
section and type it there. This feature gives them a **quick-capture
notepad** right where they are: type the point, press Save, and it's kept in
the profile's new **Miscellaneous** section. Every later tailoring review
offers those saved points so they can be added to (or left off) that résumé.

A note may or may not relate to the current job description. It is a fact
about the user, not about the JD.

## Decisions (made by the user, 2026-10-08)

| Question | Decision |
| --- | --- |
| Where a saved point lands on a résumé | AI suggests a section when saving; the user can change it |
| Preview after Save | Show the AI-cleaned points, user edits/removes, then confirms |
| Price | 1 credit per Save (one AI restructure call) |
| Same-review availability | A point saved during a review appears in that review immediately, off |
| Catch-all | "Miscellaneous" is itself a category, for points that fit no résumé section |

## Data

New column on the Supabase-managed `career_profiles` table:

```sql
-- apps/web/supabase/migrations/009_career_profile_miscellaneous.sql
ALTER TABLE career_profiles
  ADD COLUMN IF NOT EXISTS miscellaneous jsonb NOT NULL DEFAULT '[]';
```

Each item:

```ts
type MiscSection =
  | "experience" | "project" | "achievements" | "awards"
  | "leadership" | "volunteer" | "skills" | "miscellaneous";

interface MiscPoint {
  id: string;          // client-generated, stable
  text: string;        // the cleaned point, as it would print
  section: MiscSection;
  created_at: string;  // ISO timestamp
}
```

`CareerProfile.miscellaneous: MiscPoint[]` in `web/lib/career-profile-client.ts`.

Limits: 2,000 characters of input per Save; at most 50 saved points (Save is
disabled with a message when full — the user deletes some on the profile
page). A `skills` point's text is the skill name alone.

**Migration safety.** The migration is run by hand in the Supabase SQL editor,
like 002–008. Until it is, writing `miscellaneous` would fail. So the
profile page's main "Save Profile" never sends `miscellaneous` at all
(`CareerProfileInput` omits it); the column is written only by its own
`update` calls (`appendMiscPoints`, `setMiscPoints`), which check that the
loaded row has the key first. This also means a main Save from a stale tab
can't overwrite points saved from the canvas elsewhere. Before the migration runs, the canvas reports "Miscellaneous isn't available
yet" instead of charging a credit. A user with no profile row yet gets
"Save your profile once first" with a link, also before any credit is spent.

## API — `POST /ai/restructure-notes`

In `apps/api/app/routers/ai.py`, alongside `rewrite-bullet`.

- Request: `{ text: str (1–2000 chars) }`.
- Response: `{ points: [{ text, section, flags: [str] }] }` — nothing is saved
  server-side; the browser saves after the user confirms.
- `CREDIT_COSTS["restructure_notes"] = 1` in `core/credits.py`. Charged
  before the model call; refunded if the call fails or returns no usable
  points (same shape as `rewrite-bullet`). Insufficient credits → the existing
  402 path and message.
- Rate limit `20/minute`.
- Model: `fast` tier, JSON output. The prompt: split the text into separate
  résumé-ready points, fix grammar and phrasing, write bullets in résumé
  style (action verb, no first person), tag each with one section from the
  list above, use `miscellaneous` when nothing fits. Never add facts, numbers,
  employers, tools or outcomes that aren't in the user's text.
- Fact-lock: any number in an output point that doesn't appear in the input
  text (via `bullet_guard._numbers`, made public as `numbers`) adds a flag
  such as "Adds a number you didn't write: 40%". Flagged points are shown with
  the flag in the preview, the user decides. Unknown sections from the model
  fall back to `miscellaneous`; empty points are dropped; at most 10 points
  per Save.
- Recorded through `record_ai_usage(uid, "restructure_notes")`.

## Canvas — `MiscNotesCanvas`

One component, `web/components/misc/MiscNotesCanvas.tsx`, placed:

- on the tailoring review (`ReviewShell`), as a card after `SummaryCard`;
- on the JD Analyzer results, after the match / gaps.

States:

1. **Writing.** Textarea ("Remembered something about yourself? Write it
   here — it'll be kept in your profile."), character count, **Save** button
   labelled "uses 1 credit". Disabled when empty, over 2,000 characters, or
   the profile already holds 50 points.
2. **Cleaning.** Button spins; textarea read-only.
3. **Preview.** Each returned point: editable text, section dropdown, remove ✕,
   and any fact-lock flags. **Save to profile** and **Discard**. Discard
   returns to Writing with the original text intact (the credit is spent —
   the AI ran; the button copy says so).
4. **Saved.** Confirmation "Saved 3 points to your profile" with a link to the
   profile's Miscellaneous section; textarea cleared.

Errors (AI failure, network, save failure) are said inline with the user's
text left untouched, never swallowed. After a successful AI call the
subscription query is invalidated so the credit meter updates.

Saving appends to the profile's `miscellaneous` via a new
`appendMiscPoints(points)` in `career-profile-client.ts`, which reads the
current row and writes the merged list (no clobbering of other profile
fields), then updates the profile query cache so the review sees the new
points at once.

## Profile page — Miscellaneous section

New section at the end of `app/(app)/profile/page.tsx`, after Certifications,
using the existing `SectionHeader` / card styles:

- Lists saved points, grouped by section label.
- Each point: inline-editable text, section dropdown, delete. Free — no AI.
- An empty state pointing to where points are captured.
- Each change saves at once through `setMiscPoints` (like the profile photo),
  not through "Save Profile" — see the migration-safety rule above.

## Tailoring review — "From your profile"

A group of its own, **From your profile**, rendered directly below
`PointsLedger` (not inside its filter tabs, so it still shows when no bullet
was rewritten and `PointsLedger` shows its empty state). Hint: "Things you
saved about yourself — add the ones that fit this job". Shown only when the
profile has Miscellaneous points. Cards reuse `PointsLedger`'s `Card`,
`CardHeader`, `Switch` and `Group` with a new "From your profile" provenance.

- Every point starts **off** (decision key `misc:<id>`, default reject). A
  review where nothing is ticked produces exactly today's résumé.
- Each card shows the text and a **destination** dropdown:
  - `experience` → one entry per role on this résumé (default: most recent);
  - `project` → one entry per project (if the résumé has none, the option is
    absent and the default becomes Achievements);
  - Achievements / Awards / Leadership / Volunteer / Skills.
  - A `miscellaneous`-tagged point starts with "Choose where it goes" and its
    switch is disabled until a real destination is picked.
- Destination changes are per-review (`miscTarget[id]` in the tailoring
  store), not written back to the profile.
- `buildMergedContent` folds accepted misc points in last, alongside fixes:
  a bullet appends to its role/project under `MAX_BULLETS_PER_ROLE` and is
  skipped if `bulletAlreadyPresent`; a list item appends to its list if not
  already there; a skill appends under `MAX_MERGED_SKILLS` without dupes.
- Ticking, unticking or changing destination calls `refreshProjectedScore`, so
  the live score in the rail reacts. Cards carry no per-point "+N pts" badge:
  `project-score` prices fixes and rewrites, not these, and it stays
  unchanged. A point unrelated to the JD may leave the score where it is.
- `countPointsOn` / `pointsTotal` include misc points so the rail's tally
  stays truthful. "Turn on safe points" (`autoSelectDecisions`) does **not**
  touch misc points; "Clear" turns them off.
- The tailoring store loads Miscellaneous from the career profile when the
  review opens; a canvas save during the review adds the new points to the
  group immediately, off.

## Not breaking current behaviour

- Misc points default off; `buildMergedContent` with no `misc:` decisions
  returns exactly what it returns today (covered by a test).
- Profiles without the column read as `[]`; the profile save is unchanged
  until the column exists.
- No change to the tailoring pipeline, fingerprints/reuse, or
  `project-score` — it already scores whatever merged content it is sent.
- JD Analyzer and review layouts gain one card each; nothing existing moves.
- Existing web and API test suites must pass unchanged.

## Testing

- API: `restructure-notes` charges 1 credit; refunds on model error and on
  empty output; flags an invented number; maps unknown sections to
  `miscellaneous`; caps at 10 points; 422 on empty/oversized text.
- Store: `buildMergedContent` with misc decisions — bullet to a chosen role,
  to a project, list items, skill dedupe/cap, duplicates skipped, nothing
  ticked = unchanged output.
- Components: canvas Writing → Preview → Saved, Discard keeps text, errors
  shown; PointsLedger misc group default off, `miscellaneous` point disabled
  until a destination is chosen, toggling triggers a re-score.
- Profile page: Miscellaneous section renders, edits and deletes; save omits
  the field when the row lacks it.
- End to end (run skill): save a note on the review, see it in the profile,
  start another tailoring, tick it, watch the score and the merged résumé.

## Out of scope

- Printing a "Miscellaneous" heading on the résumé (rejected in favour of the
  category-only option).
- Using Miscellaneous points as tailoring-pipeline input.
- An AI capture box on the profile page itself.

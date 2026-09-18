// Derives the studio step spine's display state from values the stores
// already hold. Deliberately pure and store-free: the spine exposes the
// tailoring flow that EditorPanel used to switch on invisibly
// (hasJdContext / pendingContent / neither), so the derivation is worth
// testing on its own rather than through a component.

export type StepId = "source" | "match" | "review" | "polish" | "export";
export type StepStatus = "done" | "current" | "available" | "locked";

export interface StepInput {
  /** Set when the user arrived from the JD analyzer. */
  jdId: string | null;
  /** Set when the user pasted a JD directly in the studio. */
  jdText: string;
  atsScore: number | null;
  /** tailoring-store's pendingContent — shape is irrelevant here. */
  pendingContent: unknown | null;
  /** Render produced by the tailoring preview. */
  previewPdfUrl: string | null;
  /** Render produced outside tailoring (plain studio preview / export). */
  pdfSignedUrl: string | null;
  isDirty: boolean;
  /** A render has been persisted to the resume, not just held in memory. */
  hasSavedRender: boolean;
}

export interface Step {
  id: StepId;
  label: string;
  status: StepStatus;
  /** Present only when status is "locked" — shown as the node's tooltip. */
  lockedReason?: string;
}

const LABELS: Record<StepId, string> = {
  source: "Source",
  match: "Match",
  review: "Review",
  polish: "Polish",
  export: "Export",
};

export function deriveSteps(input: StepInput): Step[] {
  const hasJd = !!input.jdId || input.jdText.trim().length > 0;
  const hasAnalysis = input.atsScore !== null;
  const hasPending = input.pendingContent !== null;
  const hasRender = !!(input.previewPdfUrl || input.pdfSignedUrl);
  const exported = input.hasSavedRender && !input.isDirty;

  // Each entry: [id, done, unlocked, lockedReason].
  // "review" is done once a render exists — the user has moved past the
  // decision queue — not merely because pending content arrived.
  const raw: Array<[StepId, boolean, boolean, string]> = [
    ["source", hasJd, true, ""],
    ["match", hasAnalysis, hasJd, "Add a job description first"],
    ["review", hasRender, hasPending, "Run Tailor to generate changes"],
    ["polish", exported, hasRender, "Generate a preview first"],
    ["export", exported, hasRender, "Generate a preview first"],
  ];

  // The current step is the furthest unlocked step still outstanding, so
  // opening a already-rendered resume lands on Polish rather than dragging
  // the user back to Source. Export is the exception: a render existing
  // does not mean the review queue is finished, so Export only becomes
  // current once nothing earlier is outstanding.
  const outstanding = raw
    .map(([id], i) => ({ id, i }))
    .filter(({ i }) => raw[i][2] && !raw[i][1]);
  const eligible =
    outstanding.length > 1 && outstanding[outstanding.length - 1].id === "export"
      ? outstanding.slice(0, -1)
      : outstanding;
  const currentIndex = eligible.length > 0 ? eligible[eligible.length - 1].i : -1;

  return raw.map(([id, done, unlocked, lockedReason], i) => {
    if (!unlocked) {
      return { id, label: LABELS[id], status: "locked" as const, lockedReason };
    }
    if (done) return { id, label: LABELS[id], status: "done" as const };
    return {
      id,
      label: LABELS[id],
      status: i === currentIndex ? ("current" as const) : ("available" as const),
    };
  });
}

export function currentStepId(steps: Step[]): StepId {
  const current = steps.find((s) => s.status === "current");
  if (current) return current.id;
  const done = steps.filter((s) => s.status === "done");
  return done.length > 0 ? done[done.length - 1].id : "source";
}

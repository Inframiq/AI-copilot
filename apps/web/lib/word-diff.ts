/**
 * Word-level diff for résumé bullets.
 *
 * The review screen's whole job is answering "how well was my bullet
 * rephrased?" — showing the original struck through above the rewrite makes
 * the reader re-read both in full and play spot-the-difference on every
 * bullet. Highlighting the actual words that moved answers it at a glance.
 *
 * Hand-rolled rather than pulled from a package: résumé bullets are capped at
 * 35 words (resume_spec HARD_LIMITS), so a plain O(n·m) LCS is instant and a
 * dependency would cost more than it saves.
 */

export type DiffOp = {
  type: "equal" | "insert" | "delete";
  /** The original's text for this segment. */
  text: string;
  /** Only on "equal" segments, and only when the two sides spell the same
   * word with different surrounding whitespace. Each side must render with
   * its OWN spacing: "Led a team" vs "Led a team of 6" match on "team", but
   * the original's token has no trailing space, so reusing it on the rewrite
   * side renders "teamof 6". Render the tailored side with
   * `op.tailoredText ?? op.text`. */
  tailoredText?: string;
};

/** Split into words with their trailing whitespace attached, so joining the
 * ops back together reproduces the input byte for byte. */
function tokenize(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

// Above this many tokens per side the DP table stops being worth building.
// Nothing the review screen shows comes close (a bullet is ≤35 words, a
// summary ≤80), so this only guards against pathological input.
const MAX_TOKENS = 400;

export function diffWords(originalText: string, tailoredText: string): DiffOp[] {
  const a = tokenize(originalText);
  const b = tokenize(tailoredText);

  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    return merge([
      ...(originalText ? [{ type: "delete" as const, text: originalText }] : []),
      ...(tailoredText ? [{ type: "insert" as const, text: tailoredText }] : []),
    ]);
  }

  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i].trim() === b[j].trim()
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i].trim() === b[j].trim()) {
      ops.push({ type: "equal", text: a[i], tailoredText: b[j] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ type: "delete", text: a[i++] });
    } else {
      ops.push({ type: "insert", text: b[j++] });
    }
  }
  while (i < a.length) ops.push({ type: "delete", text: a[i++] });
  while (j < b.length) ops.push({ type: "insert", text: b[j++] });

  return merge(ops);
}

/** Collapse runs of the same type into one segment — the UI highlights a
 * changed phrase as a block, not word by word. */
function merge(ops: DiffOp[]): DiffOp[] {
  const out: DiffOp[] = [];
  for (const op of ops) {
    const last = out[out.length - 1];
    if (last && last.type === op.type) {
      last.tailoredText = (last.tailoredText ?? last.text) + (op.tailoredText ?? op.text);
      last.text += op.text;
    } else {
      out.push({ ...op });
    }
  }
  return out;
}

"use client";
import type { RevertedBullet } from "@/lib/api-client";

// A rewrite the server's deterministic fact-lock rejected leaves the bullet at
// its original text. Without this the bullet simply doesn't appear in the
// triage deck, which is indistinguishable from the pipeline having chosen not
// to touch it. See apps/api/app/services/bullet_guard.py.
//
// Ported from the removed components/resume/BulletReviewPanel.tsx, which the
// studio redesign replaced while this landed upstream.
export function FactLockNotice({ reverted }: { reverted: RevertedBullet[] }) {
  if (reverted.length === 0) return null;
  const many = reverted.length !== 1;
  return (
    <div
      data-testid="fact-lock-notice"
      className="flex flex-col gap-xs rounded-2xl border border-tertiary/40 bg-tertiary/5 p-md"
    >
      <p className="text-label-md font-bold text-on-surface">
        {reverted.length} bullet{many ? "s" : ""} kept as you wrote {many ? "them" : "it"}
      </p>
      <p className="text-body-md leading-relaxed text-on-surface-variant">
        The AI&rsquo;s rewrite broke a fact-checking rule, so your original was kept.
      </p>
      <ul className="mt-xs flex flex-col gap-sm">
        {reverted.map((r) => (
          <li key={r.bullet_id} className="text-body-md leading-relaxed text-on-surface-variant">
            <span className="text-on-surface">&ldquo;{r.original_text}&rdquo;</span>
            <br />
            <span className="text-caption">{r.reasons.join("; ")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

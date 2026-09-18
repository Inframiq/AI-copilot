"use client";
import { use, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ReviewShell } from "@/components/builder/ReviewShell";
import { useResumeStore } from "@/stores/resume-store";
import { useTailoringStore } from "@/stores/tailoring-store";

/**
 * The JD path's first stop: JD Analyzer → here → Studio.
 *
 * Tailoring runs on arrival. Pressing "Tailor Resume" on the analyzer is the
 * decision; making the user press a second button here to actually spend the
 * credit was the old flow's worst seam.
 */
export default function StudioReviewPage({
  params,
}: {
  params: Promise<{ resumeId: string }>;
}) {
  const { resumeId } = use(params);
  const router = useRouter();
  const jdId = useTailoringStore((s) => s.jdId);
  const jdText = useTailoringStore((s) => s.jdText);
  const pendingContent = useTailoringStore((s) => s.pendingContent);
  const hasJdContext = !!jdId || !!jdText.trim();

  // One run per mount. Without the ref a re-render mid-flight — or React's
  // development double-invoke — would spend a second credit.
  const startedRef = useRef(false);

  useEffect(() => {
    // No JD yet: this route is also where you paste one, so there is nothing
    // to run and nothing to redirect away from.
    if (!hasJdContext || startedRef.current || pendingContent) return;
    startedRef.current = true;
    useTailoringStore.getState().runTailoring(resumeId);
  }, [hasJdContext, pendingContent, resumeId]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <ReviewShell
        onBack={() => router.push(jdId ? `/jd/${jdId}` : `/studio/${resumeId}`)}
        onApply={() => {
          // applyBulletDecisions has already written the accepted bullets into
          // resume-store; flush them now rather than waiting on the autosave
          // debounce, so a refresh in the Studio cannot lose the review.
          useResumeStore.getState().saveNow().catch(() => {});
          router.push(`/studio/${resumeId}/preview`);
        }}
      />
    </div>
  );
}

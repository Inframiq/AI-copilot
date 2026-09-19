"use client";
import { use, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ReviewShell } from "@/components/builder/ReviewShell";
import { useResumeStore } from "@/stores/resume-store";
import { useHydratedResume } from "@/lib/use-hydrated-resume";
import { useTailoringStore } from "@/stores/tailoring-store";
import { apiClient } from "@/lib/api-client";
import type { Resume } from "@career-copilot/types";

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

  // The analyzer never loads the résumé into resume-store, so this page is
  // usually the first that needs it. The review diffs tailored bullets
  // against it, and runTailoring seeds its decisions from it — without it the
  // review lists nothing and Apply has nothing to merge into.
  useHydratedResume(resumeId);
  const storeResumeId = useResumeStore((s) => s.resumeId);
  const hasContent = useResumeStore((s) => s.content !== null);
  const resumeLoaded = storeResumeId === resumeId && hasContent;

  // One run per mount. Without the ref a re-render mid-flight — or React's
  // development double-invoke — would spend a second credit.
  const startedRef = useRef(false);

  useEffect(() => {
    // No JD yet: this route is also where you paste one, so there is nothing
    // to run and nothing to redirect away from.
    if (!hasJdContext || !resumeLoaded || startedRef.current || pendingContent) return;
    startedRef.current = true;
    useTailoringStore.getState().runTailoring(resumeId);
  }, [hasJdContext, resumeLoaded, pendingContent, resumeId]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <ReviewShell
        onBack={() => router.push(jdId ? `/jd/${jdId}` : `/studio/${resumeId}`)}
        onTryAnother={() => useTailoringStore.getState().runTailoring(resumeId, { fresh: true })}
        onRetry={() => useTailoringStore.getState().runTailoring(resumeId)}
        onApply={() => {
          // commitReview has just written the merged résumé into resume-store;
          // flush it now rather than waiting on the autosave debounce, so a
          // refresh in the Studio cannot lose the review.
          useResumeStore.getState().saveNow().catch(() => {});
          router.push(`/studio/${resumeId}/preview`);
        }}
      />
    </div>
  );
}

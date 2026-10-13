"use client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { MotionConfig } from "motion/react";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { ResumeLimitModal } from "@/components/resume/ResumeLimitModal";
import { ResumeConflictModal } from "@/components/resume/ResumeConflictModal";
import { HeadlineConfirmModal } from "@/components/resume/HeadlineConfirmModal";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        {children}
        <OfflineBanner />
        {/* Asks before a new résumé pushes an old one out. */}
        <ResumeLimitModal />
        {/* Asks which copy to keep when another device saved first. */}
        <ResumeConflictModal />
        {/* After an upload, checks the headline the parser read. */}
        <HeadlineConfirmModal />
      </QueryClientProvider>
    </MotionConfig>
  );
}

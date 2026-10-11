"use client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { MotionConfig } from "motion/react";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { ResumeLimitModal } from "@/components/resume/ResumeLimitModal";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        {children}
        <OfflineBanner />
        {/* Asks before a new résumé pushes an old one out. */}
        <ResumeLimitModal />
      </QueryClientProvider>
    </MotionConfig>
  );
}

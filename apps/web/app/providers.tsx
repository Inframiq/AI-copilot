"use client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { MotionConfig } from "motion/react";
import { OfflineBanner } from "@/components/ui/OfflineBanner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        {children}
        <OfflineBanner />
      </QueryClientProvider>
    </MotionConfig>
  );
}

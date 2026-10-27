import { Sidebar } from "@/components/layout/Sidebar";
import { TopNav } from "@/components/layout/TopNav";
import { PageTransition } from "@/components/PageTransition";
import { GuidedTour } from "@/components/tour/GuidedTour";
import { PlanTracker } from "@/components/analytics/PlanTracker";
import { PolicyUpdatePrompt } from "@/components/legal/PolicyUpdatePrompt";
import { ViewportLock } from "@/components/layout/ViewportLock";
import { SessionGuard } from "@/components/auth/SessionGuard";
import { OutOfCreditsDialog } from "@/components/plans/OutOfCreditsDialog";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-app-shell className="text-on-background h-full flex flex-col md:flex-row overflow-hidden relative z-[1]">
      {/* The page under this one-screen layout never scrolls — see ViewportLock. */}
      <ViewportLock />
      <Sidebar />
      <main className="flex-1 md:ml-[var(--sidebar-w)] flex flex-col h-dvh overflow-y-auto overscroll-y-contain overflow-x-hidden w-full pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-0 transition-[margin] duration-300">
        <TopNav />
        <PageTransition>{children}</PageTransition>
      </main>
      <GuidedTour />
      <PlanTracker />
      <PolicyUpdatePrompt />
      <SessionGuard />
      <OutOfCreditsDialog />
    </div>
  );
}

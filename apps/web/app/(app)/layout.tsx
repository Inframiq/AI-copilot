import { Sidebar } from "@/components/layout/Sidebar";
import { TopNav } from "@/components/layout/TopNav";
import { PageTransition } from "@/components/PageTransition";
import { GuidedTour } from "@/components/tour/GuidedTour";
import { PlanTracker } from "@/components/analytics/PlanTracker";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-on-background h-full flex flex-col md:flex-row overflow-hidden relative z-[1]">
      <Sidebar />
      <main className="flex-1 md:ml-[var(--sidebar-w)] flex flex-col h-screen overflow-y-auto overflow-x-hidden w-full pb-20 md:pb-0 transition-[margin] duration-300">
        <TopNav />
        <PageTransition>{children}</PageTransition>
      </main>
      <GuidedTour />
      <PlanTracker />
    </div>
  );
}

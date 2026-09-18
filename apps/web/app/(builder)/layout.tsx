import { PlanTracker } from "@/components/analytics/PlanTracker";

/**
 * The Builder and Studio own the full viewport — no app sidebar, no top nav.
 *
 * A route group changes no URLs, so middleware.ts's "/studio" prefix still
 * protects everything under here exactly as it did under (app). PlanTracker
 * stays for analytics parity with (app)/layout.tsx; GuidedTour does not,
 * since its steps point at sidebar nav items that are absent here.
 */
export default function BuilderLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-on-background">
      {children}
      <PlanTracker />
    </div>
  );
}

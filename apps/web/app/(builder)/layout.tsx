import { PlanTracker } from "@/components/analytics/PlanTracker";
import { PolicyUpdatePrompt } from "@/components/legal/PolicyUpdatePrompt";
import { ViewportLock } from "@/components/layout/ViewportLock";

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
    <div data-app-shell className="flex h-dvh flex-col overflow-hidden bg-background text-on-background">
      {/* The page under this one-screen layout never scrolls — see ViewportLock. */}
      <ViewportLock />
      {children}
      <PlanTracker />
      <PolicyUpdatePrompt />
    </div>
  );
}

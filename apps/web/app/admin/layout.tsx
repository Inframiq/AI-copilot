import type { Metadata } from "next";

// Internal-only tool — never index it, and it deliberately skips the
// (app) route group's Sidebar/TopNav/GuidedTour/FeedbackWidget chrome
// (those are all built for the two-person admin allowlist's normal-user
// counterparts, not for this page).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background text-on-background">{children}</div>;
}

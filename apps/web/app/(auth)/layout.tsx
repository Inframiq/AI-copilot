import type { Metadata } from "next";
import { LiquidEtherBackground } from "@/components/backgrounds/LiquidEtherBackground";

// Sign-in/sign-up pages carry no unique content worth ranking on, and
// indexing them just splits crawl budget/link equity away from the
// landing page — keep them out of search results but let crawlers still
// follow links through them.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  // LiquidEtherBackground (fixed, z-index:0) is a positioned element and
  // paints above static in-flow content regardless of DOM order — this
  // wrapper must be positioned with a higher z-index so the page renders
  // above the canvas.
  return (
    <>
      <LiquidEtherBackground />
      <div className="relative z-[1]">{children}</div>
    </>
  );
}

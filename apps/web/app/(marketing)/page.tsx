import type { Metadata } from "next";
import { LandingNav } from "@/components/marketing/LandingNav";
import { LandingHero } from "@/components/marketing/LandingHero";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { HonestByDesign } from "@/components/marketing/HonestByDesign";
import { BeyondTheScore } from "@/components/marketing/BeyondTheScore";
import { ClosingCta } from "@/components/marketing/ClosingCta";
import { LandingFooter } from "@/components/marketing/LandingFooter";

export const metadata: Metadata = {
  title: "AI Resume Builder — Tailor Your Resume to Any Job in Seconds",
  description:
    "Free AI resume builder and resume tailoring tool. Paste a job description and KripaX rewrites your resume to match it, scores it against real ATS criteria, and generates interview questions for your exact skill gaps.",
  alternates: { canonical: "/" },
};

// SoftwareApplication structured data — lets Google show a rich result
// (rating/price snippet) for this page instead of a bare blue link.
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "KripaX",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "AI resume builder that tailors your resume to any job description, scores it against ATS criteria, and generates targeted interview prep questions.",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  url: "https://kripax.inframiq.com",
};

// The search-facing wording lives in the metadata above and the JSON-LD; the
// page itself speaks to the person reading it.
export default function LandingPage() {
  return (
    // overflow-x-clip: the demo's glow and the staggered panels reach past
    // their boxes on purpose; on a phone that widened the page sideways.
    <div data-smooth-scroll className="relative z-[1] flex min-h-screen flex-col overflow-x-clip">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger -- static, hardcoded JSON-LD, not user input
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <LandingNav />
      <main className="flex-1">
        <LandingHero />
        <HowItWorks />
        <HonestByDesign />
        <BeyondTheScore />
        <ClosingCta />
      </main>
      <LandingFooter />
    </div>
  );
}

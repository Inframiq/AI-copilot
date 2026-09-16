import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { FileText, Brain, ChartLineUp } from "@phosphor-icons/react/dist/ssr";

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

export default function LandingPage() {
  return (
    <div className="relative z-[1] min-h-screen flex flex-col">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger -- static, hardcoded JSON-LD, not user input
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <nav className="flex items-center justify-between px-gutter py-lg max-w-[1440px] mx-auto w-full gap-sm">
        <div className="flex items-center min-w-0">
          <Image src="/brand/logo-wordmark.png" alt="KripaX" width={154} height={34} priority />
        </div>
        <div className="flex items-center gap-md shrink-0">
          <Link
            href="/login"
            className="hidden sm:inline-flex text-label-md text-on-surface-variant hover:text-on-surface transition-colors"
          >
            Sign In
          </Link>
          <Link
            href="/register"
            className="px-md sm:px-lg py-sm rounded-lg text-label-md text-on-primary bg-primary shadow-md hover:shadow-lg transition-all whitespace-nowrap"
          >
            Get Started Free
          </Link>
        </div>
      </nav>

      <main className="flex-1 flex flex-col items-center justify-center text-center px-gutter py-xxl">
        <div className="max-w-[800px] mx-auto">
          <h1 className="text-headline-xl text-on-surface mb-lg">
            AI Resume Builder That Tailors Your Resume to Any Job
          </h1>
          <p className="text-body-lg text-on-surface-variant mb-xl max-w-[36rem] mx-auto">
            KripaX is a free AI resume builder — paste a job description and it
            tailors your resume to match, calculates a real ATS compatibility score, and
            generates interview questions targeting your exact skill gaps.
          </p>
          <div className="flex items-center justify-center gap-md flex-wrap">
            <Link
              href="/register"
              className="px-xxl py-md rounded-xl text-label-md text-on-primary bg-primary shadow-lg hover:shadow-xl transition-all"
            >
              Get Started Free
            </Link>
            <Link
              href="/login"
              className="px-xxl py-md rounded-xl text-label-md text-on-surface border border-outline-variant hover:bg-surface-container transition-all"
            >
              Sign In
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-gutter mt-xxl w-full">
            {[
              {
                icon: FileText,
                title: "ATS Score",
                desc: "See exactly how well your resume matches any job description with a real ATS compatibility score.",
              },
              {
                icon: ChartLineUp,
                title: "AI Tailoring",
                desc: "Rewrites your bullets to match job keywords with a humanize slider to keep your authentic voice.",
              },
              {
                icon: Brain,
                title: "Interview Prep",
                desc: "Questions grounded in the job description and your own resume — not generic advice you've already heard.",
              },
            ].map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-sm text-left"
              >
                <div className="w-10 h-10 rounded-xl bg-secondary-container flex items-center justify-center mb-md">
                  <Icon size={22} weight="fill" className="text-primary" />
                </div>
                <h2 className="text-label-md font-bold text-on-surface mb-sm">{title}</h2>
                <p className="text-body-sm text-on-surface-variant">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

import Link from "next/link";
import { RocketLaunch, FileText, Brain, ChartLineUp } from "@phosphor-icons/react/dist/ssr";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <nav className="flex items-center justify-between px-gutter py-lg max-w-[1440px] mx-auto w-full">
        <div className="flex items-center gap-md">
          <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center">
            <RocketLaunch size={18} weight="fill" className="text-on-primary" />
          </div>
          <span className="text-headline-md font-black text-primary">Career Copilot</span>
        </div>
        <div className="flex items-center gap-md">
          <Link
            href="/login"
            className="text-label-md text-on-surface-variant hover:text-on-surface transition-colors"
          >
            Sign In
          </Link>
          <Link
            href="/register"
            className="px-lg py-sm rounded-lg text-label-md text-on-primary bg-primary shadow-md hover:shadow-lg transition-all"
          >
            Get Started Free
          </Link>
        </div>
      </nav>

      <main className="flex-1 flex flex-col items-center justify-center text-center px-gutter py-xxl">
        <div className="max-w-[800px] mx-auto">
          <h1 className="text-headline-xl text-on-surface mb-lg">
            Land Your Dream Job with AI
          </h1>
          <p className="text-body-lg text-on-surface-variant mb-xl max-w-xl mx-auto">
            Career Copilot tailors your resume to any job description in seconds,
            calculates your ATS score, and generates interview questions targeting
            your exact skill gaps.
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
                desc: "Gap-based questions targeting your missing skills, not generic advice you've already heard.",
              },
            ].map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="bg-surface-container-lowest rounded-2xl p-lg border border-outline-variant/20 shadow-sm text-left"
              >
                <div className="w-10 h-10 rounded-xl bg-secondary-container flex items-center justify-center mb-md">
                  <Icon size={22} weight="fill" className="text-primary" />
                </div>
                <p className="text-label-md font-bold text-on-surface mb-sm">{title}</p>
                <p className="text-body-sm text-on-surface-variant">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

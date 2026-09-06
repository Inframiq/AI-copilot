import Link from "next/link";
import { RocketLaunch } from "@phosphor-icons/react/dist/ssr";

// TEMPLATE — replace [Legal Entity Name], [Contact Email], and [Jurisdiction]
// with real values, and have this reviewed by a lawyer before relying on it
// for a public launch. It is not legal advice.
const LAST_UPDATED = "August 8, 2026";

export const metadata = { title: "Privacy Policy — Career Copilot" };

export default function PrivacyPolicyPage() {
  return (
    <div className="relative z-[1] min-h-screen flex flex-col">
      <nav className="flex items-center justify-between px-gutter py-lg max-w-[1440px] mx-auto w-full">
        <Link href="/" className="flex items-center gap-md">
          <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center">
            <RocketLaunch size={18} weight="fill" className="text-on-primary" />
          </div>
          <span className="text-headline-md font-black text-on-background tracking-tight">Career Copilot</span>
        </Link>
        <Link href="/" className="text-label-md text-on-surface-variant hover:text-on-surface transition-colors">
          Back to home
        </Link>
      </nav>

      <main className="flex-1 px-gutter py-xxl">
        <article className="max-w-[720px] mx-auto flex flex-col gap-lg">
          <div>
            <h1 className="text-headline-xl text-on-surface mb-sm">Privacy Policy</h1>
            <p className="text-body-sm text-on-surface-variant">Last updated: {LAST_UPDATED}</p>
          </div>

          <p className="text-body-md text-on-surface-variant">
            Career Copilot (&quot;we&quot;, &quot;us&quot;) provides an AI-assisted resume, job-description
            analysis, and interview preparation tool. This policy explains what we collect, how we use it,
            and the choices you have.
          </p>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">Information we collect</h2>
            <ul className="list-disc pl-lg text-body-md text-on-surface-variant flex flex-col gap-xs">
              <li><strong className="text-on-surface">Account data</strong> — email, name, and authentication identifiers, including from OAuth providers (Google, GitHub, LinkedIn) if you sign in that way.</li>
              <li><strong className="text-on-surface">Resume and profile content</strong> — work history, education, skills, and any resume file you upload or type in.</li>
              <li><strong className="text-on-surface">Job descriptions</strong> you paste in for analysis and tailoring.</li>
              <li><strong className="text-on-surface">Networking data</strong> — your professional profile and connections if you use the Networking feature.</li>
              <li><strong className="text-on-surface">Usage data</strong> — basic technical logs (timestamps, error events) needed to operate and secure the service.</li>
            </ul>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">How we use it</h2>
            <p className="text-body-md text-on-surface-variant">
              We use your data to provide the core features you request: generating and tailoring resume
              content, computing ATS compatibility scores, and generating interview preparation questions.
              To do this, resume and job-description text you submit is sent to a third-party AI model
              provider (OpenAI or Google Gemini, depending on configuration) solely to generate that
              response — it is not used by us to train models, and is subject to that provider&apos;s own
              data-handling terms.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">Where it&apos;s stored</h2>
            <p className="text-body-md text-on-surface-variant">
              Account and application data is stored with Supabase (PostgreSQL). Generated PDF exports are
              stored in Supabase Storage. Data is encrypted in transit.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">Your rights</h2>
            <p className="text-body-md text-on-surface-variant">
              You can access, edit, or delete your resumes, profile, and job descriptions at any time from
              within the app. To request full account deletion or export, contact us at{" "}
              <a href="mailto:[Contact Email]" className="text-primary hover:underline">[Contact Email]</a>.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">Cookies</h2>
            <p className="text-body-md text-on-surface-variant">
              We use essential cookies for authentication (session management via Supabase Auth). We do not
              use third-party advertising or tracking cookies.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">Contact</h2>
            <p className="text-body-md text-on-surface-variant">
              Questions about this policy: <a href="mailto:[Contact Email]" className="text-primary hover:underline">[Contact Email]</a>.
              This service is operated by [Legal Entity Name], [Jurisdiction].
            </p>
          </section>
        </article>
      </main>
    </div>
  );
}

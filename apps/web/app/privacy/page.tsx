import Link from "next/link";
import { RocketLaunch } from "@phosphor-icons/react/dist/ssr";

const LAST_UPDATED = "September 13, 2026";
const ENTITY_NAME = "Inframiq Solutions Private Limited";
const CONTACT_EMAIL = "support@inframiq.com";
const JURISDICTION = "Visakhapatnam, Andhra Pradesh, India";

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
            {ENTITY_NAME} (&quot;{ENTITY_NAME.split(" ")[0]}&quot;, &quot;we&quot;, &quot;us&quot;, or
            &quot;our&quot;) operates Career Copilot (the &quot;Service&quot;), an AI-assisted resume,
            job-description analysis, and interview preparation tool. This Privacy Policy explains what
            personal data we collect, why we collect it, how it is used, where it is stored, who we share it
            with, and the rights you have over it — wherever in the world you are using the Service from.
            By creating an account or otherwise using the Service, you acknowledge that you have read and
            understood this Policy.
          </p>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">1. Who we are and how to reach us</h2>
            <p className="text-body-md text-on-surface-variant">
              The Service is operated by {ENTITY_NAME}, a company registered in India. For any question,
              request, or complaint about this Policy or your personal data, contact us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>.
              We aim to acknowledge privacy requests within 7 days and to resolve them within the timeframe
              required by applicable law (see Section 7).
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">2. Information we collect</h2>
            <ul className="list-disc pl-lg text-body-md text-on-surface-variant flex flex-col gap-xs">
              <li>
                <strong className="text-on-surface">Account data</strong> — your name, email address, profile
                picture, and a unique account identifier, obtained from Google when you sign in with Google
                OAuth. Google Sign-In is the only way to create or access an account on the Service; we do
                not collect or store passwords.
              </li>
              <li>
                <strong className="text-on-surface">Resume and profile content</strong> — work history,
                education, skills, contact details, and any resume file or text you upload, type, or generate
                within the Service.
              </li>
              <li>
                <strong className="text-on-surface">Job descriptions</strong> you paste in for analysis,
                ATS scoring, or tailoring.
              </li>
              <li>
                <strong className="text-on-surface">Networking data</strong> — professional profile links
                (e.g. LinkedIn or GitHub URLs) and connection information you choose to enter if you use the
                Networking feature. These are optional fields you type in yourself, not data obtained from a
                third-party login.
              </li>
              <li>
                <strong className="text-on-surface">Plan and credit data</strong> — your subscription tier
                and remaining credit balance. If and when paid plans involve a card payment, that payment
                will be collected and processed directly by a PCI-compliant third-party payment processor;
                we do not store full card numbers on our servers.
              </li>
              <li>
                <strong className="text-on-surface">Usage and device data</strong> — IP address, browser
                type, device identifiers, pages visited, timestamps, and error/diagnostic logs, collected
                automatically to operate, secure, and troubleshoot the Service.
              </li>
              <li>
                <strong className="text-on-surface">Cookies and session identifiers</strong> — see Section 6.
              </li>
            </ul>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">3. How we use your information</h2>
            <p className="text-body-md text-on-surface-variant">We use personal data only for the following purposes:</p>
            <ul className="list-disc pl-lg text-body-md text-on-surface-variant flex flex-col gap-xs">
              <li>To create and authenticate your account and provide the core features you request —
                generating and tailoring resume content, computing ATS compatibility scores, generating cover
                letters, and generating interview preparation questions.</li>
              <li>To process payments, manage your subscription, and track credit usage.</li>
              <li>To operate, maintain, secure, and improve the Service, including diagnosing technical
                issues and preventing fraud or abuse.</li>
              <li>To communicate with you about your account, transactional notices, and — only with your
                consent where required by law — product updates.</li>
              <li>To comply with legal obligations and enforce our{" "}
                <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link>.</li>
            </ul>
            <p className="text-body-md text-on-surface-variant">
              We do not use your resume content, job descriptions, or personal data to serve advertising, and
              we do not sell personal data to third parties, in any form, for any consideration.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">4. AI processing and third-party subprocessors</h2>
            <p className="text-body-md text-on-surface-variant">
              To generate resume content, tailoring suggestions, ATS scores, and interview questions, the
              resume and job-description text you submit is sent to a third-party AI model provider —
              OpenAI or Google (Gemini), depending on which model is configured for your request — solely to
              generate that response. We have configured these providers, to the extent they offer the
              option, not to use API-submitted content to train their models. Each provider processes this
              data under its own privacy and data-processing terms, which we encourage you to review:
              OpenAI&apos;s and Google&apos;s respective privacy policies. We do not send Google OAuth
              account credentials to these AI providers — only the resume/job-description text you actively
              submit for a given feature.
            </p>
            <p className="text-body-md text-on-surface-variant">
              Other subprocessors that may handle personal data on our behalf, each bound by a data
              processing agreement and used solely to provide the Service: our cloud database and file
              storage provider (Supabase), a PCI-compliant payment processor (used only for paid-plan
              transactions, if and when they occur), and standard cloud infrastructure/hosting providers. We
              do not permit any subprocessor to use your data for its own purposes.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">5. Where data is stored and how it is protected</h2>
            <p className="text-body-md text-on-surface-variant">
              Account and application data is stored with Supabase (PostgreSQL). Generated PDF exports and
              uploaded files are stored in Supabase Storage. Data may be processed and stored on servers
              located outside your country of residence, including in jurisdictions that may not offer the
              same level of data protection as your home jurisdiction; where required (for example, for
              transfers of personal data originating in the EEA, UK, or Switzerland), we rely on Standard
              Contractual Clauses or an equivalent legally recognized transfer mechanism with our
              subprocessors. Data is encrypted in transit (TLS) and at rest. Access to production data is
              restricted to authorized personnel on a need-to-know basis. No method of transmission or
              storage is 100% secure, and we cannot guarantee absolute security, but we maintain reasonable
              administrative, technical, and physical safeguards appropriate to the sensitivity of the data.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">6. Cookies and similar technologies</h2>
            <p className="text-body-md text-on-surface-variant">
              We use only strictly necessary cookies/local storage — for authentication and session
              management via Google OAuth / Supabase Auth, and to remember basic preferences (such as
              theme). These are essential to the Service functioning and are not subject to opt-out consent
              requirements under GDPR/ePrivacy or similar laws. We do not use third-party advertising,
              cross-site tracking, or analytics cookies. If this changes in the future, we will update this
              Policy and, where required, request your consent before deploying such technologies.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">7. Your rights</h2>
            <p className="text-body-md text-on-surface-variant">
              You can access, edit, or delete your resumes, profile, and job descriptions at any time from
              within the app, and you can permanently delete your account and all associated data from the
              Account page at any time — this takes effect immediately and cannot be undone. Depending on
              where you live, you may also have the following rights over your personal data, which you can
              exercise by contacting <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>:
            </p>
            <ul className="list-disc pl-lg text-body-md text-on-surface-variant flex flex-col gap-xs">
              <li>
                <strong className="text-on-surface">European Economic Area, UK, and Switzerland (GDPR/UK GDPR)</strong> —
                the right to access, rectify, erase, restrict, or object to processing of your data; the
                right to data portability; the right to withdraw consent at any time where processing is
                based on consent; and the right to lodge a complaint with your local data protection
                supervisory authority. Where we rely on legitimate interests to process your data (e.g. to
                secure the Service), you may object at any time.
              </li>
              <li>
                <strong className="text-on-surface">California and other U.S. states (CCPA/CPRA and similar
                state laws)</strong> — the right to know what personal information we collect and how it is
                used; the right to request deletion; the right to correct inaccurate information; and the
                right to opt out of the &quot;sale&quot; or &quot;sharing&quot; of personal information. We
                do not sell or share personal information as those terms are defined under CCPA/CPRA, so no
                opt-out mechanism is required, and we will not discriminate against you for exercising any
                right under this Policy.
              </li>
              <li>
                <strong className="text-on-surface">India (Digital Personal Data Protection Act, 2023)</strong> —
                the right to access a summary of your personal data and processing activities, the right to
                correction and erasure, and the right to grievance redressal, including the right to contact
                our Grievance Officer (see Section 11).
              </li>
              <li>
                <strong className="text-on-surface">All other jurisdictions</strong> — we extend the same
                core rights (access, correction, deletion, and objection) to all users of the Service
                regardless of location, to the extent technically and legally feasible.
              </li>
            </ul>
            <p className="text-body-md text-on-surface-variant">
              We will verify your identity (via your authenticated Google account or other reasonable means)
              before fulfilling any data request, to prevent unauthorized access to your data.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">8. Data retention</h2>
            <p className="text-body-md text-on-surface-variant">
              We retain your personal data for as long as your account is active, plus a limited period
              afterward as needed to comply with legal, tax, or accounting obligations, resolve disputes, and
              enforce our agreements. When you delete your account, your resumes, profile, job descriptions,
              generated content, and account identifiers are permanently deleted from our production
              database immediately; residual copies in encrypted backups are purged on our routine backup
              rotation cycle (no longer than 90 days). Anonymized or aggregated data that can no longer be
              linked to you may be retained indefinitely for analytics purposes.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">9. Children&apos;s privacy</h2>
            <p className="text-body-md text-on-surface-variant">
              The Service is not directed to, and we do not knowingly collect personal data from, children
              under the age of 16 (or the higher minimum age required by applicable local law). If you
              believe a child has provided us with personal data, contact us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>{" "}
              and we will delete it promptly.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">10. Data breach notification</h2>
            <p className="text-body-md text-on-surface-variant">
              In the event of a security incident that results in unauthorized access to your personal data
              and creates a risk to your rights, we will notify affected users and, where legally required,
              the relevant supervisory authority, without undue delay and in line with applicable law.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">11. Grievance Officer (India)</h2>
            <p className="text-body-md text-on-surface-variant">
              In accordance with Indian law, grievances regarding this Policy or the handling of your
              personal data may be addressed to our Grievance Officer at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>.
              We will acknowledge grievances within 24 hours and aim to resolve them within 15 days.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">12. Changes to this Policy</h2>
            <p className="text-body-md text-on-surface-variant">
              We may update this Policy from time to time to reflect changes in our practices or for legal,
              operational, or regulatory reasons. We will post the updated Policy on this page with a revised
              &quot;Last updated&quot; date, and for material changes we will provide additional notice (such
              as an in-app notification or email) before the change takes effect. Continued use of the
              Service after a change takes effect constitutes acceptance of the updated Policy.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">13. Contact and governing law</h2>
            <p className="text-body-md text-on-surface-variant">
              This Service is operated by {ENTITY_NAME}. Questions, requests, or complaints about this
              Policy can be sent to{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>.
              This Policy is governed by the laws of India, without prejudice to any mandatory data
              protection rights you may have under the law of your own country of residence, as described in
              Section 7. See our{" "}
              <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link>{" "}
              for the jurisdiction and dispute-resolution terms ({JURISDICTION}) that apply to your use of
              the Service more broadly.
            </p>
          </section>
        </article>
      </main>
    </div>
  );
}

import Link from "next/link";
import { RocketLaunch } from "@phosphor-icons/react/dist/ssr";

const LAST_UPDATED = "September 13, 2026";
const ENTITY_NAME = "Inframiq Solutions Private Limited";
const CONTACT_EMAIL = "support@inframiq.com";
const JURISDICTION = "Visakhapatnam, Andhra Pradesh, India";

export const metadata = {
  title: "Privacy Policy",
  description: "How Career Copilot collects, uses, and protects your personal data.",
  robots: { index: false, follow: true },
};

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
            job-description analysis, and interview preparation tool for individual job seekers. Career
            Copilot is a self-service tool: you use it to build and improve your own resume, and there is no
            employer-, recruiter-, or agency-facing product that screens, ranks, or scores you for a third
            party. This Privacy Policy explains what personal data we collect, why, how it is used, where it
            is stored, who we share it with, and the rights you have over it — wherever in the world you are
            using the Service from. It also serves as our Notice at Collection for California residents (see
            Section 10). By creating an account or otherwise using the Service, you acknowledge that you have
            read and understood this Policy.
          </p>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">1. Who we are and how to reach us</h2>
            <p className="text-body-md text-on-surface-variant">
              The Service is operated by {ENTITY_NAME}, a company registered in India. For any question,
              request, or complaint about this Policy or your personal data, contact us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>.
              We aim to acknowledge privacy requests within 7 days and to resolve them within the timeframe
              required by applicable law (see Section 9).
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">2. Information we collect</h2>
            <p className="text-body-md text-on-surface-variant">This is a complete inventory of the personal data the Service collects or generates about you:</p>
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
                within the Service. Resumes commonly contain your address, phone number, and photo if you
                choose to include them — these are optional and provided entirely at your discretion; we do
                not require or request sensitive personal data (such as health, religious, or biometric
                information) and ask that you avoid including it in resume content unless it is something you
                specifically intend to share as part of your own document.
              </li>
              <li>
                <strong className="text-on-surface">Job descriptions</strong> you paste in for analysis,
                ATS scoring, or tailoring.
              </li>
              <li>
                <strong className="text-on-surface">AI prompts, outputs, and generation history</strong> — the
                text sent to an AI provider for a given feature and the content it returns (tailored resume
                text, cover letters, interview questions, ATS scores), which we store so you can view and
                reuse your past results within the Service.
              </li>
              <li>
                <strong className="text-on-surface">Networking data</strong> — professional profile links
                (e.g. LinkedIn or GitHub URLs) and connection information you choose to enter if you use the
                Networking feature. These are optional fields you type in yourself, not data obtained from a
                third-party login or by us visiting those profiles on your behalf.
              </li>
              <li>
                <strong className="text-on-surface">Plan and credit data</strong> — your subscription tier
                and remaining credit balance. If and when paid plans involve a card payment, the payment
                itself is collected and processed directly by a PCI-compliant third-party payment processor;
                we store a transaction reference and the plan/amount, not your full card number.
              </li>
              <li>
                <strong className="text-on-surface">Support communications</strong> — anything you send us at{" "}
                {CONTACT_EMAIL} or through an in-app feedback form, including your email address and the
                content of your message.
              </li>
              <li>
                <strong className="text-on-surface">Usage and device data</strong> — IP address, browser
                type, device identifiers, pages visited, timestamps, and error/diagnostic logs, collected
                automatically to operate, secure, and troubleshoot the Service. Authentication events (sign-in
                and sign-out) are logged for security purposes for a limited period as described in Section 8.
              </li>
              <li>
                <strong className="text-on-surface">Cookies and local storage</strong> — see Section 7.
              </li>
            </ul>
            <p className="text-body-md text-on-surface-variant">
              Nearly all of this data comes directly from you or is generated by your use of the Service.
              The one exception is Account data, which we receive from Google when you sign in — we do not
              obtain personal data about you from any other third-party source, data broker, or public
              scraping.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">3. How we use your information, and our legal basis for doing so</h2>
            <p className="text-body-md text-on-surface-variant">
              We use personal data only for the purposes below. For users in the EEA, UK, or Switzerland, each
              purpose is matched to the legal basis we rely on under GDPR/UK GDPR:
            </p>
            <ul className="list-disc pl-lg text-body-md text-on-surface-variant flex flex-col gap-xs">
              <li>
                <strong className="text-on-surface">Providing the Service you asked for</strong> — creating
                and authenticating your account, generating and tailoring resume content, computing ATS
                scores, generating cover letters and interview questions, and storing your generation
                history so you can access it later. <em>Legal basis: performance of a contract with you</em> (our Terms of Service).
              </li>
              <li>
                <strong className="text-on-surface">Payments and subscriptions</strong> — processing payments,
                managing your plan, and tracking credit usage. <em>Legal basis: performance of a contract</em>, and compliance with tax/accounting obligations.
              </li>
              <li>
                <strong className="text-on-surface">Fraud prevention and security</strong> — detecting abuse
                (e.g. credential stuffing, credit-limit circumvention) and maintaining authentication logs. <em>Legal basis: our legitimate interest</em> in keeping the Service and its users safe from fraud and
                abuse. We have weighed this against your privacy interest by limiting this processing to
                security-relevant metadata (Section 8), not resume or job-description content, and you may
                object to this processing at any time (Section 9), though we may need to weigh an objection
                against our ability to keep the Service secure.
              </li>
              <li>
                <strong className="text-on-surface">Essential account, billing, and security notices</strong> —
                messages you need to receive to use the Service (e.g. sign-in alerts, payment receipts,
                policy changes). <em>Legal basis: performance of a contract</em> — these are not optional and
                are not marketing, so there is no separate opt-out for them short of closing your account.
              </li>
              <li>
                <strong className="text-on-surface">Optional product updates or marketing</strong> — sent only
                if you opt in. <em>Legal basis: consent.</em> You can withdraw consent at any time via the
                unsubscribe link in any such message or by emailing{" "}
                {CONTACT_EMAIL}; withdrawing stops future messages but does not affect the lawfulness of
                anything already sent while consent was in effect.
              </li>
              <li>
                <strong className="text-on-surface">Legal compliance and enforcement</strong> — retaining
                payment/tax records (Section 8), responding to lawful requests from courts or regulators, and
                enforcing our{" "}
                <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link>{" "}
                against violations such as abuse of credit limits or unlawful content. <em>Legal basis: legal
                obligation</em> for regulatory/tax retention specifically, and <em>legitimate interest</em>{" "}
                for Terms enforcement more broadly.
              </li>
            </ul>
            <p className="text-body-md text-on-surface-variant">
              We do not use your resume content, job descriptions, or personal data to serve advertising, and
              we do not sell personal data to third parties, in any form, for any consideration.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">4. Automated processing and AI-generated content</h2>
            <p className="text-body-md text-on-surface-variant">
              Career Copilot uses AI to generate suggestions — tailored resume text, cover letters, ATS
              compatibility scores, and interview questions. This processing is <strong className="text-on-surface">advisory only</strong>: it acts on your own resume, at your own request, and you decide whether to use,
              edit, or discard any output. No employer, recruiter, or other third party uses Career Copilot to
              screen, rank, or evaluate you — there is no feature through which anyone other than you receives
              or acts on this output. An ATS compatibility score is an estimate intended to help you improve
              your resume; it does not guarantee acceptance by any real applicant tracking system, which we do
              not control. We describe this so you can assess for yourself, or with your own advisor, how
              automated-decision-making rules under GDPR, the DPDP Act, or other applicable law apply to your
              specific situation — we do not make that determination for you in this Policy.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">5. AI providers and third-party subprocessors</h2>
            <p className="text-body-md text-on-surface-variant">
              To generate resume content, tailoring suggestions, ATS scores, and interview questions, the
              resume and job-description text you submit for that specific action is sent to OpenAI, the
              single AI provider Career Copilot currently uses in production, solely to generate that
              response. Only the text relevant to the feature you triggered is sent (for example, a
              bullet-rewrite sends the bullet and job context, not your entire account); we do not send your
              Google account credentials, email, or payment data to OpenAI. We may add or switch to a
              different or additional AI provider (such as Google Gemini) in the future — if we do, we will
              update this section and our{" "}
              <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link> before the
              change takes effect, and, where it materially changes how your data is used, notify you as
              described in Section 14.
            </p>
            <p className="text-body-md text-on-surface-variant">
              We access OpenAI through its standard commercial API, under OpenAI&apos;s published API terms,
              which state that API-submitted content is not used to train its general models by default. We
              have not independently negotiated a separate data-processing agreement with OpenAI beyond its
              standard API terms, and OpenAI may retain prompts and outputs for a limited period for abuse
              and safety monitoring under its own policies — we do not control that retention and encourage
              you to review OpenAI&apos;s own privacy and API data-usage terms directly.
            </p>
            <p className="text-body-md text-on-surface-variant">
              Other subprocessors that handle personal data on our behalf, used solely to provide the
              Service: our cloud database and file storage provider (Supabase), a PCI-compliant payment
              processor (used only for paid-plan transactions), and our cloud hosting provider. We do not
              permit any subprocessor to use your data for its own purposes, and we take reasonable
              contractual steps with each of them to protect your data, consistent with their standard terms
              of service.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">6. Our role: controller or processor</h2>
            <p className="text-body-md text-on-surface-variant">
              For the personal data described in this Policy — your account, resume, and usage data — we act
              as the <strong className="text-on-surface">data controller</strong> (or &quot;data
              fiduciary&quot; under Indian law): we decide why and how that data is processed. We are not
              acting as a processor on behalf of any employer, recruiter, or other organization, because no
              such organization uses the Service to process your data. Our AI and hosting subprocessors act
              as <strong className="text-on-surface">processors</strong> on our behalf, strictly for the
              purposes described in Section 5.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">7. Cookies and local storage</h2>
            <p className="text-body-md text-on-surface-variant">
              We use only the following storage technologies, all strictly necessary for the Service to
              function — none are used for advertising, cross-site tracking, or analytics profiling:
            </p>
            <ul className="list-disc pl-lg text-body-md text-on-surface-variant flex flex-col gap-xs">
              <li><strong className="text-on-surface">Supabase Auth session cookies</strong> — keep you
                signed in after Google authentication; expire on sign-out or session refresh per Supabase&apos;s
                default session lifetime.</li>
              <li><strong className="text-on-surface">Local storage: onboarding state</strong> (
                <code>career-copilot-onboarding-dismissed</code>) — remembers that you dismissed the
                onboarding prompt; persists until you clear browser storage.</li>
              <li><strong className="text-on-surface">Local storage: career-path draft</strong> (
                <code>career-copilot-target-role</code>) — remembers your in-progress target-role input on the
                Career Path page; persists until you clear browser storage.</li>
            </ul>
            <p className="text-body-md text-on-surface-variant">
              These are exempt from opt-out/consent requirements under GDPR&apos;s ePrivacy rules and similar
              laws because they are strictly necessary. If we ever add non-essential cookies (analytics,
              advertising), we will update this section and request your consent first, where required.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">8. Where data is stored, retention periods, and security</h2>
            <p className="text-body-md text-on-surface-variant">
              Account and application data is stored with Supabase (PostgreSQL), in the cloud region
              configured for our project. Generated PDF exports and uploaded files are stored in
              Supabase Storage. Data may be processed and stored on servers located outside your country of
              residence; where required (for example, for transfers of personal data originating in the EEA,
              UK, or Switzerland), we rely on our subprocessors&apos; Standard Contractual Clauses or
              equivalent transfer mechanism with their own downstream infrastructure. Data is encrypted in
              transit (TLS) and at rest. Access to production data is restricted to authorized personnel on a
              need-to-know basis, gated by account-level access controls; we do not currently operate a
              dedicated 24/7 security-monitoring team or hold a third-party security certification (e.g.
              SOC 2, ISO 27001) — if you require that level of assurance before use, contact us before
              relying on the Service for sensitive data.
            </p>
            <p className="text-body-md text-on-surface-variant"><strong className="text-on-surface">Retention periods:</strong></p>
            <ul className="list-disc pl-lg text-body-md text-on-surface-variant flex flex-col gap-xs">
              <li>Account, resume, job-description, and AI generation history: retained while your account is
                active, and deleted on account deletion as described below.</li>
              <li>Authentication/security logs: retained for up to 90 days for abuse investigation, then
                deleted or anonymized.</li>
              <li>Payment/transaction records: retained for 8 years to meet Indian tax and accounting record-
                keeping obligations, even after account deletion.</li>
              <li>Support communications: retained for up to 24 months after your last contact, then deleted
                or anonymized.</li>
              <li>Encrypted database backups: rolled over on a cycle of no more than 90 days.</li>
            </ul>
            <p className="text-body-md text-on-surface-variant">
              When you delete your account, we remove your resumes, profile, job descriptions, generated
              content, and account identifiers from our active production database immediately, and this
              action cannot be undone from your side. &quot;Immediately&quot; means removal from the live
              database that powers the Service — it does not mean your data is instantaneously erased from
              every layer of infrastructure: residual copies may persist in encrypted backups until they age
              out (up to 90 days), and copies already sent to an AI provider before your deletion request are
              subject to that provider&apos;s own retention window (Section 5), which we do not control.
              Payment records are retained per the schedule above regardless of account deletion, as required
              by law.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">9. Your rights</h2>
            <p className="text-body-md text-on-surface-variant">
              You can access, edit, or delete your resumes, profile, and job descriptions at any time from
              within the app, and delete your account from the Account page (see Section 8 for what that does
              and does not immediately erase). Depending on where you live, you may also have the following
              rights, which you can exercise by contacting{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>{" "}
              — please tell us which right you are exercising and the email address on your account; we will
              verify your identity via your authenticated Google account before acting on the request, and
              will let you know if we need more information or if an exception applies:
            </p>
            <ul className="list-disc pl-lg text-body-md text-on-surface-variant flex flex-col gap-xs">
              <li>
                <strong className="text-on-surface">European Economic Area, UK, and Switzerland (GDPR/UK GDPR)</strong> —
                access, rectification, erasure, restriction, and objection to processing; data portability;
                withdrawal of consent at any time where processing is based on consent; and the right to
                lodge a complaint with your local data protection supervisory authority. We aim to respond
                within 30 days, extendable by a further 60 days for complex requests, as GDPR permits.
              </li>
              <li>
                <strong className="text-on-surface">California and other U.S. states (CCPA/CPRA and similar
                state laws)</strong> — the right to know what personal information we collect and how it is
                used (see Section 2 for categories, Section 8 for retention); the right to request deletion;
                the right to correct inaccurate information; and the right to opt out of the &quot;sale&quot;
                or &quot;sharing&quot; of personal information. We do not sell or share personal information
                as those terms are defined under CCPA/CPRA, so no opt-out mechanism is required, and we will
                not discriminate against you for exercising any right under this Policy. We aim to respond
                within 45 days, extendable once by a further 45 days.
              </li>
              <li>
                <strong className="text-on-surface">India (Digital Personal Data Protection Act, 2023)</strong> —
                the right to a summary of your personal data and processing activities, the right to
                correction, updating, and erasure, and the right to grievance redressal, including contacting
                our grievance contact (Section 13).
              </li>
              <li>
                <strong className="text-on-surface">All other jurisdictions</strong> — we extend the same
                core rights (access, correction, deletion, and objection) to all users of the Service
                regardless of location, to the extent technically and legally feasible, and will aim to
                respond within 30 days.
              </li>
            </ul>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">10. Age requirement and children&apos;s privacy</h2>
            <p className="text-body-md text-on-surface-variant">
              The Service is intended solely for users who are at least 18 years old, worldwide — including
              in India, where the Digital Personal Data Protection Act, 2023 defines a &quot;child&quot; as
              anyone under 18. We do not offer a parental-consent mechanism, so if you are under 18 you are
              not permitted to create an account or use the Service. Account creation relies on your Google
              account&apos;s own age standing — we do not perform independent, separate age verification
              beyond that. If we learn that we have collected personal data from someone under 18, we will
              delete the associated account and data promptly. If you believe this has happened, contact us
              at <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">11. Data breach notification</h2>
            <p className="text-body-md text-on-surface-variant">
              In the event of a security incident that results in unauthorized access to your personal data
              and creates a risk to your rights, we will assess the scope and severity of the incident, take
              reasonable steps to contain it, and notify affected users and, where legally required, the
              relevant supervisory authority (such as under GDPR&apos;s 72-hour rule where applicable, or as
              required under the DPDP Act and its rules), without undue delay.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">12. EU/UK representative</h2>
            <p className="text-body-md text-on-surface-variant">
              We have not currently appointed a representative in the European Union or United Kingdom under
              GDPR Article 27 / UK GDPR. We will appoint one, and update this section with their contact
              details, before we actively market the Service to, or process data at scale from, users in the
              EU/UK on an ongoing basis. Until then, EU/UK users can reach us directly using the contact
              details in Section 1.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">13. Grievance contact (India)</h2>
            <p className="text-body-md text-on-surface-variant">
              We have not yet formally designated a named Grievance Officer with the title and contact
              particulars that Indian law expects to be published. Until we do, grievances regarding this
              Policy or the handling of your personal data can be sent to{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>,
              which is monitored by {ENTITY_NAME}. We aim to acknowledge grievances within 24 hours and
              resolve them within 15 days, and we will update this section with a named officer&apos;s details
              as our operations formalize.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">14. Changes to this Policy</h2>
            <p className="text-body-md text-on-surface-variant">
              We may update this Policy from time to time to reflect changes in our practices or for legal,
              operational, or regulatory reasons. We will post the updated Policy on this page with a revised
              &quot;Last updated&quot; date, and for material changes we will provide additional notice (such
              as an in-app notification or email) before the change takes effect. Where a change requires
              your consent under applicable law, we will ask for it rather than relying on continued use
              alone.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">15. Contact and governing law</h2>
            <p className="text-body-md text-on-surface-variant">
              This Service is operated by {ENTITY_NAME}. Questions, requests, or complaints about this
              Policy can be sent to{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>.
              This Policy is governed by the laws of India, without prejudice to any mandatory data
              protection rights you may have under the law of your own country of residence, as described in
              Section 9. See our{" "}
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

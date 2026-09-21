import Image from "next/image";
import Link from "next/link";
import { DeletionRequestForm } from "@/components/legal/DeletionRequestForm";

const LAST_UPDATED = "September 19, 2026";
const ENTITY_NAME = "Inframiq Solutions Private Limited";
const CONTACT_EMAIL = "support@inframiq.com";

export const metadata = {
  title: "Delete Your Data",
  description: "How to delete your KripaX account and data, or ask us to delete data about you.",
  robots: { index: false, follow: true },
};

export default function DataDeletionPage() {
  return (
    <div className="relative z-[1] min-h-screen flex flex-col">
      <nav className="flex items-center justify-between px-gutter py-lg max-w-[1440px] mx-auto w-full">
        <Link href="/" aria-label="KripaX home" className="flex shrink-0 items-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <Image src="/brand/logo-wordmark.png" alt="KripaX" width={128} height={28} priority />
        </Link>
        <Link href="/" className="text-label-md text-on-surface-variant hover:text-on-surface transition-colors">
          Back to home
        </Link>
      </nav>

      <main className="flex-1 px-gutter py-xxl">
        <article className="max-w-[720px] mx-auto flex flex-col gap-lg">
          <div>
            <h1 className="text-headline-xl text-on-surface mb-sm">Delete your data</h1>
            <p className="text-body-sm text-on-surface-variant">Last updated: {LAST_UPDATED}</p>
          </div>

          <p className="text-body-md text-on-surface-variant">
            You can have your personal data deleted from KripaX at any time. If you can sign in, you can do it
            yourself in a few seconds. If you can&apos;t, or you never had an account, send us a request below.
            This page describes how {ENTITY_NAME} handles deletion under our{" "}
            <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
          </p>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">1. If you can sign in</h2>
            <p className="text-body-md text-on-surface-variant">
              Go to <Link href="/account" className="text-primary hover:underline">Account</Link> and choose{" "}
              <strong className="text-on-surface">Delete account</strong>. Your account and everything in it is
              deleted straight away. You can also delete a single resume, job description, or cover letter from
              the page where it appears, without closing your account.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">
              2. If you can&apos;t sign in, or you don&apos;t use KripaX
            </h2>
            <p className="text-body-md text-on-surface-variant">
              Use this form if you&apos;ve lost access to the Google account you signed in with, or if you think a
              KripaX user entered your details, for example as a contact. You can also email{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>{" "}
              with the same information.
            </p>
            <DeletionRequestForm />
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">3. What happens next</h2>
            <ul className="list-disc pl-lg text-body-md text-on-surface-variant flex flex-col gap-xs">
              <li>
                Within 7 days, we email you from {CONTACT_EMAIL} to confirm the request came from you. Anyone can
                fill in this form, so we delete nothing until you reply from the address you gave. We will never
                ask for your password.
              </li>
              <li>
                Within 30 days of your confirmation, we delete the data and email you to say it&apos;s done. If
                the law gives you a shorter deadline, we meet that one.
              </li>
              <li>
                If we can&apos;t delete something, for example because the law requires us to keep it, we tell you
                what and why.
              </li>
            </ul>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">4. What is deleted, and what we keep</h2>
            <p className="text-body-md text-on-surface-variant">
              Deleting an account removes your profile, resumes, uploaded files and photos, job descriptions,
              cover letters, interview preparation, contacts, feedback, and generated content. We keep only:
            </p>
            <ul className="list-disc pl-lg text-body-md text-on-surface-variant flex flex-col gap-xs">
              <li>
                <strong className="text-on-surface">Payment records</strong>, for 8 years, because Indian tax and
                accounting law requires it.
              </li>
              <li>
                <strong className="text-on-surface">Encrypted backups</strong>, which roll over within 90 days, after
                which no copy remains.
              </li>
              <li>
                <strong className="text-on-surface">A record of your request</strong>: the email address, what you
                asked for, and what we did. We keep it for 3 years to show that we handled it. It doesn&apos;t
                contain the data we deleted.
              </li>
            </ul>
            <p className="text-body-md text-on-surface-variant">
              Text already sent to our AI provider before the deletion may be kept by that provider for a limited
              time under its own policies, as described in Section 5 of the Privacy Policy.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">5. Your other rights</h2>
            <p className="text-body-md text-on-surface-variant">
              You can also ask for a copy of your data, or for it to be corrected. Email{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>. If
              you&apos;re not satisfied with how we handled your request, you can raise a grievance at the same
              address (see Section 13 of the Privacy Policy), or complain to the data protection authority where
              you live.
            </p>
          </section>
        </article>
      </main>
    </div>
  );
}

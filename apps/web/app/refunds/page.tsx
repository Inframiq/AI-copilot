import Image from "next/image";
import Link from "next/link";

const LAST_UPDATED = "September 19, 2026";
const ENTITY_NAME = "Inframiq Solutions Private Limited";
const CONTACT_EMAIL = "support@inframiq.com";

export const metadata = {
  title: "Refund Policy",
  description: "When KripaX refunds a payment, how to ask for one, and how long it takes.",
  robots: { index: false, follow: true },
};

export default function RefundPolicyPage() {
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
            <h1 className="text-headline-xl text-on-surface mb-sm">Refund and Cancellation Policy</h1>
            <p className="text-body-sm text-on-surface-variant">Last updated: {LAST_UPDATED}</p>
          </div>

          <p className="text-body-md text-on-surface-variant">
            This policy explains when {ENTITY_NAME} (&quot;we&quot;, &quot;us&quot;) refunds a payment for
            KripaX (the &quot;Service&quot;), how to cancel a paid plan, and how long a refund takes. It
            forms part of our{" "}
            <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link> and expands
            on Section 5 of them. If anything shown to you at checkout differs from this policy, what was shown
            at checkout applies to that purchase.
          </p>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">1. Paid plans are not on sale yet</h2>
            <p className="text-body-md text-on-surface-variant">
              KripaX is currently free to use. The Premium plan is listed on our Plans page, but it cannot be
              bought yet, and we do not take payment from anyone. This policy is published now so the terms
              are known before the first charge. It will apply to every payment once paid plans open.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">2. What you pay for</h2>
            <ul className="list-disc pl-lg text-body-md text-on-surface-variant flex flex-col gap-xs">
              <li>
                <strong className="text-on-surface">Free plan</strong> — no charge. It comes with a one-time
                allowance of credits, so there is nothing to refund.
              </li>
              <li>
                <strong className="text-on-surface">Premium plan</strong> — a subscription billed in advance
                for each 30-day period at the price shown at checkout. Each period comes with a fresh allowance
                of credits. Credits you don&apos;t use expire at the end of the period and do not carry over.
                Credits have no cash value.
              </li>
            </ul>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">3. Cancelling</h2>
            <p className="text-body-md text-on-surface-variant">
              You can cancel Premium at any time by emailing{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>{" "}
              from the address on your account, or through in-app cancellation once it is available. When you
              cancel:
            </p>
            <ul className="list-disc pl-lg text-body-md text-on-surface-variant flex flex-col gap-xs">
              <li>You will not be charged again.</li>
              <li>
                You keep Premium, and whatever credits remain, until the end of the period you have already
                paid for. Your account then moves to the Free plan.
              </li>
              <li>Your resumes, profile, and other content stay in your account. Cancelling deletes nothing.</li>
            </ul>
            <p className="text-body-md text-on-surface-variant">
              Cancelling does not by itself refund the current period. See Section 4 for when we do refund.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">4. When we refund</h2>
            <p className="text-body-md text-on-surface-variant">
              <strong className="text-on-surface">7-day money-back guarantee.</strong> If Premium isn&apos;t
              right for you, ask for a refund within 7 days of your first Premium payment and we will refund
              it in full. You don&apos;t need to give a reason. This applies once per account, to the first
              Premium payment only, and not to renewals. When we refund it, your account moves back to the
              Free plan straight away and any Premium credits left are removed.
            </p>
            <p className="text-body-md text-on-surface-variant">
              We also refund the full amount of a charge in these cases:
            </p>
            <ul className="list-disc pl-lg text-body-md text-on-surface-variant flex flex-col gap-xs">
              <li>
                <strong className="text-on-surface">Duplicate charge</strong> — you were charged more than
                once for the same period.
              </li>
              <li>
                <strong className="text-on-surface">Charge after cancelling</strong> — you were charged for a
                new period after your cancellation took effect.
              </li>
              <li>
                <strong className="text-on-surface">Billing error</strong> — you were charged a different
                amount from the one shown at checkout, or charged for a plan you did not choose.
              </li>
              <li>
                <strong className="text-on-surface">Unauthorised charge</strong> — someone used your payment
                method without your permission. Please also tell your bank or card issuer.
              </li>
            </ul>
            <p className="text-body-md text-on-surface-variant">
              We refund part of a charge, in proportion to the unused days of the period, in these cases:
            </p>
            <ul className="list-disc pl-lg text-body-md text-on-surface-variant flex flex-col gap-xs">
              <li>
                <strong className="text-on-surface">We could not provide the Service</strong> — paid features
                were unavailable because of a fault on our side for a substantial part of your period.
              </li>
              <li>
                <strong className="text-on-surface">We closed your account or ended the plan</strong> — for
                any reason other than your breach of the Terms of Service, as Section 6 of the Terms sets out.
              </li>
            </ul>
            <p className="text-body-md text-on-surface-variant">
              Outside these cases, payments are non-refundable. That includes renewals, a period you have
              started but not fully used, unused credits, and a change of mind after the 7-day money-back
              window has passed. Nothing in this policy limits
              a right to a refund, cancellation, or withdrawal that the consumer-protection law of your country
              gives you and that cannot be waived. Where such a right applies, we will honour it.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">5. How to ask for a refund</h2>
            <p className="text-body-md text-on-surface-variant">
              Email{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>{" "}
              from the address on your account: within 7 days of your first Premium payment for the
              money-back guarantee, or within 30 days of the charge in any other case. Include the date and amount of
              the charge, the payment reference from your receipt if you have it, and why you are asking. We
              will reply within 3 business days to tell you whether the refund is approved, or to ask for
              anything else we need.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">6. How long a refund takes</h2>
            <p className="text-body-md text-on-surface-variant">
              We start an approved refund within 7 business days. It goes back to the payment method you paid
              with. We cannot send it anywhere else. Your bank or card issuer usually takes a further 5–10
              business days to show it on your statement. The refund is for the amount we received. We do not
              refund currency-conversion or other fees charged by your bank.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">7. Chargebacks</h2>
            <p className="text-body-md text-on-surface-variant">
              If you think a charge is wrong, please contact us first. Most problems can be fixed faster that
              way than through a dispute with your bank. If you open a chargeback, we may pause paid features
              on your account while it is resolved. This does not affect your right to dispute a charge with
              your bank.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">8. Changes to this policy</h2>
            <p className="text-body-md text-on-surface-variant">
              We may update this policy. The version in force when you paid applies to that payment. We will
              post changes on this page with a new &quot;Last updated&quot; date, and give you notice of
              material changes before your next renewal.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">9. Contact</h2>
            <p className="text-body-md text-on-surface-variant">
              Questions about a payment or this policy can be sent to{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>.
              The Service is operated by {ENTITY_NAME}.
            </p>
          </section>
        </article>
      </main>
    </div>
  );
}

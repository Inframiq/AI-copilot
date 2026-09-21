import Image from "next/image";
import Link from "next/link";

const LAST_UPDATED = "September 19, 2026";
const ENTITY_NAME = "Inframiq Solutions Private Limited";
const CONTACT_EMAIL = "support@inframiq.com";
const SEAT_CITY = "Visakhapatnam, Andhra Pradesh, India";

export const metadata = {
  title: "Terms of Service",
  description: "The terms governing your use of KripaX.",
  robots: { index: false, follow: true },
};

export default function TermsOfServicePage() {
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
            <h1 className="text-headline-xl text-on-surface mb-sm">Terms of Service</h1>
            <p className="text-body-sm text-on-surface-variant">Last updated: {LAST_UPDATED}</p>
          </div>

          <p className="text-body-md text-on-surface-variant">
            These Terms of Service (&quot;Terms&quot;) form a binding legal agreement between you and{" "}
            {ENTITY_NAME} (&quot;{ENTITY_NAME.split(" ")[0]}&quot;, &quot;we&quot;, &quot;us&quot;, or
            &quot;our&quot;) governing your access to and use of KripaX (the &quot;Service&quot;),
            wherever in the world you access it from. By creating an account, signing in with Google, or
            otherwise using the Service, you accept these Terms in full. If you do not agree, do not use the
            Service.
          </p>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">1. The Service</h2>
            <p className="text-body-md text-on-surface-variant">
              KripaX provides AI-assisted resume building, job-description analysis, ATS
              compatibility scoring, cover letter generation, and interview preparation. Outputs are
              currently generated using OpenAI&apos;s models; we may switch to or add other AI providers in
              the future, and will update this section and our{" "}
              <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link> if we do.
              Generated content is provided for informational purposes only. AI-generated
              content, including resume text, ATS scores, and interview questions, may be inaccurate,
              incomplete, or unsuitable for your specific circumstances. You are solely responsible for
              reviewing, editing, fact-checking, and verifying any generated content before relying on it,
              submitting it to an employer, or using it in any professional or legal context. The Service is
              not a substitute for professional career, legal, or employment advice, and does not guarantee
              any interview invitation, hiring decision, or job outcome.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">2. Eligibility and account access</h2>
            <p className="text-body-md text-on-surface-variant">
              You must be at least 18 years old to use the Service, worldwide — we do not offer a
              parental-consent mechanism for younger users. Accounts are created and accessed exclusively through Google
              Sign-In (OAuth) — we do not offer or support username/password accounts. You are responsible
              for maintaining the security of the Google account linked to your KripaX account, and
              for all activity that occurs under your account. You must provide accurate information and are
              solely responsible for the content you upload, submit, or generate. Notify us immediately at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>{" "}
              if you suspect unauthorized use of your account.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">3. Acceptable use</h2>
            <p className="text-body-md text-on-surface-variant">You agree not to:</p>
            <ul className="list-disc pl-lg text-body-md text-on-surface-variant flex flex-col gap-xs">
              <li>Upload, submit, or generate content you do not have the legal right to share, or that
                infringes any third party&apos;s intellectual property, privacy, or other rights;</li>
              <li>Use the Service to generate false, fraudulent, defamatory, or misleading content, including
                fabricated qualifications, credentials, or work history;</li>
              <li>Attempt to disrupt, overburden, reverse-engineer, scrape, or gain unauthorized access to
                the Service or its underlying systems, models, or infrastructure;</li>
              <li>Use the Service for any unlawful purpose, or in violation of any applicable local, national,
                or international law or regulation;</li>
              <li>Circumvent credit limits, rate limits, or access controls, or resell or sublicense access to
                the Service without our prior written consent.</li>
            </ul>
            <p className="text-body-md text-on-surface-variant">
              We may suspend or terminate accounts that violate this section, with or without notice, at our
              reasonable discretion.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">4. Your content and intellectual property</h2>
            <p className="text-body-md text-on-surface-variant">
              You retain all ownership rights in the resume content, job descriptions, and other material you
              submit to the Service (&quot;Your Content&quot;). By submitting Your Content, you grant us a
              limited, non-exclusive, worldwide license to host, process, and transmit Your Content solely
              as necessary to operate and provide the Service to you (including sending it to AI
              subprocessors as described in our{" "}
              <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>). This
              license ends when Your Content is deleted from the Service, subject to residual copies in
              backups being purged as described in Section 6 and our{" "}
              <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>. As between
              you and us, you own the output the Service generates for you (e.g. tailored resume text, cover
              letters) — under OpenAI&apos;s API terms as they stand today, output belongs to the user who
              requested it, and we pass that same ownership on to you, subject to the accuracy limitations in
              Section 1. If we change or add AI providers, we will confirm this ownership position still
              holds before making the change effective. The Service itself — including its software, design,
              branding, and underlying technology — is owned by {ENTITY_NAME} and its licensors and is
              protected by intellectual property laws. Nothing in these Terms grants you any right to our
              trademarks, logos, or branding.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">5. Plans, credits, and payment</h2>
            <p className="text-body-md text-on-surface-variant">
              Certain features consume credits allotted under your plan. We currently offer a free plan; if
              and when we introduce paid plans, the price, currency, billing cycle (e.g. monthly, one-time),
              renewal terms, and any credit-expiry rule for that plan will be shown to you and require your
              confirmation at checkout before you are charged — this section&apos;s general terms below apply
              once that happens, alongside whatever specific terms are shown at checkout, which control if
              the two conflict. Fees for paid plans are processed by a third-party payment processor. If a
              payment fails or is declined, your plan may be downgraded or your paid features paused until
              payment succeeds; we will notify you first where practical. Fees are non-refundable except
              where required by applicable law (including consumer-protection and cancellation-right law in
              your country of residence) or expressly stated at checkout. Unused credits do not entitle you
              to a cash refund unless required by law or stated at checkout. Our{" "}
              <Link href="/refunds" className="text-primary hover:underline">Refund and Cancellation Policy</Link>{" "}
              sets out how to cancel, the cases in which we do refund, and how long a refund takes.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">6. Termination</h2>
            <p className="text-body-md text-on-surface-variant">
              You may stop using the Service and delete your account at any time from the Account page. This
              removes your resumes, profile, job descriptions, generated content, and account identifiers
              from our active production systems immediately; it does not instantaneously erase every copy
              everywhere — residual copies may remain in encrypted backups for up to 90 days, and payment
              records are retained longer where required by law. The full timing and scope is set out in our{" "}
              <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>, which
              controls over any general statement in this section.
            </p>
            <p className="text-body-md text-on-surface-variant">
              We may suspend or terminate your access to the Service, in whole or in part, for violation of
              these Terms, suspected fraud or abuse, or legal or regulatory requirements — this may happen
              immediately and without advance notice where we reasonably believe urgent action is needed to
              protect the Service, other users, or comply with the law. For any other termination on our
              part — for example, discontinuing the Service or a plan — we will give you reasonable advance
              notice where practical, a reasonable opportunity to export Your Content first, and a way to
              reach us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>{" "}
              if you believe a suspension or termination was made in error. If we terminate your account for
              a reason other than your breach of these Terms while you have a prepaid, unused, non-expired
              credit or subscription balance, we will refund the unused portion on a pro-rata basis, unless
              applicable law provides for something different. Sections 1, 4 (as to rights already granted),
              7, 8, 9, 10, and 11 survive termination.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">7. Disclaimer of warranties</h2>
            <p className="text-body-md text-on-surface-variant">
              THE SERVICE, INCLUDING ALL AI-GENERATED CONTENT, IS PROVIDED &quot;AS IS&quot; AND &quot;AS
              AVAILABLE&quot;, WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY,
              INCLUDING WITHOUT LIMITATION WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
              NON-INFRINGEMENT, ACCURACY, OR UNINTERRUPTED AND ERROR-FREE OPERATION. WE DO NOT WARRANT THAT
              AI-GENERATED RESUME CONTENT, ATS SCORES, COVER LETTERS, OR INTERVIEW QUESTIONS ARE ACCURATE,
              COMPLETE, OR WILL LEAD TO ANY PARTICULAR EMPLOYMENT OUTCOME. YOU USE THE SERVICE AND RELY ON
              ITS OUTPUT ENTIRELY AT YOUR OWN RISK. NO ADVICE OR INFORMATION, WHETHER ORAL OR WRITTEN,
              OBTAINED FROM THE SERVICE CREATES ANY WARRANTY NOT EXPRESSLY STATED IN THESE TERMS.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">8. Limitation of liability</h2>
            <p className="text-body-md text-on-surface-variant">
              THIS SECTION LIMITS OUR LIABILITY WHERE THE LAW ALLOWS IT TO BE LIMITED — IT DOES NOT MAKE US
              IMMUNE FROM CLAIMS, AND WHERE A LIMIT BELOW WOULD BE UNENFORCEABLE OR UNFAIR UNDER MANDATORY
              LAW THAT APPLIES TO YOU (INCLUDING CONSUMER-PROTECTION LAW IN YOUR COUNTRY OF RESIDENCE, SUCH
              AS EU/UK RULES AGAINST UNFAIR TERMS IN CONSUMER CONTRACTS), THAT LIMIT DOES NOT APPLY TO YOU TO
              THAT EXTENT — THE REST OF THIS SECTION REMAINS IN EFFECT. SUBJECT TO THAT: TO THE FULLEST
              EXTENT PERMITTED BY APPLICABLE LAW, (A) {ENTITY_NAME.toUpperCase()} AND ITS OFFICERS,
              EMPLOYEES, AND AGENTS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL,
              EXEMPLARY, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, REVENUE, DATA, GOODWILL, OR EMPLOYMENT
              OPPORTUNITY, ARISING OUT OF OR RELATED TO YOUR USE OF, OR INABILITY TO USE, THE SERVICE,
              WHETHER BASED ON CONTRACT, TORT, NEGLIGENCE, STRICT LIABILITY, OR OTHERWISE, EVEN IF WE HAVE
              BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES; AND (B) OUR TOTAL AGGREGATE LIABILITY TO YOU
              FOR ALL CLAIMS ARISING OUT OF OR RELATING TO THE SERVICE OR THESE TERMS SHALL NOT EXCEED THE
              GREATER OF (I) THE AMOUNT YOU PAID US IN THE 12 MONTHS PRECEDING THE CLAIM, OR (II) 2,000
              INDIAN RUPEES (₹2,000). NOTHING IN THIS SECTION LIMITS LIABILITY THAT CANNOT LAWFULLY BE
              LIMITED, INCLUDING (WHERE APPLICABLE LAW SO PROVIDES) LIABILITY FOR DEATH, PERSONAL INJURY, OR
              FRAUD CAUSED BY OUR NEGLIGENCE OR WILLFUL MISCONDUCT.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">9. Indemnification</h2>
            <p className="text-body-md text-on-surface-variant">
              You agree to indemnify and hold harmless {ENTITY_NAME}, its officers, employees, and agents
              against third-party claims, liabilities, damages, and reasonable legal fees, to the extent
              arising from: (a) Your Content infringing a third party&apos;s intellectual property or other
              rights; (b) your fraud, or your unlawful or malicious conduct in using the Service; or (c) your
              material breach of Section 3 (Acceptable use). This obligation is proportionate to your own
              conduct and does not extend to any part of a claim caused by our own negligence, willful
              misconduct, or violation of law, or by a defect in the Service itself rather than in Your
              Content or your conduct. Where applicable consumer-protection law limits or prohibits an
              indemnity like this one for individual, non-commercial users, this section applies only to the
              extent that law permits.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">10. Governing law, arbitration, and class action waiver</h2>
            <p className="text-body-md text-on-surface-variant">
              These Terms, and any dispute arising out of or relating to them or the Service, are governed by
              the laws of India, without regard to conflict-of-law principles, regardless of your country of
              residence. Any dispute, controversy, or claim arising out of or relating to these Terms or the
              Service — including its formation, breach, or termination — shall first be attempted to be
              resolved through good-faith negotiation by writing to{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>.
              If not resolved within 30 days, the dispute shall be referred to and finally resolved by
              binding arbitration under the Arbitration and Conciliation Act, 1996 (India), conducted by a
              sole arbitrator, seated in and with the arbitration proceedings held in {SEAT_CITY}, in the
              English language. The courts at {SEAT_CITY} shall have exclusive jurisdiction over any matter
              not subject to arbitration (such as interim relief) or any challenge to an arbitral award.{" "}
              <strong className="text-on-surface">
                To the fullest extent permitted by law, you and {ENTITY_NAME} each agree that any proceedings
                will be conducted only on an individual basis and not in a class, consolidated, or
                representative action.
              </strong>{" "}
              Where mandatory consumer-protection or data-protection law in your country of residence gives
              you a non-waivable right to bring a claim in your local courts or before a local regulator or
              consumer forum (such as an EU/UK consumer or data protection claim, an Indian DPDP Act
              grievance, or — for consumers in India specifically — the right under the Consumer Protection
              Act, 2019 to approach a District, State, or National Consumer Disputes Redressal Commission
              notwithstanding this arbitration agreement), this section does not override that right. This
              arbitration and class-action-waiver clause is intended to apply as broadly as each
              jurisdiction&apos;s law allows, and no more broadly than that — if a court or regulator with
              authority over a given claim holds that this clause cannot validly apply to it, that finding
              affects only that claim and jurisdiction, and the rest of this section continues to apply to
              other claims and users.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">11. General</h2>
            <p className="text-body-md text-on-surface-variant">
              These Terms, together with our{" "}
              <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>, constitute
              the entire agreement between you and {ENTITY_NAME} regarding the Service. If any provision of
              these Terms is found unenforceable, that provision will be limited or eliminated to the minimum
              extent necessary, and the remaining provisions will remain in full force. Our failure to
              enforce any right or provision is not a waiver of that right or provision. You may not assign
              or transfer these Terms without our prior written consent; we may assign these Terms in
              connection with a merger, acquisition, or sale of assets. We may update these Terms from time
              to time; we will post the revised Terms here with an updated &quot;Last updated&quot; date. For
              a routine or clarifying change, continued use of the Service after the change takes effect
              constitutes your acceptance of the updated Terms. For a material change — including to
              pricing, the liability or indemnity sections, dispute resolution, or how we use your data — we
              will give you advance notice (in-app or by email) and ask you to affirmatively accept the
              updated Terms again before it takes effect for you; if you don&apos;t, your access may be
              limited to what the prior Terms cover until you do, or your account may be closed.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">12. Contact</h2>
            <p className="text-body-md text-on-surface-variant">
              Questions about these Terms: <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>.
              This Service is operated by {ENTITY_NAME}, {SEAT_CITY}.
            </p>
          </section>
        </article>
      </main>
    </div>
  );
}

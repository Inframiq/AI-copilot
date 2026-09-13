import Link from "next/link";
import { RocketLaunch } from "@phosphor-icons/react/dist/ssr";

const LAST_UPDATED = "September 13, 2026";
const ENTITY_NAME = "Inframiq Solutions Private Limited";
const CONTACT_EMAIL = "support@inframiq.com";
const SEAT_CITY = "Visakhapatnam, Andhra Pradesh, India";

export const metadata = { title: "Terms of Service — Career Copilot" };

export default function TermsOfServicePage() {
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
            <h1 className="text-headline-xl text-on-surface mb-sm">Terms of Service</h1>
            <p className="text-body-sm text-on-surface-variant">Last updated: {LAST_UPDATED}</p>
          </div>

          <p className="text-body-md text-on-surface-variant">
            These Terms of Service (&quot;Terms&quot;) form a binding legal agreement between you and{" "}
            {ENTITY_NAME} (&quot;{ENTITY_NAME.split(" ")[0]}&quot;, &quot;we&quot;, &quot;us&quot;, or
            &quot;our&quot;) governing your access to and use of Career Copilot (the &quot;Service&quot;),
            wherever in the world you access it from. By creating an account, signing in with Google, or
            otherwise using the Service, you accept these Terms in full. If you do not agree, do not use the
            Service.
          </p>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">1. The Service</h2>
            <p className="text-body-md text-on-surface-variant">
              Career Copilot provides AI-assisted resume building, job-description analysis, ATS
              compatibility scoring, cover letter generation, and interview preparation. Outputs are
              generated using third-party large language models (currently OpenAI and/or Google Gemini,
              depending on configuration) and are provided for informational purposes only. AI-generated
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
              You must be at least 16 years old, or the minimum age of digital consent in your jurisdiction if
              higher, to use the Service. Accounts are created and accessed exclusively through Google
              Sign-In (OAuth) — we do not offer or support username/password accounts. You are responsible
              for maintaining the security of the Google account linked to your Career Copilot account, and
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
              backups being purged on our routine cycle. As between you and us, you own the output the
              Service generates for you (e.g. tailored resume text, cover letters), subject to the
              limitations in Section 1 regarding accuracy and to any rights that may vest in third-party AI
              providers under their own terms. The Service itself — including its software, design,
              branding, and underlying technology — is owned by {ENTITY_NAME} and its licensors and is
              protected by intellectual property laws. Nothing in these Terms grants you any right to our
              trademarks, logos, or branding.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">5. Plans, credits, and payment</h2>
            <p className="text-body-md text-on-surface-variant">
              Certain features consume credits allotted under your plan. We may offer free and paid plans,
              change credit costs, or modify plan features at any time, with reasonable notice for material
              changes to paid plans. Fees for paid plans, where applicable, are processed by a third-party
              payment processor and are non-refundable except where required by applicable law or expressly
              stated at the time of purchase. Unused credits do not entitle you to a cash refund unless
              required by law.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">6. Termination</h2>
            <p className="text-body-md text-on-surface-variant">
              You may stop using the Service and delete your account at any time from the Account page,
              which permanently and immediately deletes your resumes, profile, job descriptions, generated
              content, and account data as described in our{" "}
              <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>. We may
              suspend or terminate your access to the Service, in whole or in part, at any time, with or
              without cause or notice, including for violation of these Terms, suspected fraud or abuse, or
              legal or regulatory requirements. Sections 1, 4 (as to rights already granted), 7, 8, 9, 10,
              and 11 survive termination.
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
              TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW: (A) {ENTITY_NAME.toUpperCase()} AND ITS
              OFFICERS, EMPLOYEES, AND AGENTS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
              CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, REVENUE, DATA, GOODWILL,
              OR EMPLOYMENT OPPORTUNITY, ARISING OUT OF OR RELATED TO YOUR USE OF, OR INABILITY TO USE, THE
              SERVICE, WHETHER BASED ON CONTRACT, TORT, NEGLIGENCE, STRICT LIABILITY, OR OTHERWISE, EVEN IF
              WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES; AND (B) OUR TOTAL AGGREGATE LIABILITY
              TO YOU FOR ALL CLAIMS ARISING OUT OF OR RELATING TO THE SERVICE OR THESE TERMS SHALL NOT EXCEED
              THE GREATER OF (I) THE AMOUNT YOU PAID US IN THE 12 MONTHS PRECEDING THE CLAIM, OR (II) 2,000
              INDIAN RUPEES (₹2,000). SOME JURISDICTIONS DO NOT ALLOW THE EXCLUSION OR LIMITATION OF CERTAIN
              DAMAGES, SO SOME OF THE ABOVE LIMITATIONS MAY NOT APPLY TO YOU TO THE EXTENT PROHIBITED BY LAW
              IN YOUR JURISDICTION.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">9. Indemnification</h2>
            <p className="text-body-md text-on-surface-variant">
              You agree to defend, indemnify, and hold harmless {ENTITY_NAME}, its officers, employees, and
              agents from and against any claims, liabilities, damages, losses, and expenses, including
              reasonable legal fees, arising out of or in any way connected with: (a) your access to or use
              of the Service; (b) Your Content, including any claim that it infringes a third party&apos;s
              rights or is inaccurate or misleading; (c) your violation of these Terms; or (d) your violation
              of any applicable law or the rights of any third party.
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
              you a non-waivable right to bring a claim in your local courts or before a local regulator
              (such as an EU/UK consumer or data protection claim, or an Indian DPDP Act grievance), this
              section does not override that right.
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
              to time; we will post the revised Terms here with an updated &quot;Last updated&quot; date, and
              for material changes we will provide additional notice before the change takes effect.
              Continued use of the Service after a change takes effect constitutes your acceptance of the
              updated Terms.
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

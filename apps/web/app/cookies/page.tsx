import Image from "next/image";
import Link from "next/link";

const LAST_UPDATED = "September 19, 2026";
const ENTITY_NAME = "Inframiq Solutions Private Limited";
const CONTACT_EMAIL = "support@inframiq.com";

export const metadata = {
  title: "Cookie Policy",
  description: "The cookies and browser storage KripaX uses, and why none of them need your consent.",
  robots: { index: false, follow: true },
};

export default function CookiePolicyPage() {
  return (
    <div className="relative z-[1] min-h-screen flex flex-col">
      <nav className="flex items-center justify-between px-gutter py-lg max-w-[1440px] mx-auto w-full">
        <Link href="/" aria-label="KripaX home" className="flex shrink-0 items-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <Image src="/brand/logo-wordmark.png" alt="KripaX" width={128} height={28} loading="eager" />
        </Link>
        <Link href="/" className="text-label-md text-on-surface-variant hover:text-on-surface transition-colors">
          Back to home
        </Link>
      </nav>

      <main className="flex-1 px-gutter py-xxl">
        <article className="max-w-[720px] mx-auto flex flex-col gap-lg">
          <div>
            <h1 className="text-headline-xl text-on-surface mb-sm">Cookie Policy</h1>
            <p className="text-body-sm text-on-surface-variant">Last updated: {LAST_UPDATED}</p>
          </div>

          <p className="text-body-md text-on-surface-variant">
            This policy lists every cookie and every item of browser storage that KripaX (the
            &quot;Service&quot;), operated by {ENTITY_NAME}, puts on your device, and what each one is for.
            It supplements Section 7 of our{" "}
            <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
          </p>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">1. In short</h2>
            <p className="text-body-md text-on-surface-variant">
              We use cookies only to keep you signed in. We use browser storage only to remember a few
              choices you make in the app. We don&apos;t use advertising cookies, tracking pixels, or
              third-party cookies, and nothing we store follows you to other websites. Everything here is
              strictly necessary to provide the Service you asked for, or it remembers a setting you chose
              yourself. That is why we don&apos;t show a cookie banner or ask for consent.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">2. Cookies</h2>
            <p className="text-body-md text-on-surface-variant">
              These are first-party cookies, set on our own domain by our authentication provider, Supabase.
              They are set only when you sign in or start signing in.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-body-sm text-on-surface-variant border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant/40 text-on-surface">
                    <th className="py-xs pr-md font-semibold">Name</th>
                    <th className="py-xs pr-md font-semibold">Purpose</th>
                    <th className="py-xs font-semibold">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-outline-variant/20 align-top">
                    <td className="py-xs pr-md"><code>sb-&lt;project&gt;-auth-token</code><br />(may be split into <code>.0</code>, <code>.1</code>, …)</td>
                    <td className="py-xs pr-md">Keeps you signed in after you log in with Google, so each page knows it&apos;s you.</td>
                    <td className="py-xs">Until you sign out, or up to 400 days. Refreshed while you use the Service.</td>
                  </tr>
                  <tr className="align-top">
                    <td className="py-xs pr-md"><code>sb-&lt;project&gt;-auth-token-code-verifier</code></td>
                    <td className="py-xs pr-md">Protects the Google sign-in from being intercepted, by proving that the sign-in which finishes is the one your browser started.</td>
                    <td className="py-xs">Only while you are signing in. Removed once sign-in completes.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">3. Browser storage</h2>
            <p className="text-body-md text-on-surface-variant">
              These are kept in your browser&apos;s local storage. They are never sent to us and are only
              read by the Service on your device.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-body-sm text-on-surface-variant border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant/40 text-on-surface">
                    <th className="py-xs pr-md font-semibold">Name</th>
                    <th className="py-xs pr-md font-semibold">Purpose</th>
                    <th className="py-xs font-semibold">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-outline-variant/20 align-top">
                    <td className="py-xs pr-md"><code>career-copilot-sidebar</code></td>
                    <td className="py-xs pr-md">Remembers whether you collapsed or expanded the side menu.</td>
                    <td className="py-xs">Until you clear your browser storage.</td>
                  </tr>
                  <tr className="border-b border-outline-variant/20 align-top">
                    <td className="py-xs pr-md"><code>career-copilot-tour-seen</code></td>
                    <td className="py-xs pr-md">Remembers that you finished or skipped the guided tour, so it isn&apos;t shown again.</td>
                    <td className="py-xs">Until you clear your browser storage.</td>
                  </tr>
                  <tr className="align-top">
                    <td className="py-xs pr-md"><code>career-copilot-target-role</code></td>
                    <td className="py-xs pr-md">Keeps the target role you typed on the Career Path page while you work on it.</td>
                    <td className="py-xs">Until you clear your browser storage.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">4. Analytics without cookies</h2>
            <p className="text-body-md text-on-surface-variant">
              We measure how the Service is used and how fast its pages load with Vercel Web Analytics and
              Vercel Speed Insights, provided by our hosting provider. Neither sets cookies or stores anything
              on your device. They count page views and load times from the request itself and do not
              identify you or follow you across websites. We also record which plan a signed-in visitor is on,
              so we can see how Free and Premium are used. That count is kept in the page&apos;s memory and
              is not stored on your device.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">5. Controlling cookies and storage</h2>
            <p className="text-body-md text-on-surface-variant">
              Signing out removes the sign-in cookie. You can also delete cookies and local storage for our
              site in your browser&apos;s settings at any time. If you block cookies from our site, you will
              not be able to sign in. If you clear local storage, the app will only forget the choices listed
              in Section 3.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">6. Changes to this policy</h2>
            <p className="text-body-md text-on-surface-variant">
              If we ever add a cookie or storage item that is not strictly necessary, such as for advertising
              or analytics that identify you, we will update this page first. Where the law requires, we will
              also ask for your consent before setting it, and let you withdraw that consent as easily as you
              gave it.
            </p>
          </section>

          <section className="flex flex-col gap-sm">
            <h2 className="text-headline-md text-on-surface font-semibold">7. Contact</h2>
            <p className="text-body-md text-on-surface-variant">
              Questions about this policy can be sent to{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>.
            </p>
          </section>
        </article>
      </main>
    </div>
  );
}

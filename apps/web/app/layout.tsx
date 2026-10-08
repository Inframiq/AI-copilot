import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["500"],
  variable: "--font-jetbrains-mono",
});

const SITE_URL = "https://kripax.inframiq.com";

// viewport-fit=cover makes env(safe-area-inset-*) real on iPhones, so the
// phone tab bar can sit above the home indicator instead of under it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "KripaX — AI Resume Builder & Resume Tailoring Tool",
    template: "%s | KripaX",
  },
  description:
    "KripaX is an AI resume builder with a free plan. It tailors your resume to a job description, shows how well it matches the job's keywords, and generates interview questions for your skill gaps.",
  keywords: [
    "resume builder",
    "AI resume builder",
    "tailor resume",
    "resume tailoring",
    "ATS resume score",
    "resume checker",
    "cover letter generator",
    "interview prep AI",
  ],
  authors: [{ name: "Inframiq Solutions Private Limited" }],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "KripaX",
    title: "KripaX — AI Resume Builder & Resume Tailoring Tool",
    description:
      "Tailor your resume to a job description, see how well it matches the job's keywords, and generate interview questions for your skill gaps.",
    images: [{ url: "/icon.png", width: 512, height: 512, alt: "KripaX" }],
  },
  twitter: {
    card: "summary",
    title: "KripaX — AI Resume Builder & Resume Tailoring Tool",
    description:
      "Tailor your resume to a job description, see how well it matches the job's keywords, and generate interview questions for your skill gaps.",
    images: ["/icon.png"],
  },
  robots: { index: true, follow: true },
  verification: {
    // Google Search Console — URL-prefix property for kripax.inframiq.com.
    // Same verification token as the old resumebuilder.inframiq.com
    // property; Google reused it for this account's new property.
    google: "GvW55L4DpmFFMhVrNpkZPkBIUdGSJUkyQD2zsbqpFiA",
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Set by middleware.ts. Reading it also makes every page render per
  // request, which the nonce needs: a page built ahead of time has no
  // request to take a nonce from, and its scripts would all be blocked.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // suppressHydrationWarning: the script below sets data-sidebar on <html>
    // before React hydrates, so the attribute is there in the browser but
    // was never in the server's HTML. It covers <html>'s own attributes
    // only, not anything inside it.
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies the user's saved sidebar choice before first paint.
            localStorage can't be read during SSR, so without this a user who
            pinned the sidebar collapsed would watch it jump 280px -> 72px on
            every load. Same technique a dark-mode flash guard uses.

            The markup is a compile-time constant with no interpolation, so
            there is no injection surface here; SIDEBAR_OVERRIDE_KEY is
            inlined literally to keep the script dependency-free. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html:
              'try{var v=localStorage.getItem("career-copilot-sidebar");' +
              'if(v==="collapsed"||v==="expanded")document.documentElement.dataset.sidebar=v;}catch(e){}',
          }}
        />
      </head>
      <body className="bg-background text-on-background font-sans antialiased">
        {/* No background effect here — each route group (marketing, auth,
            app, legal) mounts its own via its own layout, since the root
            layout can't tell landing apart from everything else. */}
        <Providers>{children}</Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}

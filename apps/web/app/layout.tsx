import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "KripaX — AI Resume Builder & Resume Tailoring Tool",
    template: "%s | KripaX",
  },
  description:
    "KripaX is a free AI resume builder that tailors your resume to any job description in seconds, scores it against real ATS criteria, and generates interview questions targeting your exact skill gaps.",
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
      "Tailor your resume to any job description in seconds, get a real ATS compatibility score, and generate interview questions targeting your exact skill gaps.",
    images: [{ url: "/icon.png", width: 512, height: 512, alt: "KripaX" }],
  },
  twitter: {
    card: "summary",
    title: "KripaX — AI Resume Builder & Resume Tailoring Tool",
    description:
      "Tailor your resume to any job description in seconds, get a real ATS compatibility score, and generate interview questions targeting your exact skill gaps.",
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="bg-background text-on-background font-sans antialiased">
        {/* No background effect here — each route group (marketing, auth,
            app, legal) mounts its own via its own layout, since the root
            layout can't tell landing apart from everything else. */}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

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

const SITE_URL = "https://resumebuilder.inframiq.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Career Copilot — AI Resume Builder & Resume Tailoring Tool",
    template: "%s | Career Copilot",
  },
  description:
    "Career Copilot is a free AI resume builder that tailors your resume to any job description in seconds, scores it against real ATS criteria, and generates interview questions targeting your exact skill gaps.",
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
    siteName: "Career Copilot",
    title: "Career Copilot — AI Resume Builder & Resume Tailoring Tool",
    description:
      "Tailor your resume to any job description in seconds, get a real ATS compatibility score, and generate interview questions targeting your exact skill gaps.",
    images: [{ url: "/icon.png", width: 512, height: 512, alt: "Career Copilot" }],
  },
  twitter: {
    card: "summary",
    title: "Career Copilot — AI Resume Builder & Resume Tailoring Tool",
    description:
      "Tailor your resume to any job description in seconds, get a real ATS compatibility score, and generate interview questions targeting your exact skill gaps.",
    images: ["/icon.png"],
  },
  robots: { index: true, follow: true },
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

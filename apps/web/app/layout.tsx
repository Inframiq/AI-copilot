import type { Metadata } from "next";
import { Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-hanken",
});

export const metadata: Metadata = {
  title: "Career Copilot",
  description: "AI-powered resume tailoring and interview prep",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={hanken.variable}>
      <body className="bg-background text-on-background font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

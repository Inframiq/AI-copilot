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

export const metadata: Metadata = {
  title: "Career Copilot",
  description: "AI-powered resume tailoring and interview prep",
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

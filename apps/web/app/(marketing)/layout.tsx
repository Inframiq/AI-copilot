import { Instrument_Serif } from "next/font/google";
import { LightfallBackground } from "@/components/backgrounds/LightfallBackground";

// The landing page's one display face: an editorial serif italic for the
// few words each headline leans on. Loaded here, not in the root layout, so
// the app itself never downloads it.
const display = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={display.variable}>
      <LightfallBackground />
      {children}
    </div>
  );
}

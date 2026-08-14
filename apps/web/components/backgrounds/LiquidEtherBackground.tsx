"use client";
import dynamic from "next/dynamic";

// LiquidEther touches canvas/WebGL/window and can't run during SSR.
const LiquidEther = dynamic(() => import("./LiquidEther.jsx"), { ssr: false });

// Brand royal-blue → navy gradient (see app/globals.css --color-primary /
// --color-primary-container / --color-primary-fixed-dim) instead of React
// Bits' default purple/pink preset.
const BRAND_COLORS = ["#003ea8", "#004ac6", "#b4c5ff"];

export function LiquidEtherBackground() {
  return (
    <div aria-hidden className="fixed inset-0" style={{ zIndex: 0 }}>
      <LiquidEther colors={BRAND_COLORS} autoDemo autoSpeed={0.4} autoIntensity={1.8} />
    </div>
  );
}

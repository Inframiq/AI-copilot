"use client";
import dynamic from "next/dynamic";

// Lightfall touches canvas/WebGL/window and can't run during SSR.
const Lightfall = dynamic(() => import("./Lightfall.jsx"), { ssr: false });

// Brand royal-blue → navy gradient (see app/globals.css --color-primary /
// --color-primary-container / --color-primary-fixed-dim) instead of React
// Bits' default purple/pink preset. backgroundColor/opacity/glow are tuned
// down from the library defaults so the effect stays a subtle wash on this
// app's light background rather than a heavy dark overlay.
const BRAND_COLORS = ["#b3c5ff", "#0066ff", "#003fa4"];

export function LightfallBackground() {
  return (
    <div aria-hidden className="fixed inset-0" style={{ zIndex: 0 }}>
      <Lightfall
        className={undefined}
        dpr={undefined}
        mixBlendMode={undefined}
        colors={BRAND_COLORS}
        backgroundColor="#f7f9fb"
        opacity={0.22}
        glow={0.9}
        backgroundGlow={0.08}
      />
    </div>
  );
}

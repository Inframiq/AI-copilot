// Premium ambient background: two slow, low-opacity sapphire washes that
// drift almost imperceptibly (see `.ambient-bg` / `@keyframes ambient-drift`
// in app/globals.css) plus a faint grain to kill banding. Deliberately calm
// and static-feeling — replaces the earlier animated WebGL streak effect,
// which read as generic. No canvas, no dependencies, SSR-safe.
//
// Filename/export kept as `LightfallBackground` so the marketing layout
// import is unchanged.

const GRAIN =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'>` +
      `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>` +
      `<feColorMatrix type='saturate' values='0'/></filter>` +
      `<rect width='100%' height='100%' filter='url(#n)' opacity='0.035'/></svg>`,
  );

export function LightfallBackground() {
  return (
    <div aria-hidden className="ambient-bg">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url("${GRAIN}")`,
          backgroundRepeat: "repeat",
          mixBlendMode: "multiply",
          opacity: 0.5,
        }}
      />
    </div>
  );
}

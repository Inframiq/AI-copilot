// Premium ambient backdrop: a luminous sapphire "aurora" that glows from the
// top of the page and dissolves into clean paper before the content — see
// `.ambient-bg` / `.ambient-aurora` / `.ambient-orb` / `@keyframes
// ambient-orb-*` in app/globals.css. Motion is GPU-only (transform), smooth,
// and honours prefers-reduced-motion. A faint grain sits on top to kill
// gradient banding. No canvas, no dependencies, SSR-safe.
//
// Filename/export kept as `LightfallBackground` so layout imports are
// unchanged.

const GRAIN =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'>` +
      `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>` +
      `<feColorMatrix type='saturate' values='0'/></filter>` +
      `<rect width='100%' height='100%' filter='url(#n)'/></svg>`,
  );

export function LightfallBackground() {
  return (
    <div aria-hidden className="ambient-bg">
      <div className="ambient-aurora">
        <div className="ambient-orb ambient-orb--1" />
        <div className="ambient-orb ambient-orb--2" />
        <div className="ambient-orb ambient-orb--3" />
      </div>
      <div className="ambient-grain" style={{ backgroundImage: `url("${GRAIN}")` }} />
    </div>
  );
}

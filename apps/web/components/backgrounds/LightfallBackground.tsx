// Premium ambient background: a slow sapphire "aurora" — three large, soft,
// blurred colour fields drifting on long eased loops (see `.ambient-bg` /
// `.ambient-blob` / `@keyframes ambient-float-*` in app/globals.css), with a
// faint grain on top to kill banding. Motion is GPU-only (transform), calm,
// and honours prefers-reduced-motion. Replaces the earlier animated WebGL
// streak effect. No canvas, no dependencies, SSR-safe.
//
// Filename/export kept as `LightfallBackground` so the marketing layout
// import is unchanged.

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
      <div className="ambient-blob ambient-blob--1" />
      <div className="ambient-blob ambient-blob--2" />
      <div className="ambient-blob ambient-blob--3" />
      <div className="ambient-grain" style={{ backgroundImage: `url("${GRAIN}")` }} />
    </div>
  );
}

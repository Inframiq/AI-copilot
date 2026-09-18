"use client";
import { useId } from "react";

/**
 * A four-pointed sparkle.
 *
 * The control points sit near the centre, which pulls each edge inward and
 * gives the concave silhouette a polygon star cannot — that curve is what
 * reads as "shine" rather than "asterisk".
 *
 * `waist` is how far the control points sit from the centre as a fraction of
 * the radius: 0 is a needle-thin cross, 0.3 is nearly a diamond.
 */
function sparkle(cx: number, cy: number, r: number, waist: number): string {
  const k = r * waist;
  return [
    `M${cx},${cy - r}`,
    `Q${cx + k},${cy - k} ${cx + r},${cy}`,
    `Q${cx + k},${cy + k} ${cx},${cy + r}`,
    `Q${cx - k},${cy + k} ${cx - r},${cy}`,
    `Q${cx - k},${cy - k} ${cx},${cy - r}`,
    "Z",
  ].join(" ");
}

// Off-centre and unevenly spaced on purpose: four satellites at equal angles
// read as a compass rose, not a sky.
const SATELLITES = [
  { cx: 101, cy: 27, r: 9, delay: "0s", dur: "2.6s" },
  { cx: 22, cy: 44, r: 6.5, delay: "0.9s", dur: "3.1s" },
  { cx: 95, cy: 97, r: 5.5, delay: "1.7s", dur: "2.9s" },
  { cx: 31, cy: 103, r: 4.5, delay: "2.3s", dur: "3.4s" },
];

/**
 * The tailoring loader: one big star with a lit outline, a slow flare behind
 * it, a gleam that crosses it, and smaller stars twinkling out of step.
 *
 * Decorative — the heading beside it carries the meaning, so it is hidden
 * from assistive tech rather than labelled.
 */
export function TailoringStar({ className = "" }: { className?: string }) {
  // useId keeps two instances from sharing gradient ids; the colons React
  // puts in it are legal in an id but break url(#…) references, so they go.
  const uid = useId().replace(/:/g, "");
  const core = `core-${uid}`;
  const halo = `halo-${uid}`;
  const gleam = `gleam-${uid}`;
  const clip = `clip-${uid}`;

  const heroPath = sparkle(64, 64, 38, 0.16);

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 128 128"
      className={`h-28 w-28 overflow-visible ${className}`}
    >
      <defs>
        {/* Light from the upper left, so the outline reads as lit rather
            than merely stroked. */}
        {/* Deeper than it looks it should be: a bright outline and a white
            gleam need a dark face to read against, and the first attempt was
            so pale that both disappeared into it. */}
        <linearGradient id={core} x1="22%" y1="8%" x2="78%" y2="96%">
          <stop offset="0%" stopColor="#c6d7ff" />
          <stop offset="28%" stopColor="#4e74dd" />
          <stop offset="68%" stopColor="#21439d" />
          <stop offset="100%" stopColor="#10245c" />
        </linearGradient>

        <radialGradient id={halo}>
          <stop offset="0%" stopColor="#4a70d8" stopOpacity="0.5" />
          <stop offset="55%" stopColor="#4a70d8" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#4a70d8" stopOpacity="0" />
        </radialGradient>

        <linearGradient id={gleam} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>

        <clipPath id={clip}>
          <path d={heroPath} />
        </clipPath>
      </defs>

      {/* Bloom. Sits behind everything and breathes with the star. */}
      <circle className="tstar tstar-halo" cx="64" cy="64" r="58" fill={`url(#${halo})`} />

      {/* Lens flare, locked to the star's own axes. An earlier version turned
          these slowly and it read as a smudge behind the star: rays that do
          not line up with the thing emitting them look like a mistake. They
          breathe in length instead, on a longer period than the star. */}
      <g className="tstar tstar-flare">
        <path d={sparkle(64, 64, 62, 0.02)} fill="#4a70d8" opacity="0.18" />
      </g>
      <g className="tstar tstar-flare-slow">
        <path
          d={sparkle(64, 64, 46, 0.03)}
          fill="#6d90ec"
          opacity="0.14"
          transform="rotate(45 64 64)"
        />
      </g>

      {/* The shining outline: the star's own silhouette, stroked, expanding
          and fading outward. Two of them half a period apart, so the light
          leaves continuously rather than in gulps. */}
      <path className="tstar tstar-pulse" d={heroPath} fill="none" stroke="#6d90ec" strokeWidth="1.6" />
      <path
        className="tstar tstar-pulse"
        style={{ animationDelay: "1.8s" }}
        d={heroPath}
        fill="none"
        stroke="#6d90ec"
        strokeWidth="1.6"
      />

      {SATELLITES.map((s) => (
        <path
          key={`${s.cx}-${s.cy}`}
          data-star="satellite"
          className="tstar tstar-twinkle"
          style={{ animationDelay: s.delay, animationDuration: s.dur }}
          d={sparkle(s.cx, s.cy, s.r, 0.1)}
          fill="#6d90ec"
        />
      ))}

      <g className="tstar tstar-core">
        <path
          data-star="hero"
          d={heroPath}
          fill={`url(#${core})`}
          stroke="#eaf1ff"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        {/* The gleam crosses the star itself, clipped to its silhouette. */}
        <g clipPath={`url(#${clip})`}>
          {/* The tilt lives on the wrapper: a CSS transform on the rect would
              replace this presentation attribute, not compose with it. */}
          <g transform="rotate(18 64 64)">
            <rect
              className="tstar tstar-gleam"
              x="-30"
              y="10"
              width="26"
              height="108"
              fill={`url(#${gleam})`}
            />
          </g>
        </g>
      </g>
    </svg>
  );
}

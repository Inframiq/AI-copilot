"use client";
import { useEffect, useRef } from "react";

const P = [75, 87, 170] as const;
const A = [120, 90, 220] as const;

const rgba = ([r, g, b]: readonly [number, number, number], a: number) =>
  `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

const SPACING = 13;
const DOME_R  = 230;  // –20 %
const DOME_H  = 80;
const TILT    = 0.56;

// Spring physics constants — snappy response, no overshoot
const STIFFNESS = 0.18;  // how hard the spring pulls toward cursor
const DAMPING   = 0.72;  // friction that prevents oscillation

function domeZ(px: number, py: number, cx: number, cy: number): number {
  const r = Math.hypot(px - cx, py - cy);
  if (r >= DOME_R) return 0;
  const t = 1 - r / DOME_R;
  return DOME_H * t * t * (3 - 2 * t);
}

export function CursorGlow() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf: number;
    // Spring state
    let cx = window.innerWidth  / 2;
    let cy = window.innerHeight / 2;
    let vx = 0, vy = 0;          // velocity
    let tx = cx, ty = cy;        // raw target

    const resize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();

    const onMove = (e: MouseEvent) => { tx = e.clientX; ty = e.clientY; };
    window.addEventListener("resize",    resize, { passive: true });
    window.addEventListener("mousemove", onMove,  { passive: true });

    const draw = () => {
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      // ── 1. Cursor glow bloom ───────────────────────────────────────────
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 448);  // –20 %
      g.addColorStop(0.00, rgba(P, 0.26));
      g.addColorStop(0.25, rgba(A, 0.13));
      g.addColorStop(0.55, rgba(A, 0.05));
      g.addColorStop(1.00, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // ── 2. Ring field with dome displacement ───────────────────────────
      const cols = Math.ceil(W / SPACING) + 2;
      const rows = Math.ceil(H / SPACING) + 2;
      const ox   = ((W % SPACING) / 2) - SPACING;
      const oy   = ((H % SPACING) / 2) - SPACING;

      for (let row = 0; row <= rows; row++) {
        for (let col = 0; col <= cols; col++) {
          const bx   = ox + col * SPACING;
          const by   = oy + row * SPACING;
          const dist = Math.hypot(bx - cx, by - cy);

          const z  = domeZ(bx, by, cx, cy);
          const zN = z / DOME_H;

          // Screen position after tilt projection
          const sx = bx;
          const sy = by - z * TILT;

          // Base × — always visible, very subtle
          ctx.textAlign    = "center";
          ctx.textBaseline = "middle";
          ctx.font         = "5px sans-serif";
          ctx.fillStyle    = rgba(P, 0.16);
          ctx.fillText("×", sx, sy);

          // Dome glow — only inside influence radius
          if (z > 2) {
            const t = 1 - dist / DOME_R;

            // Soft radial halo behind the ×
            const haloR = 3 + zN * 5;
            const halo  = ctx.createRadialGradient(sx, sy, 0, sx, sy, haloR);
            halo.addColorStop(0, rgba(A, t * 0.40));
            halo.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = halo;
            ctx.beginPath();
            ctx.arc(sx, sy, haloR, 0, Math.PI * 2);
            ctx.fill();

            // Glowing × — grows and brightens with dome height
            const xSize = 5 + zN * 4;
            ctx.font      = `${xSize}px sans-serif`;
            ctx.fillStyle = rgba(A, 0.30 + t * 0.55);
            ctx.fillText("×", sx, sy);
          }
        }
      }
    };

    const tick = () => {
      // Spring: pull velocity toward target, apply damping
      vx = (vx + (tx - cx) * STIFFNESS) * DAMPING;
      vy = (vy + (ty - cy) * STIFFNESS) * DAMPING;
      cx += vx;
      cy += vy;
      draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize",    resize);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0"
      style={{ zIndex: 0 }}
    />
  );
}

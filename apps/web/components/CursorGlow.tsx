"use client";
import { useEffect, useRef } from "react";

// Multicolor dot palette — one stable color per grid dot, not a single tint
const PALETTE = [
  [66, 133, 244],   // blue
  [234, 67, 53],    // red
  [251, 188, 5],    // yellow
  [52, 168, 83],    // green
  [186, 85, 211],   // orchid
] as const;

const rgba = ([r, g, b]: readonly [number, number, number], a: number) =>
  `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

// Deterministic per-cell color so each dot keeps its color across frames
function colorFor(col: number, row: number): number {
  const h = Math.abs((col * 73856093) ^ (row * 19349663));
  return h % PALETTE.length;
}

const SPACING = 20;
const DOME_R  = 240;
const DOME_H  = 70;
const TILT    = 0.56;

// Ambient per-dot drift — small, slow, phase-shifted so the field never
// looks static even when the cursor doesn't move
const DRIFT_AMP   = 2.2;
const DRIFT_SPEED = 0.6;

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
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Spring state
    let cx = window.innerWidth  / 2;
    let cy = window.innerHeight / 2;
    let vx = 0, vy = 0;          // velocity
    let tx = cx, ty = cy;        // raw target

    const resize = () => {
      canvas.width  = Math.round(window.innerWidth  * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      canvas.style.width  = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const onMove = (e: MouseEvent) => { tx = e.clientX; ty = e.clientY; };
    window.addEventListener("resize",    resize, { passive: true });
    window.addEventListener("mousemove", onMove,  { passive: true });

    // Reused Path2D buckets — one per palette color — so the whole
    // ambient field is drawn with a handful of fill() calls, not thousands
    const basePaths: Path2D[] = PALETTE.map(() => new Path2D());

    const draw = (elapsed: number) => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      ctx.clearRect(0, 0, W, H);

      const cols = Math.ceil(W / SPACING) + 2;
      const rows = Math.ceil(H / SPACING) + 2;
      const ox   = ((W % SPACING) / 2) - SPACING;
      const oy   = ((H % SPACING) / 2) - SPACING;

      for (let i = 0; i < basePaths.length; i++) basePaths[i] = new Path2D();

      // ── Pass 1: ambient field, batched per color, gently drifting ──────
      for (let row = 0; row <= rows; row++) {
        for (let col = 0; col <= cols; col++) {
          const gridX = ox + col * SPACING;
          const gridY = oy + row * SPACING;

          const phase  = (col * 12.9898 + row * 78.233) % (Math.PI * 2);
          const driftX = Math.sin(elapsed * DRIFT_SPEED + phase) * DRIFT_AMP;
          const driftY = Math.cos(elapsed * DRIFT_SPEED * 0.8 + phase * 1.7) * DRIFT_AMP;

          const bx = gridX + driftX;
          const by = gridY + driftY;

          // Skip dots that will be redrawn bigger/brighter by pass 2
          if (domeZ(bx, by, cx, cy) > 1) continue;

          const path = basePaths[colorFor(col, row)];
          path.moveTo(bx + 1, by);
          path.arc(bx, by, 1, 0, Math.PI * 2);
        }
      }
      PALETTE.forEach((color, i) => {
        ctx.fillStyle = rgba(color, 0.22);
        ctx.fill(basePaths[i]);
      });

      // ── Pass 2: cursor dome — only dots within reach, drawn individually
      // so each can grow/brighten/halo smoothly ───────────────────────────
      const reach   = DOME_R + DRIFT_AMP;
      const colFrom = Math.max(0, Math.floor((cx - reach - ox) / SPACING));
      const colTo   = Math.min(cols, Math.ceil((cx + reach - ox) / SPACING));
      const rowFrom = Math.max(0, Math.floor((cy - reach - oy) / SPACING));
      const rowTo   = Math.min(rows, Math.ceil((cy + reach - oy) / SPACING));

      for (let row = rowFrom; row <= rowTo; row++) {
        for (let col = colFrom; col <= colTo; col++) {
          const gridX = ox + col * SPACING;
          const gridY = oy + row * SPACING;

          const phase  = (col * 12.9898 + row * 78.233) % (Math.PI * 2);
          const driftX = Math.sin(elapsed * DRIFT_SPEED + phase) * DRIFT_AMP;
          const driftY = Math.cos(elapsed * DRIFT_SPEED * 0.8 + phase * 1.7) * DRIFT_AMP;

          const bx = gridX + driftX;
          const by = gridY + driftY;

          const z = domeZ(bx, by, cx, cy);
          if (z <= 1) continue;

          const zN   = z / DOME_H;
          const dist = Math.hypot(bx - cx, by - cy);
          const t    = 1 - dist / DOME_R;
          const color = PALETTE[colorFor(col, row)];

          const sx = bx;
          const sy = by - z * TILT;

          const haloR = 2.5 + zN * 4;
          const halo  = ctx.createRadialGradient(sx, sy, 0, sx, sy, haloR);
          halo.addColorStop(0, rgba(color, t * 0.35));
          halo.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(sx, sy, haloR, 0, Math.PI * 2);
          ctx.fill();

          const dotR = 1 + zN * 1.8;
          ctx.fillStyle = rgba(color, 0.35 + t * 0.5);
          ctx.beginPath();
          ctx.arc(sx, sy, dotR, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const tick = (now: number) => {
      // Spring: pull velocity toward target, apply damping
      vx = (vx + (tx - cx) * STIFFNESS) * DAMPING;
      vy = (vy + (ty - cy) * STIFFNESS) * DAMPING;
      cx += vx;
      cy += vy;
      draw(now / 1000);
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

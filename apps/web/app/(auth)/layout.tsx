export default function AuthLayout({ children }: { children: React.ReactNode }) {
  // CursorGlow (fixed, z-index:0) is a positioned element and paints above
  // static in-flow content regardless of DOM order — this wrapper must be
  // positioned with a higher z-index so the page renders above the canvas.
  return <div className="relative z-[1]">{children}</div>;
}

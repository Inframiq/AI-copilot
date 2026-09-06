// Shares the premium ambient background used site-wide (see `.ambient-bg` in
// app/globals.css) so auth / privacy / terms match the marketing page.
// Replaces the earlier animated WebGL fluid effect. Export name kept so the
// auth / privacy / terms layout imports are unchanged.
import { LightfallBackground } from "./LightfallBackground";

export function LiquidEtherBackground() {
  return <LightfallBackground />;
}

# Landing page Lightfall + app-wide Liquid Ether, dot/grid removal

## Problem

The site currently has one global background effect, `CursorGlow.tsx`,
mounted once in the root layout and applied to every page: a static ambient
dot-grid plus a small cursor-following "dome" of brighter dots. It's the
same effect everywhere, and reads as a generic decorative layer rather than
a considered part of the product's visual identity.

## Scope

- Landing page (`/`) gets a **Lightfall** background (React Bits) — a
  raymarched light-streak effect.
- Every other page (all `(app)` pages, all `(auth)` pages, `/privacy`,
  `/terms`) gets a **Liquid Ether** background (React Bits) — a mouse-reactive
  WebGL fluid simulation, replacing today's small cursor-dot effect.
- The old dot/grid visual system is removed completely: `CursorGlow.tsx`
  itself, and a separate static CSS dot-grid found in `PreviewPanel.tsx`
  (`radial-gradient(#767682 1px, transparent 1px)` behind the resume PDF
  preview) — same visual language, different component, also gone.
- Both effects are recolored to the app's existing brand palette (navy
  `#000a56` primary, `#142175` primary-container, `#bcc3ff` light
  periwinkle) instead of React Bits' default purple/pink presets.

## Component sourcing

Both components are vendored (copied) from `DavidHDev/react-bits` on
GitHub — React Bits has no installable npm package for the library as a
whole; components are meant to be copy-pasted into the consuming project.
Source pulled directly from:
- `src/content/Backgrounds/LiquidEther/{LiquidEther.jsx,LiquidEther.css}`
- `src/content/Backgrounds/Lightfall/{Lightfall.jsx,Lightfall.css}`

New dependencies: `three` (LiquidEther's fluid sim) and `ogl` (Lightfall's
lightweight WebGL wrapper, ~30KB — much smaller than three.js).

Destination: `apps/web/components/backgrounds/LiquidEther.jsx` (+ `.css`)
and `apps/web/components/backgrounds/Lightfall.jsx` (+ `.css`), kept as
`.jsx` per their original form (`allowJs` is already on in `tsconfig.json`,
so this isn't a new build-config requirement). Each is used through a thin
`.tsx` wrapper that fixes the brand color props, so call sites don't repeat
hex values.

## Where each effect mounts

Next's App Router shares one root layout across every route, so a route
needs its own layout (via a route group, which doesn't add a URL segment)
to get a different background than the rest of the site:

- `app/layout.tsx` (root) — stops rendering any background; becomes a
  neutral shell (fonts, `<Providers>`).
- Landing page moves from `app/page.tsx` to `app/(marketing)/page.tsx`
  (route stays `/`). New `app/(marketing)/layout.tsx` renders `Lightfall`.
- `app/(auth)/layout.tsx` — renders `LiquidEther`, replacing its current
  comment-only `relative z-[1]` wrapper.
- `app/(app)/layout.tsx` — same, renders `LiquidEther`.
- New `app/privacy/layout.tsx` and `app/terms/layout.tsx` — same pattern,
  `LiquidEther` + `relative z-[1]` wrapper (mirrors the auth layout).

Each effect mounts once per route-group layout and persists across
in-group navigation (e.g. Dashboard → Profile → Studio doesn't restart the
WebGL context); it only unmounts crossing between groups (app ↔ auth ↔
landing/legal).

## Client-only loading

Both components touch `canvas`/WebGL/`window` and cannot run during SSR.
Each is loaded via `next/dynamic({ ssr: false })` at its layout mount
point, so it never blocks the server-rendered HTML and isn't included in
the server bundle.

## Performance

Both source components already include the guards this app needs without
further work:
- `IntersectionObserver` — pauses rendering when the canvas scrolls off
  screen.
- `visibilitychange` — pauses when the tab isn't visible.
- LiquidEther defaults to `resolution: 0.5` (half-resolution simulation
  grid) and capped `devicePixelRatio` — reasonable defaults for a
  full-page background rather than a hero visual.

No additional throttling planned beyond what's already in the vendored
source; revisit only if manual testing shows a real problem.

## Testing

- No meaningful automated coverage for WebGL visuals — verified manually:
  Lightfall renders on `/`, Liquid Ether renders and tracks the cursor on
  one `(app)` page and one `(auth)` page, `/privacy` and `/terms` render
  Liquid Ether, and no dot/grid pattern remains anywhere (including
  PreviewPanel).
- Full existing frontend suite (102 tests) must still pass after
  `CursorGlow` is removed — none currently reference it directly, but this
  confirms nothing else did either.
- `tsc --noEmit` after wiring in the first `.jsx` files this app has had.

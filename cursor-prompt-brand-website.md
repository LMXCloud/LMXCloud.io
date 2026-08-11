# Cursor prompt — apply real logo across apps/web

Goal: replace the placeholder brand mark used throughout the dashboard/landing site
with the real LMX Cloud logo now that one's been designed (see `brand/BRAND_GUIDELINES.md`
for the full writeup — mark, palette, usage rules).

Two asset files are already saved at:
- `apps/web/public/brand/logo-icon.png` — icon-only mark (square, cyan wireframe cloud on dark)
- `apps/web/public/brand/logo-lockup.png` — icon + "LMX Cloud" wordmark, stacked

Everywhere below currently uses a generic Lucide `Layers` icon in a bordered box as a
placeholder — not the real logo, just a stand-in that's been shipping:

- `apps/web/src/components/DashboardLayout.tsx` ~L84-90 — sidebar header (console/dashboard)
- `apps/web/src/pages/LandingPage.tsx` ~L247 — site header
- `apps/web/src/pages/LandingPage.tsx` ~L596 — footer

Replace the `Layers` icon + box in all three spots with `logo-icon.png` (it's already
square and designed to read small — the box/border wrapper can likely go away entirely
now that there's a real mark, but use your judgment on whether keeping a subtle
container looks better against the surrounding layout).

**Favicon:** `apps/web/index.html` L5 points at `apps/web/public/favicon.svg`, which is
a generic placeholder unrelated to the new brand. The new master art is a raster PNG
(`logo-icon.png`), not vector, so generate a proper favicon set from it (16x16, 32x32,
48x48, and a 180x180 apple-touch-icon at minimum) and update the `<link rel="icon">`
tags accordingly — whatever tooling/approach is standard for a Vite project is fine,
don't need my input on the exact method.

**Open Graph / Twitter share image:** `apps/web/index.html` L30 has a comment saying
`og:image` / `twitter:image` are "intentionally omitted — no share image asset yet."
That's no longer true — use `logo-lockup.png` (or crop/pad it as needed for a
1200x630-ish social card ratio) as the share image and add the `og:image` /
`twitter:image` meta tags.

**JSON-LD:** `apps/web/index.html` L51, the `publisher.logo` field in the
`SoftwareApplication` schema, currently points at the placeholder `favicon.svg` — point
it at the real logo asset instead.

Constraints:
- Don't touch the color palette, layout structure, or anything else — this is a
  drop-in asset swap, not a redesign.
- Confirm the sidebar/header still looks right at both mobile and desktop breakpoints
  after the swap (the current placeholder is used in a compact space in
  `DashboardLayout.tsx`).

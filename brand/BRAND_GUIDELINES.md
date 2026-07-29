# LMX Cloud — Brand Guidelines (v1)

Status: logo mark selected 2026-07-28. This is the starting brand system — enough
to stop using the placeholder AI-generated image and get consistent assets across
the dashboard, docs page, GitHub org, status page, and listing copy. Expand as needed.

## Logo

**Primary mark — "Stylized Cloud, Dynamic Data Flow."** A wireframe cloud built
from connected triangulated nodes, glowing cyan on black. Reads as network/routing
topology, not a generic cloud icon or token logo — ties directly to the DePIN
routing product.

- Icon only (square, transparent-safe): https://export-download.canva.com/PUzRk/DAHQr-PUzRk/-1/0/0001-4069513190002814978.png
- Wordmark lockup (icon + "LMX Cloud" text, stacked): https://export-download.canva.com/AteAQ/DAHQr3AteAQ/-1/0/0001-4542391152872279343.png
- Editable source (Canva): https://www.canva.com/d/879tWRtbndB5GTo (icon) · https://www.canva.com/d/e4NXR4gCYO6mAzc (lockup)

> Export links are pre-signed and expire — re-export from the Canva source links
> above if a link has gone stale, don't treat the URLs themselves as permanent hosting.

**Usage:**
- Icon-only mark for: favicon, MCP/registry listing icons, social profile avatars,
  anywhere space is square/tight.
- Wordmark lockup for: docs page header, GitHub README, status page, email signature,
  anywhere there's room for the full name.
- Minimum size: don't render the icon below ~32px — the triangulated detail
  degrades into noise at small sizes. Test at actual favicon size (16x16/32x32)
  before shipping.
- Clear space: keep at least 0.5x the icon's height as empty margin on all sides.
- Don't: recolor the mark off-palette, add a drop shadow or outline beyond what's
  built in, stretch/distort the aspect ratio, or place it on a light background
  (it's designed for dark surfaces — see Backgrounds below).

## Color palette

Pulled directly from the existing dashboard (`apps/web/src/index.css`) so the logo
matches the product it represents rather than introducing a second palette.

| Role | Hex | Use |
|---|---|---|
| Background | `#0a0b0f` | Page background, logo backdrop |
| Surface | `#14151c` | Cards, panels |
| Elevated | `#1e2029` | Raised surfaces |
| Border | `#2a2d38` | Default borders |
| Border (strong) | `#3a3d4a` | Emphasized borders |
| Text | `#f2f4f8` | Primary text on dark |
| Text (muted) | `#9aa0ae` | Secondary text |
| Text (faint) | `#5c6170` | Tertiary/disabled text |
| **Primary** | `#5b6bff` | Primary actions, brand accent (indigo) |
| Primary hover | `#7886ff` | — |
| Primary pressed | `#4a59e6` | — |
| **Secondary** | `#3dd7e5` | Logo glow color, links, secondary accent (cyan) |
| Tertiary | `#f5d547` | Sparingly — highlights, warnings |
| Success | `#2be08c` | — |
| Warning | `#f5d547` | — |
| Info | `#3dd7e5` | — |
| Error | `#ff3a5c` | — |

The logo uses the secondary cyan (`#3dd7e5`) as its glow/line color rather than the
primary indigo — reads better as a glowing wireframe and keeps indigo distinct for
UI actions (buttons, links) so the logo doesn't visually compete with interactive
elements when both are on screen.

## Backgrounds

Dark version (glow cyan `#3dd7e5` on black) is primary — use it everywhere the
surface is dark. **Light-background variant added 2026-07-28**: same exact
triangulated mark, recolored to solid indigo `#5b6bff` with no glow (glow doesn't
read on white), transparent background so it drops onto any light surface. Use for
GitHub org page, light-themed registry listings, or anywhere else a white/light
surface comes up. Not a redesign — pixel-identical shape to the dark mark, only the
color treatment changes.

## Typography

Not yet defined beyond the wordmark treatment above (bold, sentence case, cyan).
If a broader type system (headings/body font pairing) is needed for marketing
material, that's a separate follow-up, not covered here.

## Open follow-ups

- Favicon export set (16/32/48/180px) from the icon-only mark.
- Apply consistently across: `apps/web` (dashboard), `apps/ops`, docs page,
  GitHub org (`LMXCloud`) profile/README, public status page, Bazaar/Agentic.Market
  listing copy, MCP registry entry, ElizaOS plugin registry entry.
- Social account avatars/banners once accounts are claimed (separate roadmap item).

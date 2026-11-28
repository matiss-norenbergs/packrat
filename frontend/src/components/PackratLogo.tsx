import { useId } from "react"
import {
  LOGO_GLYPH_PATHS,
  LOGO_GLYPH_POLYLINE,
  LOGO_GLYPH_SCALE,
  LOGO_GLYPH_STROKE_WIDTH,
  LOGO_GRADIENT_WHITE_PERCENT,
  LOGO_SIZE,
  LOGO_TILE_RADIUS,
} from "@/lib/logoShape"

// The app's brand mark — a package outline (matching lucide's own Package
// icon, which is what the sidebar/login logo used to be, bare and
// uncolored) on a gradient tile. The gradient tracks the current --primary
// (Settings → Appearance → Primary color) live via color-mix(), so the logo
// recolors along with the rest of the UI when the accent changes — unlike
// public/favicon.svg, which is a static file the browser reads on its own
// and has no access to in-app CSS custom properties, so it stays fixed on
// the brand purple regardless of the chosen accent.
//
// The glyph itself wears --primary-foreground rather than a hardcoded
// white — every accent but one has a near-white --primary-foreground, so
// this looks identical to plain white for them, but the Monochrome accent
// flips --primary-foreground to near-black in dark mode (its tile is a
// flat white gradient there), and a hardcoded white glyph would vanish
// against it.
export function PackratLogo({ className }: { className?: string }) {
  const gradientId = useId()
  return (
    <svg viewBox={`0 0 ${LOGO_SIZE} ${LOGO_SIZE}`} className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2={LOGO_SIZE} y2={LOGO_SIZE} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={`color-mix(in oklch, var(--primary), white ${LOGO_GRADIENT_WHITE_PERCENT}%)`} />
          <stop offset="1" stopColor="var(--primary)" />
        </linearGradient>
      </defs>
      <rect width={LOGO_SIZE} height={LOGO_SIZE} rx={LOGO_TILE_RADIUS} fill={`url(#${gradientId})`} />
      <g
        transform={`scale(${LOGO_GLYPH_SCALE})`}
        fill="none"
        stroke="var(--primary-foreground)"
        strokeWidth={LOGO_GLYPH_STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {LOGO_GLYPH_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
        <polyline points={LOGO_GLYPH_POLYLINE} />
      </g>
    </svg>
  )
}

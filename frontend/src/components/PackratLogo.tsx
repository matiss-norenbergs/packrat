import { useId } from "react"

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
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="color-mix(in oklch, var(--primary), white 18%)" />
          <stop offset="1" stopColor="var(--primary)" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="11" fill={`url(#${gradientId})`} />
      <g
        transform="scale(2)"
        fill="none"
        stroke="var(--primary-foreground)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" />
        <path d="M12 22V12" />
        <polyline points="3.29 7 12 12 20.71 7" />
        <path d="m7.5 4.27 9 5.15" />
      </g>
    </svg>
  )
}

// The Packrat logo's geometry, shared by the in-app logo (components/PackratLogo.tsx) and the
// desktop window/tray icon (lib/appIcon.ts) so there is one copy of the shapes. A 48x48 tile with
// a package outline drawn on a 24x24 grid scaled 2x (the outline is lucide's own Package icon).
export const LOGO_SIZE = 48
export const LOGO_TILE_RADIUS = 11
export const LOGO_GLYPH_SCALE = 2
export const LOGO_GLYPH_STROKE_WIDTH = 2
export const LOGO_GLYPH_PATHS = [
  "M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z",
  "M12 22V12",
  "m7.5 4.27 9 5.15",
] as const
export const LOGO_GLYPH_POLYLINE = "3.29 7 12 12 20.71 7"
// How far the gradient's start is mixed towards white (percent), in oklch.
export const LOGO_GRADIENT_WHITE_PERCENT = 18

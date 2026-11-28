import {
  LOGO_GLYPH_PATHS,
  LOGO_GLYPH_POLYLINE,
  LOGO_GLYPH_SCALE,
  LOGO_GLYPH_STROKE_WIDTH,
  LOGO_GRADIENT_WHITE_PERCENT,
  LOGO_SIZE,
  LOGO_TILE_RADIUS,
} from "@/lib/logoShape"

// The desktop shell's window and tray icon: the Packrat logo (the same shapes as the in-app
// PackratLogo) in the current --primary / --primary-foreground, rasterized to a PNG. Only the
// desktop shell loads this module (hooks/useDesktopIcon imports it dynamically).

export interface LogoColors {
  /** Gradient start: --primary mixed towards white. */
  from: string
  /** Gradient end: --primary. */
  to: string
  /** The package outline: --primary-foreground. */
  glyph: string
}

export const ICON_PX = 256

const HEX = /^#[0-9a-f]{6}$/

export function toHex(r: number, g: number, b: number): string {
  const part = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")
  return `#${part(r)}${part(g)}${part(b)}`
}

/** The logo as an SVG string with concrete `#rrggbb` colors (an <img> can't see CSS variables). */
export function buildLogoSvg({ from, to, glyph }: LogoColors): string {
  for (const color of [from, to, glyph]) if (!HEX.test(color)) throw new Error(`not a hex color: ${color}`)
  const paths = LOGO_GLYPH_PATHS.map((d) => `<path d="${d}"/>`).join("")
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOGO_SIZE} ${LOGO_SIZE}" width="${ICON_PX}" height="${ICON_PX}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="${LOGO_SIZE}" y2="${LOGO_SIZE}" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
    `<rect width="${LOGO_SIZE}" height="${LOGO_SIZE}" rx="${LOGO_TILE_RADIUS}" fill="url(#g)"/>` +
    `<g transform="scale(${LOGO_GLYPH_SCALE})" fill="none" stroke="${glyph}" stroke-width="${LOGO_GLYPH_STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round">` +
    `${paths}<polyline points="${LOGO_GLYPH_POLYLINE}"/></g></svg>`
  )
}

/** The CSS for the gradient's start, built from the resolved primary the way PackratLogo does. */
export function gradientStartCss(primary: string): string {
  return `color-mix(in oklch, ${primary}, white ${LOGO_GRADIENT_WHITE_PERCENT}%)`
}

/**
 * Resolves any CSS color the webview understands (oklch, color-mix, var-resolved values) to
 * `#rrggbb` by painting one pixel on a canvas: getComputedStyle keeps oklch() as written, so only
 * the canvas hands back sRGB. Null when the value isn't a color or there is no canvas.
 */
export function resolveColor(css: string): string | null {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
  if (!ctx) return null
  // An invalid color leaves fillStyle unchanged, so a sentinel tells "rejected" from a real color.
  ctx.fillStyle = "#010203"
  ctx.fillStyle = css
  if (ctx.fillStyle === "#010203") return null
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillRect(0, 0, 1, 1)
  const data = ctx.getImageData(0, 0, 1, 1).data
  return toHex(data[0] ?? 0, data[1] ?? 0, data[2] ?? 0)
}

/** Reads the current accent from <html>; null when a color can't be resolved (leave the icon alone). */
export function readLogoColors(): LogoColors | null {
  const style = getComputedStyle(document.documentElement)
  const primary = style.getPropertyValue("--primary").trim()
  const foreground = style.getPropertyValue("--primary-foreground").trim()
  if (!primary || !foreground) return null
  const to = resolveColor(primary)
  const from = resolveColor(gradientStartCss(primary))
  const glyph = resolveColor(foreground)
  return from && to && glyph ? { from, to, glyph } : null
}

/** SVG -> PNG bytes through an <img> and a canvas. The one step that needs a real browser. */
export async function renderLogoPng(colors: LogoColors): Promise<number[]> {
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildLogoSvg(colors))}`
  const img = new Image(ICON_PX, ICON_PX)
  img.src = url
  await img.decode()
  const canvas = document.createElement("canvas")
  canvas.width = ICON_PX
  canvas.height = ICON_PX
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("no canvas")
  ctx.drawImage(img, 0, 0, ICON_PX, ICON_PX)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
  if (!blob) throw new Error("PNG encoding failed")
  // A plain array is what Tauri's JSON IPC turns into a Rust Vec<u8>.
  return Array.from(new Uint8Array(await blob.arrayBuffer()))
}

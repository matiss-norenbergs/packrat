import { describe, expect, it } from "vitest"
import rawCss from "./globals.css?raw"

// Contrast regression test for the color tokens in globals.css (WCAG 2.x): 4.5:1 for normal text, 3:1 for
// non-text UI (focus ring, form-control edges). Parses the tokens straight from the stylesheet, resolves
// var()/color-mix(in oklab)/alpha, composites translucent layers over the real surface and measures the ratio, so a
// token edit that drops a pair below its target fails here. Targets and rationale: docs/architecture.md → "Color contrast".

type RGBA = [number, number, number, number]
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, "")

const blocks: Record<string, Record<string, string>> = {}
{
  const re = /(^|\})\s*(:root|(?:\.dark)?(?:\[data-accent="[a-z]+"\])?)\s*\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css))) {
    re.lastIndex = m.index + m[0].length - 1
    const sel = m[2].trim()
    if (!sel) continue
    const vars: Record<string, string> = {}
    for (const d of m[3].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[d[1]] = d[2].trim()
    blocks[sel] = { ...(blocks[sel] ?? {}), ...vars }
  }
}

const ACCENTS = ["default", "blue", "red", "green", "yellow", "mono"] as const
type Mode = "light" | "dark"

function tokens(mode: Mode, accent: string) {
  const t = { ...blocks[":root"] }
  if (mode === "dark") Object.assign(t, blocks[".dark"])
  if (accent !== "default") {
    Object.assign(t, blocks[`[data-accent="${accent}"]`])
    if (mode === "dark") Object.assign(t, blocks[`.dark[data-accent="${accent}"]`])
  }
  return t
}

function oklchToRgb(L: number, C: number, h: number): [number, number, number] {
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
  return lin.map((x) => {
    x = Math.min(1, Math.max(0, x))
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
  }) as [number, number, number]
}
const toLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
function rgbToOklab([r, g, b]: number[]) {
  const [R, G, B] = [toLinear(r), toLinear(g), toLinear(b)]
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
function mixOklab(p: RGBA, q: RGBA, t: number): RGBA {
  const A = rgbToOklab(p)
  const B = rgbToOklab(q)
  const [L, a, b] = A.map((v, i) => v * (1 - t) + B[i] * t)
  return [...oklchToRgb(L, Math.hypot(a, b), (Math.atan2(b, a) * 180) / Math.PI), 1] as RGBA
}

function color(t: Record<string, string>, key: string): RGBA {
  const v = t[key]
  if (v === undefined) throw new Error(`token --${key} missing`)
  return parse(t, v)
}
function parse(t: Record<string, string>, v: string): RGBA {
  let m = v.match(/^var\(--([\w-]+)\)$/)
  if (m) return color(t, m[1])
  m = v.match(/^color-mix\(in oklab,\s*(var\(--[\w-]+\)|black|white)(?:\s+(\d+)%)?,\s*(var\(--[\w-]+\)|black|white)\s+(\d+)%\)$/)
  if (m) {
    const side = (s: string): RGBA => (s === "black" ? [0, 0, 0, 1] : s === "white" ? [1, 1, 1, 1] : parse(t, s))
    return mixOklab(side(m[1]), side(m[3]), +m[4] / 100)
  }
  m = v.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)%)?\s*\)$/)
  if (m) return [...oklchToRgb(+m[1], +m[2], +m[3]), m[4] ? +m[4] / 100 : 1] as RGBA
  throw new Error(`unsupported color ${v}`)
}
const over = (fg: RGBA, bg: RGBA, alpha = fg[3]): RGBA => [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha)).concat(1) as RGBA
const lum = ([r, g, b]: number[]) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
function ratio(a: RGBA, b: RGBA) {
  const x = lum(a)
  const y = lum(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

const MODES: Mode[] = ["light", "dark"]

describe("color contrast (globals.css tokens)", () => {
  describe.each(MODES)("%s mode", (mode) => {
    // Status text on the page, on a card and on its own tint (Badge/destructive Button: /10 light, /20 dark;
    // light hover tint /15, dark hover /20 for the badge anchors).
    it.each(["success", "warning", "destructive"])("%s text >= 4.5:1 on the page and on its tint", (s) => {
      const t = tokens(mode, "default")
      const text = color(t, `${s}-text`)
      const fill = color(t, s)
      const tints = mode === "light" ? [0.1, 0.15] : [0.2]
      for (const surface of [color(t, "background"), color(t, "card")]) {
        expect(ratio(text, surface)).toBeGreaterThanOrEqual(4.5)
        for (const a of tints) expect(ratio(text, over(fill, surface, a))).toBeGreaterThanOrEqual(4.5)
      }
    })

    it.each(ACCENTS)("%s: primary button label >= 4.5:1, resting and hover", (accent) => {
      const t = tokens(mode, accent)
      const label = color(t, "primary-foreground")
      expect(ratio(label, color(t, "primary"))).toBeGreaterThanOrEqual(4.5)
      expect(ratio(label, color(t, "primary-hover"))).toBeGreaterThanOrEqual(4.5)
    })

    it.each(ACCENTS)("%s: focus ring >= 3:1 on page, card and popover", (accent) => {
      const t = tokens(mode, accent)
      const ring = color(t, "ring")
      for (const s of ["background", "card", "popover"]) expect(ratio(ring, color(t, s))).toBeGreaterThanOrEqual(3)
    })

    it("form-control borders >= 3:1 on page, card and popover", () => {
      const t = tokens(mode, "default")
      for (const s of ["background", "card", "popover"]) {
        const surface = color(t, s)
        expect(ratio(over(color(t, "control"), surface), surface)).toBeGreaterThanOrEqual(3)
      }
    })

    it("--border stays a soft decorative edge (not turned into a control border)", () => {
      const t = tokens(mode, "default")
      const surface = color(t, "card")
      expect(ratio(over(color(t, "border"), surface), surface)).toBeLessThan(3)
    })
  })
})

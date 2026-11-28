import { describe, expect, it, vi } from "vitest"
import { buildLogoSvg, gradientStartCss, ICON_PX, resolveColor, toHex } from "@/lib/appIcon"
import { LOGO_GLYPH_PATHS, LOGO_GLYPH_POLYLINE } from "@/lib/logoShape"

const colors = { from: "#a855f7", to: "#7e14ff", glyph: "#fafafa" }

describe("toHex", () => {
  it("pads, rounds and clamps channels", () => {
    expect(toHex(0, 0, 0)).toBe("#000000")
    expect(toHex(255, 128.4, 7)).toBe("#ff8007")
    expect(toHex(300, -5, 15.6)).toBe("#ff0010")
  })
})

describe("buildLogoSvg", () => {
  it("uses the given colors and the shared logo shapes", () => {
    const svg = buildLogoSvg(colors)
    expect(svg).toContain('stop-color="#a855f7"')
    expect(svg).toContain('stop-color="#7e14ff"')
    expect(svg).toContain('stroke="#fafafa"')
    expect(svg).toContain(`width="${ICON_PX}"`)
    for (const d of LOGO_GLYPH_PATHS) expect(svg).toContain(`d="${d}"`)
    expect(svg).toContain(`points="${LOGO_GLYPH_POLYLINE}"`)
    // An <img> can't see CSS variables or color-mix.
    expect(svg).not.toContain("var(")
    expect(svg).not.toContain("color-mix")
  })

  it("refuses anything but a hex color, so nothing else can reach the markup", () => {
    expect(() => buildLogoSvg({ ...colors, glyph: "oklch(0.5 0.1 20)" })).toThrow()
    expect(() => buildLogoSvg({ ...colors, from: '#fff"/><script' })).toThrow()
  })
})

describe("gradientStartCss", () => {
  it("mixes the primary towards white the way PackratLogo does", () => {
    expect(gradientStartCss("oklch(0.534 0.288 293)")).toBe("color-mix(in oklch, oklch(0.534 0.288 293), white 18%)")
  })
})

describe("resolveColor", () => {
  it("is null where there is no canvas (jsdom)", () => {
    // The real conversion needs a browser canvas; it is checked in the desktop shell's webview.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
    expect(resolveColor("oklch(0.534 0.288 293)")).toBeNull()
  })
})

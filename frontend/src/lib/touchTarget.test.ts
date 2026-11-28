import { describe, expect, it } from "vitest"
import { TOUCH_HIT_AREA, TOUCH_REVEAL, touchHitArea, touchRevealedHitArea, type TouchHitSize } from "./touchTarget"

// Tailwind only emits classes it finds as literal strings, so each size is spelled out; this pins the arithmetic
// ((44 - size) / 2) so a size can't silently get the wrong inset.
const INSET: Record<TouchHitSize, string> = { 16: "-inset-3.5", 20: "-inset-3.5", 24: "-inset-2.5", 26: "-inset-[9px]" }

describe("touch hit areas", () => {
  it.each(Object.entries(INSET))("a %s px control gets a 44 px ::after (inset %s)", (size, inset) => {
    const cls = touchHitArea(Number(size) as TouchHitSize)
    expect(cls).toContain(`pointer-coarse:after:${inset}`)
    expect(cls).toContain("pointer-coarse:after:absolute")
    expect(cls).toContain("pointer-coarse:after:content-['']")
  })

  it("every class is a pointer-coarse variant, and the sized helper never adds `relative` (it would override `absolute`)", () => {
    for (const size of Object.keys(INSET)) {
      const classes = touchRevealedHitArea(Number(size) as TouchHitSize).split(" ")
      expect(classes.every((c) => c.startsWith("pointer-coarse:"))).toBe(true)
      expect(classes).not.toContain("pointer-coarse:relative")
    }
    expect(TOUCH_HIT_AREA).toContain("pointer-coarse:relative")
  })

  it("reveals on touch only, and keeps a disabled control dimmed", () => {
    expect(TOUCH_REVEAL).toContain("pointer-coarse:opacity-100")
    expect(TOUCH_REVEAL).toContain("pointer-coarse:disabled:opacity-50")
    expect(touchRevealedHitArea(26)).toContain(TOUCH_REVEAL)
  })
})

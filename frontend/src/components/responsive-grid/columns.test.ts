import { describe, expect, it } from "vitest"
import { COLUMN_PRESETS, columnsAtWidth } from "./columns"
import type { ColumnPreset } from "./columns"

// Tailwind's default `sm` and `lg` (min-width, viewport-based).
const TAILWIND_MIN_WIDTH = { base: 0, sm: 640, lg: 1024 } as const

// Reads the column rule and the gap out of a class string, the way the browser would apply them.
function parse(className: string) {
  const steps: { minWidth: number; columns: number }[] = []
  let gap: number | null = null
  for (const token of className.split(/\s+/)) {
    const cols = /^(?:(sm|lg):)?grid-cols-(\d+)$/.exec(token)
    if (cols) steps.push({ minWidth: TAILWIND_MIN_WIDTH[(cols[1] as "sm" | "lg" | undefined) ?? "base"], columns: Number(cols[2]) })
    const g = /^gap-(\d+)$/.exec(token)
    if (g) gap = Number(g[1]) * 4
  }
  return { steps: steps.sort((a, b) => a.minWidth - b.minWidth), gap }
}

describe.each(Object.entries(COLUMN_PRESETS))("preset %s", (_name, preset: ColumnPreset) => {
  it("is a grid whose class string and breakpoint table agree", () => {
    expect(preset.className.split(/\s+/)).toContain("grid")
    const { steps, gap } = parse(preset.className)
    expect(steps).toEqual(preset.breakpoints)
    expect(gap).toBe(preset.gap)
  })

  it("starts at width 0 and ascends", () => {
    expect(preset.breakpoints[0].minWidth).toBe(0)
    const widths = preset.breakpoints.map((b) => b.minWidth)
    expect(widths).toEqual([...widths].sort((a, b) => a - b))
  })
})

describe("the presets' values", () => {
  it("library is 2 / 3 / 4 with a 16px gap", () => {
    expect(COLUMN_PRESETS.library.breakpoints.map((b) => b.columns)).toEqual([2, 3, 4])
    expect(COLUMN_PRESETS.library.gap).toBe(16)
  })
  it("gallery is 2 / 4 / 6 with a 12px gap", () => {
    expect(COLUMN_PRESETS.gallery.breakpoints.map((b) => b.columns)).toEqual([2, 4, 6])
    expect(COLUMN_PRESETS.gallery.gap).toBe(12)
  })
})

describe("columnsAtWidth", () => {
  it.each([
    [0, 2],
    [390, 2],
    [639, 2],
    [640, 3],
    [1023, 3],
    [1024, 4],
    [1920, 4],
  ])("library at %ipx has %i columns", (width, columns) => {
    expect(columnsAtWidth(COLUMN_PRESETS.library, width)).toBe(columns)
  })
  it("gallery switches at the same widths", () => {
    expect([639, 640, 1023, 1024].map((w) => columnsAtWidth(COLUMN_PRESETS.gallery, w))).toEqual([2, 4, 4, 6])
  })
})

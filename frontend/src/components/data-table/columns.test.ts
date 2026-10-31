import { describe, expect, it } from "vitest"
import { MAX_COLUMN_WIDTH, clampColumnWidth, computeLayout, effectiveColumnWidth, isResizable } from "./columns"
import type { ColumnDef } from "./types"

const col = (over: Partial<ColumnDef<unknown>> & { key: string }): ColumnDef<unknown> => ({ header: over.key, cell: () => null, ...over })

describe("isResizable", () => {
  it("is true for ordinary columns and false for flex, icon and switch columns", () => {
    expect(isResizable(col({ key: "a" }))).toBe(true)
    expect(isResizable(col({ key: "a", type: "number" }))).toBe(true)
    expect(isResizable(col({ key: "a", flex: true }))).toBe(false)
    expect(isResizable(col({ key: "a", type: "icon" }))).toBe(false)
    expect(isResizable(col({ key: "a", type: "switch" }))).toBe(false)
  })

  it("lets `resizable` override the default either way", () => {
    expect(isResizable(col({ key: "a", flex: true, resizable: true }))).toBe(true)
    expect(isResizable(col({ key: "a", type: "icon", resizable: true }))).toBe(true)
    expect(isResizable(col({ key: "a", resizable: false }))).toBe(false)
  })
})

describe("effectiveColumnWidth", () => {
  it("is the column's own width without an override", () => {
    expect(effectiveColumnWidth(col({ key: "a", width: 150 }))).toBe(150)
    expect(effectiveColumnWidth(col({ key: "a", type: "date" }), {})).toBe(180)
  })

  it("uses the override, raised to the minWidth (explicit or 48) and capped at 2000", () => {
    expect(effectiveColumnWidth(col({ key: "a" }), { a: 320 })).toBe(320)
    expect(effectiveColumnWidth(col({ key: "a" }), { a: 10 })).toBe(48)
    expect(effectiveColumnWidth(col({ key: "a", minWidth: 90 }), { a: 60 })).toBe(90)
    expect(effectiveColumnWidth(col({ key: "a" }), { a: 5000 })).toBe(MAX_COLUMN_WIDTH)
  })

  it("ignores an override of a column that is not resizable", () => {
    expect(effectiveColumnWidth(col({ key: "a", width: 100, flex: true }), { a: 400 })).toBe(100)
    expect(effectiveColumnWidth(col({ key: "a", type: "icon" }), { a: 400 })).toBe(64)
    expect(effectiveColumnWidth(col({ key: "a", width: 100, resizable: false }), { a: 400 })).toBe(100)
    expect(effectiveColumnWidth(col({ key: "a", width: 100, resizable: true, flex: true }), { a: 400 })).toBe(400)
  })

  it("never goes below 24 px, even for a column with a tiny minWidth", () => {
    expect(effectiveColumnWidth(col({ key: "a", minWidth: 10 }), { a: 5 })).toBe(24)
  })

  it("rounds a fractional width", () => {
    expect(clampColumnWidth(col({ key: "a" }), 200.6)).toBe(201)
  })
})

describe("computeLayout with width overrides", () => {
  it("uses the overrides for the colgroup and the min-width sum", () => {
    const cols = [col({ key: "a", width: 100 }), col({ key: "b", width: 100 }), col({ key: "c", type: "icon" })]
    const layout = computeLayout(cols, 32, { a: 300, c: 500, ghost: 900 })
    expect(layout.colWidths).toEqual([300, 100, 64])
    expect(layout.minWidth).toBe(32 + 300 + 100 + 64)
    expect(layout.filler).toBe(true)
  })

  it("leaves a flex column without a colgroup width, whatever is stored for it", () => {
    const layout = computeLayout([col({ key: "a", width: 100 }), col({ key: "f", width: 150, flex: true })], null, { f: 700 })
    expect(layout.colWidths).toEqual([100, undefined])
    expect(layout.minWidth).toBe(250)
    expect(layout.filler).toBe(false)
  })
})

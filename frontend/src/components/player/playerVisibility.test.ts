import { describe, expect, it } from "vitest"
import { computeShowBar, inHotZone, isPointerOnBar, pointInRect } from "./playerVisibility"

const frame = { left: 0, top: 0, right: 1000, bottom: 600 }
const bar = { left: 12, top: 520, right: 988, bottom: 588 }

describe("pointInRect", () => {
  it("is inclusive of the edges and exclusive outside", () => {
    expect(pointInRect(12, 520, bar)).toBe(true)
    expect(pointInRect(988, 588, bar)).toBe(true)
    expect(pointInRect(11, 540, bar)).toBe(false)
    expect(pointInRect(500, 519, bar)).toBe(false)
  })
  it("treats a missing or empty rect as containing nothing (jsdom, hidden elements)", () => {
    expect(pointInRect(0, 0, null)).toBe(false)
    expect(pointInRect(0, 0, undefined)).toBe(false)
    expect(pointInRect(0, 0, { left: 0, top: 0, right: 0, bottom: 0 })).toBe(false)
  })
})

describe("inHotZone", () => {
  it("covers the bottom fraction of the frame only", () => {
    expect(inHotZone(500, 480, frame, 0.2)).toBe(true) // 600 - 120
    expect(inHotZone(500, 479, frame, 0.2)).toBe(false)
    expect(inHotZone(500, 600, frame, 0.2)).toBe(true)
    expect(inHotZone(1001, 590, frame, 0.2)).toBe(false)
  })
  it("is off for fraction 0 and empty frames", () => {
    expect(inHotZone(500, 599, frame, 0)).toBe(false)
    expect(inHotZone(5, 5, { left: 0, top: 0, right: 0, bottom: 0 }, 0.2)).toBe(false)
    expect(inHotZone(5, 5, null, 0.2)).toBe(false)
  })
})

describe("isPointerOnBar", () => {
  it("is true over the bar or in the hot zone, false elsewhere", () => {
    expect(isPointerOnBar(500, 550, bar, frame, 0.2)).toBe(true)
    expect(isPointerOnBar(5, 500, bar, frame, 0.2)).toBe(true) // hot zone, left of the bar
    expect(isPointerOnBar(500, 300, bar, frame, 0.2)).toBe(false)
  })
  it("still works when the bar is hidden (zero rect) via the hot zone", () => {
    expect(isPointerOnBar(500, 590, null, frame, 0.2)).toBe(true)
  })
})

describe("computeShowBar", () => {
  const base = { overlay: true, paused: false, active: false, pointerOnBar: false, menuOpen: false, keyboardFocus: false }
  it("hides only when playing, idle and nothing else holds it", () => {
    expect(computeShowBar(base)).toBe(false)
  })
  it.each(["paused", "active", "pointerOnBar", "menuOpen", "keyboardFocus"] as const)("is shown while %s", (k) => {
    expect(computeShowBar({ ...base, [k]: true })).toBe(true)
  })
  it("is always shown when not an overlay", () => {
    expect(computeShowBar({ ...base, overlay: false })).toBe(true)
  })
})

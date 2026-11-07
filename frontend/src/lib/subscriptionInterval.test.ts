import { describe, expect, it } from "vitest"
import { clampIntervalHours } from "./subscriptionInterval"

describe("clampIntervalHours", () => {
  it("keeps in-range values", () => {
    expect(clampIntervalHours(6)).toBe(6)
    expect(clampIntervalHours(8760)).toBe(8760)
  })
  it("clamps out-of-range and invalid values", () => {
    expect(clampIntervalHours(0)).toBe(1)
    expect(clampIntervalHours(-4)).toBe(1)
    expect(clampIntervalHours(99999)).toBe(8760)
    expect(clampIntervalHours(Number.NaN)).toBe(1)
  })
})

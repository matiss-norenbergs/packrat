import { describe, expect, it } from "vitest"
import { formatTimeAgo } from "@/lib/timeAgo"

const NOW = new Date("2026-10-23T12:00:00Z")
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const MIN = 60_000

describe("formatTimeAgo", () => {
  it("rounds down to the largest unit", () => {
    expect(formatTimeAgo(ago(20_000), NOW)).toBe("Just now")
    expect(formatTimeAgo(ago(5 * MIN + 30_000), NOW)).toBe("5 min ago")
    expect(formatTimeAgo(ago(3 * 60 * MIN), NOW)).toBe("3 h ago")
    expect(formatTimeAgo(ago(2 * 24 * 60 * MIN), NOW)).toBe("2 d ago")
  })

  it("treats a timestamp slightly in the future (clock skew) as just now", () => {
    expect(formatTimeAgo(ago(-5_000), NOW)).toBe("Just now")
  })

  it("falls back to the date after a month", () => {
    const old = ago(45 * 24 * 60 * MIN)
    expect(formatTimeAgo(old, NOW)).toBe(new Date(old).toLocaleDateString())
  })
})

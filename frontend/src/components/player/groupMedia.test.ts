import { describe, expect, it, vi } from "vitest"
import {
  allMuted,
  formatPercent,
  globalSeekPercentTarget,
  globalSeekTarget,
  parseSyncMode,
  percentPosition,
  rafThrottle,
  referenceIndex,
  relativeSeekDelta,
  summarizeGroup,
  type GroupSnapshot,
} from "./groupMedia"

const snap = (o: Partial<GroupSnapshot> = {}): GroupSnapshot => ({ paused: true, ended: false, currentTime: 0, duration: 10, ...o })

describe("globalSeekTarget", () => {
  it("uses the same absolute time, clamped to each item's own duration", () => {
    expect(globalSeekTarget(8, 20)).toBe(8)
    expect(globalSeekTarget(8, 5)).toBe(5) // a shorter item stops at its end
    expect(globalSeekTarget(-3, 5)).toBe(0)
  })
  it("skips items whose duration is not known yet", () => {
    expect(globalSeekTarget(8, NaN)).toBeNull()
    expect(globalSeekTarget(8, 0)).toBeNull()
    expect(globalSeekTarget(8, Infinity)).toBeNull()
  })
})

describe("globalSeekPercentTarget", () => {
  it("maps the same fraction onto each item's own duration", () => {
    expect(globalSeekPercentTarget(0.5, 60)).toBe(30)
    expect(globalSeekPercentTarget(0.5, 120)).toBe(60)
    expect(globalSeekPercentTarget(0, 60)).toBe(0)
    expect(globalSeekPercentTarget(1, 60)).toBe(60)
  })
  it("clamps the fraction to 0..1, so it never goes past an item's end", () => {
    expect(globalSeekPercentTarget(1.5, 60)).toBe(60)
    expect(globalSeekPercentTarget(-0.2, 60)).toBe(0)
    expect(globalSeekPercentTarget(Infinity, 60)).toBe(60)
  })
  it("skips items whose duration is unknown, NaN or Infinity, and an unusable fraction", () => {
    expect(globalSeekPercentTarget(0.5, NaN)).toBeNull()
    expect(globalSeekPercentTarget(0.5, Infinity)).toBeNull()
    expect(globalSeekPercentTarget(0.5, 0)).toBeNull()
    expect(globalSeekPercentTarget(NaN, 60)).toBeNull()
  })
})

describe("percentPosition / formatPercent / parseSyncMode", () => {
  it("is the fraction of the element's own duration, 0 while unknown", () => {
    expect(percentPosition(15, 60)).toBe(0.25)
    expect(percentPosition(90, 60)).toBe(1)
    expect(percentPosition(15, NaN)).toBe(0)
    expect(percentPosition(15, 0)).toBe(0)
  })
  it("formats a fraction as a whole percent", () => {
    expect(formatPercent(0.42)).toBe("42%")
    expect(formatPercent(0.999)).toBe("100%")
    expect(formatPercent(NaN)).toBe("0%")
  })
  it("defaults to time unless the stored value is exactly percent", () => {
    expect(parseSyncMode(null)).toBe("time")
    expect(parseSyncMode("percent")).toBe("percent")
    expect(parseSyncMode("time")).toBe("time")
    expect(parseSyncMode("PERCENT")).toBe("time")
    expect(parseSyncMode("garbage")).toBe("time")
  })
})

describe("referenceIndex / summarizeGroup", () => {
  it("picks the first playing element, else the first", () => {
    expect(referenceIndex([])).toBe(-1)
    expect(referenceIndex([snap(), snap()])).toBe(0)
    expect(referenceIndex([snap(), snap({ paused: false }), snap({ paused: false })])).toBe(1)
    expect(referenceIndex([snap({ paused: false, ended: true }), snap()])).toBe(0) // an ended element is not playing
  })
  it("reports any-playing, the longest known duration and the reference position", () => {
    const s = summarizeGroup([snap({ currentTime: 1, duration: 10 }), snap({ paused: false, currentTime: 4, duration: 30 }), snap({ duration: NaN })])
    expect(s).toEqual({ anyPlaying: true, duration: 30, currentTime: 4, referenceDuration: 30 })
    expect(summarizeGroup([snap({ currentTime: 2 })])).toEqual({ anyPlaying: false, duration: 10, currentTime: 2, referenceDuration: 10 })
    expect(summarizeGroup([])).toEqual({ anyPlaying: false, duration: 0, currentTime: 0, referenceDuration: 0 })
    expect(summarizeGroup([snap({ duration: NaN })]).duration).toBe(0)
  })
  it("the reference duration is the reference element's own, 0 while unknown", () => {
    expect(summarizeGroup([snap({ duration: 10 }), snap({ duration: 60 })]).referenceDuration).toBe(10)
    expect(summarizeGroup([snap({ duration: NaN }), snap({ duration: 60 })]).referenceDuration).toBe(0)
    expect(summarizeGroup([snap({ duration: Infinity })]).referenceDuration).toBe(0)
  })
  it("is not playing once every element is paused or ended", () => {
    expect(summarizeGroup([snap({ paused: false, ended: true }), snap()]).anyPlaying).toBe(false)
  })
})

describe("relativeSeekDelta / allMuted", () => {
  it("steps 5 s, or 10 s with Shift, in either direction", () => {
    expect(relativeSeekDelta(1, false, 5, 10)).toBe(5)
    expect(relativeSeekDelta(-1, false, 5, 10)).toBe(-5)
    expect(relativeSeekDelta(-1, true, 5, 10)).toBe(-10)
  })
  it("allMuted needs at least one element and all muted", () => {
    expect(allMuted([])).toBe(false)
    expect(allMuted([true, false])).toBe(false)
    expect(allMuted([true, true])).toBe(true)
  })
})

describe("rafThrottle", () => {
  it("applies the first call at once and coalesces the rest into one trailing call per frame", () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const t = rafThrottle(fn)
    t.call(1)
    t.call(2)
    t.call(3)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenLastCalledWith(1)
    vi.advanceTimersByTime(50)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith(3)
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(2)
  })
  it("cancel drops the pending call", () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const t = rafThrottle(fn)
    t.call(1)
    t.call(2)
    t.cancel()
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

import { afterEach, describe, expect, it, vi } from "vitest"
import { allMuted, globalSeekTarget, rafThrottle, referenceIndex, relativeSeekDelta, summarizeGroup, type GroupSnapshot } from "./groupMedia"

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

describe("referenceIndex / summarizeGroup", () => {
  it("picks the first playing element, else the first", () => {
    expect(referenceIndex([])).toBe(-1)
    expect(referenceIndex([snap(), snap()])).toBe(0)
    expect(referenceIndex([snap(), snap({ paused: false }), snap({ paused: false })])).toBe(1)
    expect(referenceIndex([snap({ paused: false, ended: true }), snap()])).toBe(0) // an ended element is not playing
  })
  it("reports any-playing, the longest known duration and the reference position", () => {
    const s = summarizeGroup([snap({ currentTime: 1, duration: 10 }), snap({ paused: false, currentTime: 4, duration: 30 }), snap({ duration: NaN })])
    expect(s).toEqual({ anyPlaying: true, duration: 30, currentTime: 4 })
    expect(summarizeGroup([snap({ currentTime: 2 })])).toEqual({ anyPlaying: false, duration: 10, currentTime: 2 })
    expect(summarizeGroup([])).toEqual({ anyPlaying: false, duration: 0, currentTime: 0 })
    expect(summarizeGroup([snap({ duration: NaN })]).duration).toBe(0)
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
  afterEach(() => vi.useRealTimers())
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

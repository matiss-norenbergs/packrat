import { describe, expect, it } from "vitest"
import {
  bufferedFractions,
  describeMediaError,
  digitToTime,
  formatSpeed,
  formatTime,
  pointerFraction,
  pointerToTime,
  seekBy,
  seekValueText,
  spokenDuration,
  stepSpeed,
  stepVolume,
} from "./playerMath"
import { PLAYER_SPEEDS } from "./playerTheme"

describe("formatTime", () => {
  it("formats minutes and hours", () => {
    expect(formatTime(0)).toBe("0:00")
    expect(formatTime(83)).toBe("1:23")
    expect(formatTime(2710)).toBe("45:10")
    expect(formatTime(3725)).toBe("1:02:05")
  })
  it("floors fractions and survives bad input", () => {
    expect(formatTime(59.9)).toBe("0:59")
    expect(formatTime(NaN)).toBe("0:00")
    expect(formatTime(Infinity)).toBe("0:00")
    expect(formatTime(-4)).toBe("0:00")
  })
})

describe("spoken text", () => {
  it("speaks durations", () => {
    expect(spokenDuration(83)).toBe("1 minute 23 seconds")
    expect(spokenDuration(2700)).toBe("45 minutes")
    expect(spokenDuration(3601)).toBe("1 hour 1 second")
    expect(spokenDuration(0)).toBe("0 seconds")
  })
  it("builds aria-valuetext", () => {
    expect(seekValueText(83, 2700)).toBe("1 minute 23 seconds of 45 minutes")
    expect(seekValueText(12, NaN)).toBe("12 seconds")
  })
})

describe("pointer mapping", () => {
  it("maps and clamps", () => {
    expect(pointerFraction(150, 100, 200)).toBe(0.25)
    expect(pointerFraction(50, 100, 200)).toBe(0)
    expect(pointerFraction(999, 100, 200)).toBe(1)
    expect(pointerFraction(150, 100, 0)).toBe(0)
  })
  it("flips for RTL", () => {
    expect(pointerFraction(150, 100, 200, true)).toBe(0.75)
    expect(pointerFraction(50, 100, 200, true)).toBe(1)
  })
  it("converts to time, 0 while the duration is unknown", () => {
    expect(pointerToTime(200, 100, 200, 60)).toBe(30)
    expect(pointerToTime(200, 100, 200, NaN)).toBe(0)
    expect(pointerToTime(100, 100, 200, 60, true)).toBe(60)
  })
})

describe("stepping", () => {
  it("clamps seeks", () => {
    expect(seekBy(3, -5, 100)).toBe(0)
    expect(seekBy(98, 5, 100)).toBe(100)
    expect(seekBy(10, 5, NaN)).toBe(15)
  })
  it("maps digits to tenths", () => {
    expect(digitToTime(5, 200)).toBe(100)
    expect(digitToTime(0, 200)).toBe(0)
    expect(digitToTime(9, NaN)).toBe(0)
  })
  it("steps volume without float drift or overshoot", () => {
    expect(stepVolume(0.1, 1, 0.05)).toBe(0.15)
    expect(stepVolume(0.98, 1, 0.05)).toBe(1)
    expect(stepVolume(0.02, -1, 0.05)).toBe(0)
  })
  it("steps speed through the list and stops at the ends", () => {
    expect(stepSpeed(1, 1, PLAYER_SPEEDS)).toBe(1.25)
    expect(stepSpeed(1, -1, PLAYER_SPEEDS)).toBe(0.75)
    expect(stepSpeed(2, 1, PLAYER_SPEEDS)).toBe(2)
    expect(stepSpeed(0.5, -1, PLAYER_SPEEDS)).toBe(0.5)
    expect(stepSpeed(1.1, 1, PLAYER_SPEEDS)).toBe(1.25)
    expect(stepSpeed(1.1, -1, PLAYER_SPEEDS)).toBe(1)
  })
  it("formats speed", () => {
    expect(formatSpeed(1)).toBe("1×")
    expect(formatSpeed(1.25)).toBe("1.25×")
  })
})

describe("misc", () => {
  it("turns buffered ranges into fractions", () => {
    const r = { length: 2, start: (i: number) => [0, 50][i], end: (i: number) => [10, 80][i] }
    expect(bufferedFractions(r, 100)).toEqual([[0, 0.1], [0.5, 0.8]])
    expect(bufferedFractions(r, NaN)).toEqual([])
    expect(bufferedFractions(null, 100)).toEqual([])
  })
  it("describes media errors", () => {
    expect(describeMediaError({ code: 4 })).toMatch(/format or codec/)
    expect(describeMediaError({ code: 2 })).toMatch(/network/)
    expect(describeMediaError({ code: 0, message: "boom" })).toBe("boom")
    expect(describeMediaError(null)).toBe("")
  })
})

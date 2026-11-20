import { describe, expect, it } from "vitest"
import { appendTransition, consoleLine, describeBar, formatTransition, opacityBucket, parsePlayerDebug, type TransitionEntry } from "./playerDiagnostics"

describe("parsePlayerDebug", () => {
  it("is off without the parameter or with anything else", () => {
    expect(parsePlayerDebug("")).toBe("off")
    expect(parsePlayerDebug("?playerFx=layer")).toBe("off")
    expect(parsePlayerDebug("?playerDebug=")).toBe("off")
    expect(parsePlayerDebug("?playerDebug=0")).toBe("off")
    expect(parsePlayerDebug("?playerDebug=true")).toBe("off")
  })
  it("reads 1 as the box and log as console logging", () => {
    expect(parsePlayerDebug("?playerDebug=1")).toBe("box")
    expect(parsePlayerDebug("?playerDebug=log")).toBe("log")
    expect(parsePlayerDebug("?playerDebug=%20LOG%20&playerFx=blur")).toBe("log")
  })
})

describe("transition log", () => {
  it("stamps entries relative to the first one and keeps the last N", () => {
    let entries: TransitionEntry[] = []
    let t0: number | null = null
    for (let i = 0; i < 15; i++) {
      const r = appendTransition(entries, `e${i}`, 1000 + i * 10.4, t0, 12)
      entries = r.entries
      t0 = r.t0
    }
    expect(entries).toHaveLength(12)
    expect(entries[0]).toEqual({ at: 31, text: "e3" })
    expect(entries[11]).toEqual({ at: 146, text: "e14" })
  })
  it("formats for the box and for the console", () => {
    expect(formatTransition({ at: 42, text: "showBar=true" })).toBe("    42ms showBar=true")
    expect(consoleLine({ at: 42, text: "showBar=true" })).toBe("[player] 42ms showBar=true")
  })
  it("buckets opacity and describes the bar", () => {
    expect(opacityBucket(0)).toBe("0")
    expect(opacityBucket(0.4)).toBe("fading")
    expect(opacityBucket(1)).toBe("1")
    expect(describeBar("true", 1, "visible")).toBe("dom=true opacity=1 visibility=visible")
  })
})

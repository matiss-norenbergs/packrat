import { describe, expect, it } from "vitest"
import { findUnreasonedDisables } from "./check-disable-reasons.mjs"

describe("findUnreasonedDisables", () => {
  it("accepts a directive with a reason", () => {
    expect(findUnreasonedDisables("// eslint-disable-next-line react-hooks/exhaustive-deps -- runs once")).toEqual([])
    expect(findUnreasonedDisables("/* oxlint-disable no-console -- CLI output */")).toEqual([])
  })
  it("rejects a bare directive", () => {
    const hits = findUnreasonedDisables("a\n  // eslint-disable-next-line react-hooks/exhaustive-deps\nb")
    expect(hits).toHaveLength(1)
    expect(hits[0].line).toBe(2)
  })
  it("rejects an empty reason and block/line variants", () => {
    expect(findUnreasonedDisables("// eslint-disable-next-line x --")).toHaveLength(1)
    expect(findUnreasonedDisables("/* eslint-disable */")).toHaveLength(1)
    expect(findUnreasonedDisables("foo() // oxlint-disable-line no-x")).toHaveLength(1)
  })
  it("ignores code that merely mentions the word", () => {
    expect(findUnreasonedDisables('const s = "eslint-disable-next-line"')).toEqual([])
    expect(findUnreasonedDisables("// see the eslint-disable docs")).toEqual([])
  })
})

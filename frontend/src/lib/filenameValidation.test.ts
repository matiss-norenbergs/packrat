import { describe, expect, it } from "vitest"
import { invalidSegmentChars, invalidTemplateChars } from "./filenameValidation"

describe("invalidSegmentChars", () => {
  it("returns nothing for a clean name", () => {
    expect(invalidSegmentChars("valid name")).toEqual([])
  })

  it("flags a single unsafe character", () => {
    expect(invalidSegmentChars("bad:name")).toEqual([":"])
  })

  it("flags '/' here, unlike invalidTemplateChars", () => {
    expect(invalidSegmentChars("a/b")).toEqual(["/"])
  })

  it("dedupes repeated offenders, preserving first-seen order", () => {
    expect(invalidSegmentChars("a/b\\c/d")).toEqual(["/", "\\"])
  })

  it("silently drops control characters instead of listing them", () => {
    expect(invalidSegmentChars("control\x01char")).toEqual([])
  })
})

describe("invalidTemplateChars", () => {
  it("does not flag '/' — it's a legitimate segment separator here", () => {
    expect(invalidTemplateChars("{title}/{year}")).toEqual([])
  })

  it("strips a token (with modifier) before checking for unsafe chars", () => {
    expect(invalidTemplateChars("{title:2}")).toEqual([])
  })

  it("flags unsafe characters in the literal text around a token", () => {
    expect(invalidTemplateChars("{title}: bad")).toEqual([":"])
  })

  it("strips tokens case-insensitively", () => {
    expect(invalidTemplateChars("{TITLE}: bad")).toEqual([":"])
  })

  it("flags multiple distinct offenders outside of tokens", () => {
    expect(invalidTemplateChars("literal<text>{token}")).toEqual(["<", ">"])
  })

  it("treats an unterminated brace as literal text, not a token", () => {
    expect(invalidTemplateChars("{title unclosed")).toEqual([])
  })
})

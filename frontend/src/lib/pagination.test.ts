import { describe, expect, it } from "vitest"
import { getPageNumbers } from "./pagination"

describe("getPageNumbers", () => {
  it("is just [1] for a single page", () => {
    expect(getPageNumbers(1, 1)).toEqual([1])
  })

  it("lists every page when there are few", () => {
    expect(getPageNumbers(2, 3)).toEqual([1, 2, 3])
  })

  it("puts an ellipsis only where pages are skipped", () => {
    expect(getPageNumbers(1, 100)).toEqual([1, 2, "ellipsis", 100])
    expect(getPageNumbers(50, 100)).toEqual([1, "ellipsis", 49, 50, 51, "ellipsis", 100])
    expect(getPageNumbers(100, 100)).toEqual([1, "ellipsis", 99, 100])
  })

  it("does not put an ellipsis between adjacent pages", () => {
    expect(getPageNumbers(3, 5)).toEqual([1, 2, 3, 4, 5])
  })
})

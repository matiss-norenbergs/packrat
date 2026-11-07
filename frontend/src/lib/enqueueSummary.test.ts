import { describe, expect, it } from "vitest"
import { skippedSummaryParts } from "./enqueueSummary"
import type { SkippedItem } from "@/types/api"

const lib = (reason?: SkippedItem["reason"]): SkippedItem => ({
  url: "u",
  title: "t",
  libraryItemId: 1,
  blurred: false,
  reason,
})
const inBatch: SkippedItem = { url: "u", title: "u", blurred: false, reason: "duplicate_in_batch" }

describe("skippedSummaryParts", () => {
  it("is empty with nothing skipped", () => {
    expect(skippedSummaryParts([])).toEqual([])
  })
  it("treats a missing reason as a library duplicate", () => {
    expect(skippedSummaryParts([lib(), lib("in_library")])).toEqual(["2 already in library"])
  })
  it("reports in-batch duplicates separately, without needing a library item", () => {
    expect(skippedSummaryParts([lib("in_library"), inBatch, inBatch])).toEqual([
      "1 already in library",
      "2 duplicate in this batch",
    ])
  })
})

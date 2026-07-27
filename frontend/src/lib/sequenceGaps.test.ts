import { describe, expect, it } from "vitest"
import { computeSequenceGaps } from "./sequenceGaps"

describe("computeSequenceGaps", () => {
  it("returns null for fewer than two sequence-numbered items", () => {
    expect(computeSequenceGaps([])).toBeNull()
    expect(computeSequenceGaps([{ sequenceNumber: null }])).toBeNull()
    expect(computeSequenceGaps([{ sequenceNumber: 1 }])).toBeNull()
    expect(computeSequenceGaps([{ sequenceNumber: 1 }, { sequenceNumber: null }])).toBeNull()
  })

  it("reports no missing numbers for a dense sequence", () => {
    const result = computeSequenceGaps([{ sequenceNumber: 1 }, { sequenceNumber: 2 }, { sequenceNumber: 3 }])
    expect(result).toEqual({ min: 1, max: 3, used: [1, 2, 3], missing: [] })
  })

  it("finds a single gap", () => {
    const items = [1, 2, 3, 5].map((sequenceNumber) => ({ sequenceNumber }))
    expect(computeSequenceGaps(items)?.missing).toEqual([4])
  })

  it("finds multiple gaps", () => {
    const items = [1, 4, 7].map((sequenceNumber) => ({ sequenceNumber }))
    expect(computeSequenceGaps(items)?.missing).toEqual([2, 3, 5, 6])
  })

  it("dedupes duplicate sequence numbers instead of treating one as missing", () => {
    const items = [1, 1, 2, 3].map((sequenceNumber) => ({ sequenceNumber }))
    const result = computeSequenceGaps(items)
    expect(result?.used).toEqual([1, 2, 3])
    expect(result?.missing).toEqual([])
  })

  it("sorts used/missing ascending regardless of input order", () => {
    const items = [5, 1, 3].map((sequenceNumber) => ({ sequenceNumber }))
    const result = computeSequenceGaps(items)
    expect(result?.used).toEqual([1, 3, 5])
    expect(result?.missing).toEqual([2, 4])
  })
})

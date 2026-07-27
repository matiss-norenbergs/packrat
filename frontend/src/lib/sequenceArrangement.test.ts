import { describe, expect, it } from "vitest"
import {
  buildRenderNodes,
  computeDisplayNumbers,
  moveToPosition,
  normalizeHead,
  positionMap,
  seedSequenceArrangement,
  type ArrangementState,
  type SequencedEntry,
} from "./sequenceArrangement"
import type { LibraryItem } from "@/types/api"

function makeItem(overrides: Partial<LibraryItem> & { id: number }): LibraryItem {
  return {
    downloadId: null,
    title: `Item ${overrides.id}`,
    filename: `item-${overrides.id}.mp4`,
    path: "",
    collectionId: null,
    collectionName: null,
    folder: "",
    originalUrl: null,
    uploader: null,
    duration: null,
    resolution: null,
    thumbnail: null,
    thumbnailSmallPath: null,
    thumbnailMediumPath: null,
    description: null,
    artistId: null,
    artistName: null,
    year: null,
    sequenceNumber: null,
    seasonNumber: null,
    generateNfo: false,
    nfoExists: false,
    downloadedAt: "2026-01-01T00:00:00Z",
    status: "completed",
    blurred: false,
    fileSizeBytes: null,
    tags: [],
    playbackPositionSeconds: null,
    lastWatchedAt: null,
    ...overrides,
  }
}

function entry(item: LibraryItem, gapBefore = 0): SequencedEntry {
  return { item, gapBefore }
}

describe("computeDisplayNumbers", () => {
  it("numbers a dense list starting at 1", () => {
    const a = makeItem({ id: 1 })
    const b = makeItem({ id: 2 })
    expect(computeDisplayNumbers(0, [entry(a), entry(b)])).toEqual([1, 2])
  })

  it("applies a leading gap", () => {
    const a = makeItem({ id: 1 })
    expect(computeDisplayNumbers(2, [entry(a)])).toEqual([3])
  })

  it("applies an interior gap", () => {
    const a = makeItem({ id: 1 })
    const b = makeItem({ id: 2 })
    expect(computeDisplayNumbers(0, [entry(a), entry(b, 2)])).toEqual([1, 4])
  })

  it("combines leading and interior gaps", () => {
    const a = makeItem({ id: 1 })
    const b = makeItem({ id: 2 })
    expect(computeDisplayNumbers(1, [entry(a), entry(b, 1)])).toEqual([2, 4])
  })

  it("returns an empty array for an empty list", () => {
    expect(computeDisplayNumbers(0, [])).toEqual([])
  })
})

describe("seedSequenceArrangement", () => {
  it("orders sequenced items ascending and infers gaps between them", () => {
    const items = [
      makeItem({ id: 1, sequenceNumber: 5 }),
      makeItem({ id: 2, sequenceNumber: 1 }),
      makeItem({ id: 3, sequenceNumber: 3 }),
    ]
    const result = seedSequenceArrangement(items)
    expect(result.leadingGap).toBe(0)
    expect(result.sequencedList.map((e) => e.item.id)).toEqual([2, 3, 1])
    expect(result.sequencedList.map((e) => e.gapBefore)).toEqual([0, 1, 1])
    expect(result.unsequencedList).toEqual([])
  })

  it("infers a leading gap when the lowest number isn't 1", () => {
    const items = [makeItem({ id: 1, sequenceNumber: 26 })]
    const result = seedSequenceArrangement(items)
    expect(result.leadingGap).toBe(25)
    expect(result.sequencedList).toEqual([{ item: items[0], gapBefore: 0 }])
  })

  it("puts unsequenced items in unsequencedList, ordered by download date", () => {
    const items = [
      makeItem({ id: 1, downloadedAt: "2026-01-02T00:00:00Z" }),
      makeItem({ id: 2, downloadedAt: "2026-01-01T00:00:00Z" }),
    ]
    const result = seedSequenceArrangement(items)
    expect(result.sequencedList).toEqual([])
    expect(result.leadingGap).toBe(0)
    expect(result.unsequencedList.map((i) => i.id)).toEqual([2, 1])
  })

  it("clamps duplicate/inverted sequence numbers instead of going negative", () => {
    const items = [
      makeItem({ id: 1, sequenceNumber: 1 }),
      makeItem({ id: 2, sequenceNumber: 1 }),
      makeItem({ id: 3, sequenceNumber: 3 }),
    ]
    const result = seedSequenceArrangement(items)
    expect(result.sequencedList.every((e) => e.gapBefore >= 0)).toBe(true)
    expect(result.leadingGap).toBeGreaterThanOrEqual(0)
  })
})

describe("positionMap", () => {
  it("returns an empty array for an empty list", () => {
    expect(positionMap(0, [])).toEqual([])
  })

  it("maps every position for a dense list", () => {
    const a = makeItem({ id: 1 })
    const b = makeItem({ id: 2 })
    expect(positionMap(0, [entry(a), entry(b)])).toEqual([
      { position: 1, occupant: a },
      { position: 2, occupant: b },
    ])
  })

  it("leaves gap positions with a null occupant", () => {
    const a = makeItem({ id: 1 })
    const b = makeItem({ id: 2 })
    expect(positionMap(0, [entry(a), entry(b, 2)])).toEqual([
      { position: 1, occupant: a },
      { position: 2, occupant: null },
      { position: 3, occupant: null },
      { position: 4, occupant: b },
    ])
  })
})

describe("normalizeHead", () => {
  it("folds a nonzero head gap into leadingGap", () => {
    const a = makeItem({ id: 1 })
    const state: ArrangementState = { sequencedList: [entry(a, 3)], leadingGap: 1, unsequencedList: [] }
    const result = normalizeHead(state)
    expect(result.leadingGap).toBe(4)
    expect(result.sequencedList[0].gapBefore).toBe(0)
  })

  it("is a no-op when the head gap is already 0", () => {
    const a = makeItem({ id: 1 })
    const state: ArrangementState = { sequencedList: [entry(a, 0)], leadingGap: 1, unsequencedList: [] }
    expect(normalizeHead(state)).toEqual(state)
  })

  it("is a no-op for an empty list", () => {
    const state: ArrangementState = { sequencedList: [], leadingGap: 0, unsequencedList: [] }
    expect(normalizeHead(state)).toEqual(state)
  })
})

describe("moveToPosition", () => {
  it("fills a gap exactly, with no shift to items downstream of the gap owner (from unsequencedList)", () => {
    // A=1, B=4 (gapBefore 2), C=5 — filling position 3 (inside B's gap)
    const a = makeItem({ id: 1 })
    const b = makeItem({ id: 2 })
    const c = makeItem({ id: 3 })
    const x = makeItem({ id: 99 })
    const state: ArrangementState = {
      sequencedList: [entry(a), entry(b, 2), entry(c)],
      leadingGap: 0,
      unsequencedList: [x],
    }
    const result = moveToPosition(state, 99, 3)
    expect(result.unsequencedList).toEqual([])
    expect(computeDisplayNumbers(result.leadingGap, result.sequencedList)).toEqual([1, 3, 4, 5])
    expect(result.sequencedList.map((e) => e.item.id)).toEqual([1, 99, 2, 3])
  })

  it("moving forward onto a non-adjacent occupied position: mover lands exactly there, items in between shift back one", () => {
    // A=1, B=2, C=3 — move A to position 3 (C's position). A lands exactly
    // on 3 (matches what the position select promises); B and C each shift
    // back by one to make room, same as a plain array move.
    const a = makeItem({ id: 1 })
    const b = makeItem({ id: 2 })
    const c = makeItem({ id: 3 })
    const state: ArrangementState = {
      sequencedList: [entry(a), entry(b), entry(c)],
      leadingGap: 0,
      unsequencedList: [],
    }
    const result = moveToPosition(state, 1, 3)
    const numbers = computeDisplayNumbers(result.leadingGap, result.sequencedList)
    const byId = new Map(result.sequencedList.map((e, i) => [e.item.id, numbers[i]]))
    expect(byId.get(1)).toBe(3) // mover (A) lands exactly on the clicked number
    expect(byId.get(2)).toBe(1)
    expect(byId.get(3)).toBe(2)
  })

  it("moving forward onto the immediately-adjacent next item swaps them (regression: was a silent no-op)", () => {
    // A=3, B=4 (leadingGap 2) — click A's arrow to move it onto B's
    // position. Previously this spliced the mover back to the exact index
    // it was just removed from, so nothing visibly changed.
    const a = makeItem({ id: 1 })
    const b = makeItem({ id: 2 })
    const state: ArrangementState = {
      sequencedList: [entry(a), entry(b)],
      leadingGap: 2,
      unsequencedList: [],
    }
    const result = moveToPosition(state, 1, 4)
    expect(result.sequencedList.map((e) => e.item.id)).toEqual([2, 1])
    expect(computeDisplayNumbers(result.leadingGap, result.sequencedList)).toEqual([3, 4])
  })

  it("moving forward past the target preserves an untouched gap further downstream", () => {
    // P=1, M=3 (gap 1), T=4, Z=7 (gap 2) — move M forward onto T (adjacent).
    // M lands exactly on 4; T drops to 3; Z is completely unaffected (still
    // 7) — the gap between T and Z must survive the move unchanged, not
    // get silently absorbed or recomputed.
    const p = makeItem({ id: 1 })
    const m = makeItem({ id: 2 })
    const t = makeItem({ id: 3 })
    const z = makeItem({ id: 4 })
    const state: ArrangementState = {
      sequencedList: [entry(p), entry(m, 1), entry(t), entry(z, 2)],
      leadingGap: 0,
      unsequencedList: [],
    }
    const result = moveToPosition(state, 2, 4)
    expect(result.sequencedList.map((e) => e.item.id)).toEqual([1, 3, 2, 4])
    expect(computeDisplayNumbers(result.leadingGap, result.sequencedList)).toEqual([1, 3, 4, 7])
  })

  it("moving an unsequenced item onto an occupied position lands exactly there and shifts the rest", () => {
    const a = makeItem({ id: 1 })
    const b = makeItem({ id: 2 })
    const x = makeItem({ id: 99 })
    const state: ArrangementState = {
      sequencedList: [entry(a), entry(b)],
      leadingGap: 0,
      unsequencedList: [x],
    }
    const result = moveToPosition(state, 99, 1)
    expect(computeDisplayNumbers(result.leadingGap, result.sequencedList)).toEqual([1, 2, 3])
    expect(result.sequencedList.map((e) => e.item.id)).toEqual([99, 1, 2])
  })

  it("handles the self-referential case: mover is the gap owner's immediate predecessor, moving forward into its own gap", () => {
    // A=1, B=2, C=5 (gapBefore 2 on C) — move B forward into the gap, to position 3.
    // B lands exactly on 3 (it's moving INTO a gap, same as any gap-fill);
    // the slot B vacates (2) becomes a brand new gap instead of silently
    // disappearing, and C stays at its original absolute number (5) — total
    // missing count is conserved (was 2, still 2, just redistributed).
    const a = makeItem({ id: 1 })
    const b = makeItem({ id: 2 })
    const c = makeItem({ id: 3 })
    const state: ArrangementState = {
      sequencedList: [entry(a), entry(b), entry(c, 2)],
      leadingGap: 0,
      unsequencedList: [],
    }
    const result = moveToPosition(state, 2, 3)
    expect(computeDisplayNumbers(result.leadingGap, result.sequencedList)).toEqual([1, 3, 5])
    expect(result.sequencedList.map((e) => e.item.id)).toEqual([1, 2, 3])
  })

  it("handles the mirror self-referential case: mover is the gap owner, moving backward into its own leading gap", () => {
    // X=3, Y=4 (leadingGap 2) — move X backward into the leading gap, to
    // position 2. X lands exactly on 2; the slot X vacates (3) becomes a
    // new gap between X and Y; Y stays at its original absolute number (4).
    const x = makeItem({ id: 1 })
    const y = makeItem({ id: 2 })
    const state: ArrangementState = {
      sequencedList: [entry(x), entry(y)],
      leadingGap: 2,
      unsequencedList: [],
    }
    const result = moveToPosition(state, 1, 2)
    expect(result.leadingGap).toBe(1)
    expect(computeDisplayNumbers(result.leadingGap, result.sequencedList)).toEqual([2, 4])
    expect(result.sequencedList.map((e) => e.item.id)).toEqual([1, 2])
  })

  it("conserves total missing count across a self-referential move (regression: previously silently shrank the gap)", () => {
    const a = makeItem({ id: 1 })
    const b = makeItem({ id: 2 })
    const c = makeItem({ id: 3 })
    const state: ArrangementState = {
      sequencedList: [entry(a), entry(b), entry(c, 2)],
      leadingGap: 0,
      unsequencedList: [],
    }
    const before = computeDisplayNumbers(state.leadingGap, state.sequencedList)
    const missingBefore = before[before.length - 1] - before.length
    const result = moveToPosition(state, 2, 3)
    const after = computeDisplayNumbers(result.leadingGap, result.sequencedList)
    const missingAfter = after[after.length - 1] - after.length
    expect(missingAfter).toBe(missingBefore)
  })

  it("fills the leading gap", () => {
    const a = makeItem({ id: 1 })
    const x = makeItem({ id: 99 })
    const state: ArrangementState = {
      sequencedList: [entry(a)],
      leadingGap: 3, // a is at position 4
      unsequencedList: [x],
    }
    const result = moveToPosition(state, 99, 2)
    expect(result.leadingGap).toBe(1) // one slot remains before the mover
    const numbers = computeDisplayNumbers(result.leadingGap, result.sequencedList)
    const byId = new Map(result.sequencedList.map((e, i) => [e.item.id, numbers[i]]))
    expect(byId.get(99)).toBe(2)
    expect(byId.get(1)).toBe(4) // a's number is unchanged
  })

  it("bootstraps the very first item when sequencedList starts empty", () => {
    const x = makeItem({ id: 99 })
    const state: ArrangementState = { sequencedList: [], leadingGap: 0, unsequencedList: [x] }
    const result = moveToPosition(state, 99, 1)
    expect(result.sequencedList).toEqual([{ item: x, gapBefore: 0 }])
    expect(result.leadingGap).toBe(0)
    expect(result.unsequencedList).toEqual([])
  })

  it("is a no-op when the item is already at the target position", () => {
    const a = makeItem({ id: 1 })
    const b = makeItem({ id: 2 })
    const state: ArrangementState = { sequencedList: [entry(a), entry(b)], leadingGap: 0, unsequencedList: [] }
    expect(moveToPosition(state, 1, 1)).toEqual(state)
  })

  it("is a no-op for a position beyond the current range", () => {
    const a = makeItem({ id: 1 })
    const state: ArrangementState = { sequencedList: [entry(a)], leadingGap: 0, unsequencedList: [] }
    expect(moveToPosition(state, 1, 99)).toEqual(state)
  })

  it("collapses only the mover's own slot when removed from the middle, preserving a real gap attached to its old successor", () => {
    // A=1, B=4 (gapBefore 2), C=5 — move B out to fill nothing in particular,
    // just verify removing it from the middle doesn't destroy the gap that
    // was attached to it once its old successor (C) absorbs it.
    const a = makeItem({ id: 1 })
    const b = makeItem({ id: 2 })
    const c = makeItem({ id: 3 })
    const x = makeItem({ id: 99 })
    const state: ArrangementState = {
      sequencedList: [entry(a), entry(b, 2), entry(c)],
      leadingGap: 0,
      unsequencedList: [x],
    }
    // Move the unsequenced item to position 1 (swap with A), forcing B out
    // of the "middle" removal path isn't directly testable without moving B
    // itself — instead move B onto position 1 to exercise the merge-forward
    // rule on removal.
    const result = moveToPosition(state, 2, 1)
    // B moves to 1; A and C's relative gap (originally attached to B->C)
    // must survive somewhere, not silently vanish.
    const totalMissingBefore = 2 // the original gap size
    const numbers = computeDisplayNumbers(result.leadingGap, result.sequencedList)
    const max = numbers[numbers.length - 1]
    const occupied = new Set(numbers)
    let missing = 0
    for (let p = 1; p <= max; p++) if (!occupied.has(p)) missing++
    expect(missing).toBe(totalMissingBefore)
  })
})

describe("buildRenderNodes", () => {
  it("ascending: leading gap first, then each item with its own gap immediately before it", () => {
    const a = makeItem({ id: 1 })
    const b = makeItem({ id: 2 })
    const nodes = buildRenderNodes(2, [entry(a, 0), entry(b, 1)], "asc")
    expect(nodes).toEqual([
      { kind: "gap", size: 2, key: "leading", index: 0 },
      { kind: "item", entry: entry(a, 0), index: 0 },
      { kind: "gap", size: 1, key: "gap-2", index: 1 },
      { kind: "item", entry: entry(b, 1), index: 1 },
    ])
  })

  it("descending: reverses the whole flat sequence, so each item's number is untouched and the leading gap ends up last", () => {
    // A=1, B=2 (leadingGap 2) — matches the exact scenario this was
    // designed for: reading top-to-bottom in descending order should show
    // B, A, then the 2-slot gap at the very bottom (the start of the
    // sequence), not recompute anything.
    const a = makeItem({ id: 1 })
    const b = makeItem({ id: 2 })
    const nodes = buildRenderNodes(2, [entry(a, 0), entry(b, 0)], "desc")
    expect(nodes.map((n) => (n.kind === "item" ? n.entry.item.id : `gap:${n.size}`))).toEqual([2, "gap:0", 1, "gap:2"])
  })

  it("descending with an interior gap: gap renders between the two items it's actually between, mirrored", () => {
    // A=1, B=3 (gap 1), C=5 (gap 1) — physically flipping the number line
    // [1=A,2·,3=B,4·,5=C] gives [5=C,4·,3=B,2·,1=A] reading top-to-bottom.
    const a = makeItem({ id: 1 })
    const b = makeItem({ id: 2 })
    const c = makeItem({ id: 3 })
    const nodes = buildRenderNodes(0, [entry(a, 0), entry(b, 1), entry(c, 1)], "desc")
    expect(nodes.map((n) => (n.kind === "item" ? n.entry.item.id : `gap:${n.size}`))).toEqual([
      3,
      "gap:1",
      2,
      "gap:1",
      1,
      "gap:0",
    ])
  })

  it("is empty for an empty list", () => {
    expect(buildRenderNodes(0, [], "asc")).toEqual([])
    expect(buildRenderNodes(3, [], "desc")).toEqual([])
  })
})

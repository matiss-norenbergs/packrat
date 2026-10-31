import { describe, expect, it } from "vitest"
import { canonicalSort, cycleLayoutSort, effectiveSort, nextSort, sortRows } from "./sorting"
import type { SortState } from "./sorting"

const ids = <T extends { id: number }>(rows: T[]) => rows.map((r) => r.id)

describe("sortRows", () => {
  it("sorts strings case-insensitively and numerically aware", () => {
    const rows = ["file10", "File2", "file1", "Alpha"].map((name, id) => ({ id, name }))
    expect(sortRows(rows, (r) => r.name, "asc").map((r) => r.name)).toEqual(["Alpha", "file1", "File2", "file10"])
    expect(sortRows(rows, (r) => r.name, "desc").map((r) => r.name)).toEqual(["file10", "File2", "file1", "Alpha"])
  })

  it("sorts numbers numerically, not as text", () => {
    const rows = [10, 9, 100, 1].map((n, id) => ({ id, n }))
    expect(sortRows(rows, (r) => r.n, "asc").map((r) => r.n)).toEqual([1, 9, 10, 100])
    expect(sortRows(rows, (r) => r.n, "desc").map((r) => r.n)).toEqual([100, 10, 9, 1])
  })

  it("sorts dates and booleans by their numeric value", () => {
    const dates = [new Date("2025-03-01"), new Date("2024-01-01"), new Date("2026-01-01")].map((d, id) => ({ id, d }))
    expect(ids(sortRows(dates, (r) => r.d, "asc"))).toEqual([1, 0, 2])
    expect(ids(sortRows(dates, (r) => r.d, "desc"))).toEqual([2, 0, 1])
    const flags = [true, false, true, false].map((b, id) => ({ id, b }))
    expect(ids(sortRows(flags, (r) => r.b, "asc"))).toEqual([1, 3, 0, 2])
    expect(ids(sortRows(flags, (r) => r.b, "desc"))).toEqual([0, 2, 1, 3])
  })

  it("puts null, undefined, NaN and invalid dates last in both directions", () => {
    const values: (number | null | undefined | Date)[] = [null, 3, undefined, 1, NaN, new Date("x"), 2]
    const rows = values.map((v, id) => ({ id, v }))
    const get = (r: { v: number | null | undefined | Date }) => r.v
    expect(ids(sortRows(rows, get, "asc"))).toEqual([3, 6, 1, 0, 2, 4, 5])
    expect(ids(sortRows(rows, get, "desc"))).toEqual([1, 6, 3, 0, 2, 4, 5])
  })

  it("keeps the original order of ties, in both directions", () => {
    const rows = ["b", "a", "B", "A", "b"].map((name, id) => ({ id, name }))
    expect(ids(sortRows(rows, (r) => r.name.toLowerCase(), "asc"))).toEqual([1, 3, 0, 2, 4])
    expect(ids(sortRows(rows, (r) => r.name.toLowerCase(), "desc"))).toEqual([0, 2, 4, 1, 3])
    // The collator also ties letters that differ only in case.
    expect(ids(sortRows(rows, (r) => r.name, "asc"))).toEqual([1, 3, 0, 2, 4])
  })

  it("does not mutate its input", () => {
    const rows = [{ n: 2 }, { n: 1 }]
    sortRows(rows, (r) => r.n, "asc")
    expect(rows).toEqual([{ n: 2 }, { n: 1 }])
  })
})

const asc = (key: string): SortState => ({ key, dir: "asc" })
const desc = (key: string): SortState => ({ key, dir: "desc" })

describe("nextSort", () => {
  describe("without a default sort", () => {
    it("cycles asc -> desc -> off on one column", () => {
      expect(nextSort(undefined, "a", undefined)).toEqual(asc("a"))
      expect(nextSort(asc("a"), "a", undefined)).toEqual(desc("a"))
      expect(nextSort(desc("a"), "a", undefined)).toBeUndefined()
    })
    it("starts at asc when another column is sorted", () => {
      expect(nextSort(desc("a"), "b", undefined)).toEqual(asc("b"))
    })
  })

  describe("with a default sort that is desc (newest first)", () => {
    const def = desc("date")
    it("toggles the default column between its two directions without getting stuck", () => {
      expect(nextSort(undefined, "date", def)).toEqual(asc("date"))
      expect(nextSort(asc("date"), "date", def)).toBeUndefined()
      expect(nextSort(undefined, "date", def)).toEqual(asc("date"))
    })
    it("cycles another column asc -> desc -> back to the default", () => {
      expect(nextSort(undefined, "title", def)).toEqual(asc("title"))
      expect(nextSort(asc("title"), "title", def)).toEqual(desc("title"))
      expect(nextSort(desc("title"), "title", def)).toBeUndefined()
    })
  })

  describe("with a default sort that is asc", () => {
    const def = asc("name")
    it("toggles the default column between its two directions", () => {
      expect(nextSort(undefined, "name", def)).toEqual(desc("name"))
      expect(nextSort(desc("name"), "name", def)).toBeUndefined()
    })
    it("cycles another column asc -> desc -> back to the default", () => {
      expect(nextSort(undefined, "usage", def)).toEqual(asc("usage"))
      expect(nextSort(asc("usage"), "usage", def)).toEqual(desc("usage"))
      expect(nextSort(desc("usage"), "usage", def)).toBeUndefined()
    })
  })

  it("never keeps an explicit sort that equals the default", () => {
    expect(canonicalSort(desc("date"), desc("date"))).toBeUndefined()
    expect(canonicalSort(asc("date"), desc("date"))).toEqual(asc("date"))
    expect(canonicalSort(undefined, desc("date"))).toBeUndefined()
    for (const def of [undefined, asc("a"), desc("a")]) {
      let working: SortState | undefined
      for (const key of ["a", "a", "a", "b", "b", "b", "a", "b"]) {
        working = nextSort(working, key, def)
        expect(canonicalSort(working, def)).toEqual(working)
      }
    }
  })

  it("every click changes what is shown", () => {
    for (const def of [undefined, asc("a"), desc("a")]) {
      let working: SortState | undefined
      for (const key of ["a", "a", "a", "a", "b", "b", "b", "b", "a"]) {
        const before = effectiveSort(working, def)
        working = nextSort(working, key, def)
        expect(effectiveSort(working, def)).not.toEqual(before)
      }
    }
  })
})

describe("cycleLayoutSort", () => {
  it("keeps the other fields and drops sort when back to the default", () => {
    const layout = { v: 1 as const, hidden: ["x"], sort: asc("a") }
    expect(cycleLayoutSort(layout, "a", undefined)).toEqual({ v: 1, hidden: ["x"], sort: desc("a") })
    expect(cycleLayoutSort({ v: 1, hidden: ["x"], sort: desc("a") }, "a", undefined)).toEqual({ v: 1, hidden: ["x"] })
    expect(cycleLayoutSort({ v: 1, sort: asc("date") }, "date", desc("date"))).toEqual({ v: 1 })
  })
})

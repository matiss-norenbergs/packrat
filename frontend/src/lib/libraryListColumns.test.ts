import { describe, expect, it } from "vitest"
import { LIBRARY_SORT_KEYS } from "@/hooks/useLibrarySort"
import { LIBRARY_LIST_COLUMN_SPECS, LIBRARY_LIST_DEFAULT_LAYOUT, LIBRARY_LIST_EXTRA_SORT_KEYS, LIBRARY_LIST_LAYOUT_OPTIONS } from "./libraryListColumns"

describe("library list column specs", () => {
  it("covers every server sort key exactly once: sortable columns plus the extra keys", () => {
    const keys = [...LIBRARY_LIST_COLUMN_SPECS.filter((c) => c.sortable).map((c) => c.key), ...LIBRARY_LIST_EXTRA_SORT_KEYS]
    expect([...keys].sort()).toEqual([...LIBRARY_SORT_KEYS].sort())
    expect(LIBRARY_LIST_LAYOUT_OPTIONS.sortableKeys).toEqual(keys)
  })

  it("hides the columns that are off by default", () => {
    expect(LIBRARY_LIST_DEFAULT_LAYOUT).toEqual({ v: 1, hidden: ["year", "duration", "downloadedAt", "size"] })
  })

  it("offers resizable widths only for columns the user can drag", () => {
    expect(Object.keys(LIBRARY_LIST_LAYOUT_OPTIONS.resizableWidths)).toEqual(["seasonNumber", "year", "duration", "downloadedAt", "artist", "collection", "size", "tags"])
    expect(LIBRARY_LIST_LAYOUT_OPTIONS.resizableWidths.artist).toEqual({ default: 200, min: 48 })
  })

  it("never lets the thumbnail or title column be hidden, and has no actions column (row actions are the right-click menu)", () => {
    expect(LIBRARY_LIST_LAYOUT_OPTIONS.hideableKeys).not.toContain("thumb")
    expect(LIBRARY_LIST_LAYOUT_OPTIONS.hideableKeys).not.toContain("title")
    expect(LIBRARY_LIST_COLUMN_SPECS.map((c) => c.key)).not.toContain("actions")
  })
})

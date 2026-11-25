import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { LibraryItem } from "@/types/api"
import { sameItem, useStableItems } from "./sameItem"

const item = (id: number, over: Partial<LibraryItem> = {}) => ({ id, title: `T${id}`, tags: ["a", "b"], ...over }) as unknown as LibraryItem

describe("sameItem", () => {
  it("compares the fields and the tags by value", () => {
    expect(sameItem(item(1), item(1))).toBe(true)
    expect(sameItem(item(1), item(1, { title: "x" }))).toBe(false)
    expect(sameItem(item(1), item(1, { tags: ["a"] }))).toBe(false)
    expect(sameItem(item(1), item(1, { tags: ["a", "c"] }))).toBe(false)
  })
})

describe("useStableItems", () => {
  it("keeps the previous object of an unchanged item and takes the new one of a changed item", () => {
    const first = [item(1), item(2)]
    const r = renderHook(({ items }) => useStableItems(items), { initialProps: { items: first } })
    expect(r.result.current).toBe(first)
    r.rerender({ items: [item(2), item(3), item(1, { title: "changed" })] })
    const out = r.result.current
    expect(out[0]).toBe(first[1])
    expect(out[1].id).toBe(3)
    expect(out[2].title).toBe("changed")
  })
})

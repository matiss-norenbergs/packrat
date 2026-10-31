import type { ReactNode } from "react"
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { LibraryItem } from "@/types/api"
import { SelectionProvider, useSelection } from "./SelectionContext"
import { useLibraryListSelection } from "./useLibraryListSelection"

afterEach(cleanup)

const item = (id: number) => ({ id, title: `Item ${id}` }) as LibraryItem
const PAGE1 = [1, 2, 3].map(item)
const PAGE2 = [4, 5, 6].map(item)

function setup(initial: LibraryItem[] = PAGE1) {
  const wrapper = ({ children }: { children: ReactNode }) => <SelectionProvider>{children}</SelectionProvider>
  return renderHook(
    ({ items }) => ({ selection: useLibraryListSelection(items), context: useSelection() }),
    { wrapper, initialProps: { items: initial } },
  )
}
const ids = (r: ReturnType<typeof setup>) => [...r.result.current.context.selectedItems.keys()].sort()

describe("useLibraryListSelection", () => {
  it("starts empty", () => {
    const r = setup()
    expect(r.result.current.selection.size).toBe(0)
    expect(r.result.current.selection.active).toBe(false)
    expect(r.result.current.selection.isSelected(1)).toBe(false)
  })

  it("toggle adds and removes just that item", () => {
    const r = setup()
    act(() => r.result.current.selection.toggle(1))
    act(() => r.result.current.selection.toggle(3))
    expect(ids(r)).toEqual([1, 3])
    expect([...r.result.current.selection.selected].sort()).toEqual([1, 3])
    expect(r.result.current.selection.isSelected(3)).toBe(true)
    expect(r.result.current.selection.size).toBe(2)
    expect(r.result.current.selection.active).toBe(true)
    act(() => r.result.current.selection.toggle(1))
    expect(ids(r)).toEqual([3])
  })

  it("toggle accumulates across pages, and an item of another page can be un-toggled", () => {
    const r = setup(PAGE1)
    act(() => r.result.current.selection.toggle(2))
    r.rerender({ items: PAGE2 })
    act(() => r.result.current.selection.toggle(5))
    expect(ids(r)).toEqual([2, 5])
    expect(r.result.current.selection.size).toBe(2)
    // Item 2 is no longer on the page, but its id stays selected and can be toggled off through the stored item.
    expect(r.result.current.selection.isSelected(2)).toBe(true)
    act(() => r.result.current.selection.toggle(2))
    expect(ids(r)).toEqual([5])
  })

  it("selectOnly replaces everything, including items of other pages and collections", () => {
    const r = setup(PAGE1)
    act(() => {
      r.result.current.selection.toggle(1)
      r.result.current.context.toggleCollection(9, 12)
    })
    r.rerender({ items: PAGE2 })
    expect(r.result.current.context.approxCount).toBe(13)
    act(() => r.result.current.selection.selectOnly(4))
    expect(ids(r)).toEqual([4])
    expect(r.result.current.context.selectedCollectionIds.size).toBe(0)
    expect(r.result.current.context.approxCount).toBe(1)
  })

  it("selectAll replaces everything with the given ids of the current page", () => {
    const r = setup(PAGE1)
    act(() => {
      r.result.current.selection.toggle(2)
      r.result.current.context.toggleCollection(9, 4)
    })
    r.rerender({ items: PAGE2 })
    act(() => r.result.current.selection.selectAll([4, 6]))
    expect(ids(r)).toEqual([4, 6])
    expect(r.result.current.context.selectedCollectionIds.size).toBe(0)
  })

  it("ignores ids that are not on the current page", () => {
    const r = setup(PAGE1)
    act(() => r.result.current.selection.toggle(99))
    expect(ids(r)).toEqual([])
    act(() => r.result.current.selection.toggle(1))
    act(() => r.result.current.selection.selectAll([2, 99]))
    expect(ids(r)).toEqual([2])
    act(() => r.result.current.selection.selectOnly(99))
    expect(ids(r)).toEqual([]) // it still replaced the selection
  })

  it("resolves ids to the current page's item objects", () => {
    const r = setup(PAGE1)
    act(() => r.result.current.selection.selectAll([1, 2]))
    expect(r.result.current.context.selectedItems.get(1)).toBe(PAGE1[0])
    const fresh = [item(1), item(2)]
    r.rerender({ items: fresh })
    act(() => r.result.current.selection.selectAll([1]))
    expect(r.result.current.context.selectedItems.get(1)).toBe(fresh[0])
  })

  it("clear drops items and collections", () => {
    const r = setup()
    act(() => {
      r.result.current.selection.toggle(1)
      r.result.current.context.toggleCollection(9, 4)
    })
    act(() => r.result.current.selection.clear())
    expect(ids(r)).toEqual([])
    expect(r.result.current.context.selectedCollectionIds.size).toBe(0)
    expect(r.result.current.context.approxCount).toBe(0)
    expect(r.result.current.selection.active).toBe(false)
  })

  it("keeps the same object and methods until the selection changes", () => {
    const r = setup()
    const first = r.result.current.selection
    r.rerender({ items: PAGE1 })
    expect(r.result.current.selection).toBe(first)
    // A new page (other items) does not change identity either: nothing the table memoizes on depends on it.
    r.rerender({ items: PAGE2 })
    expect(r.result.current.selection).toBe(first)
    act(() => first.toggle(5))
    const next = r.result.current.selection
    expect(next).not.toBe(first)
    expect(next.toggle).toBe(first.toggle)
    expect(next.selectAll).toBe(first.selectAll)
    expect(next.selectOnly).toBe(first.selectOnly)
    expect(next.clear).toBe(first.clear)
  })
})

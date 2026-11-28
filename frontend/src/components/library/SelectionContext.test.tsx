import { Profiler, type ReactNode } from "react"
import { act, render, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { LibraryItem } from "@/types/api"
import { SelectionProvider, useIsCollectionSelected, useIsItemSelected, useSelection, useSelectionActions, useSelectionActive } from "./SelectionContext"


const item = (id: number) => ({ id, title: `Item ${id}` }) as LibraryItem
const wrapper = ({ children }: { children: ReactNode }) => <SelectionProvider>{children}</SelectionProvider>

describe("selection semantics", () => {
  it("toggles, bulk selects and clears items", () => {
    const r = renderHook(() => ({ s: useSelection(), a: useSelectionActions() }), { wrapper })
    act(() => r.result.current.a.toggleItem(item(1)))
    act(() => r.result.current.a.selectItems([item(2), item(3)]))
    expect([...r.result.current.s.selectedItems.keys()]).toEqual([1, 2, 3])
    expect(r.result.current.s.selectionActive).toBe(true)
    expect(r.result.current.s.isItemSelected(2)).toBe(true)
    act(() => r.result.current.a.deselectItems([2, 9]))
    expect([...r.result.current.s.selectedItems.keys()]).toEqual([1, 3])
    act(() => r.result.current.a.toggleItem(item(1)))
    expect([...r.result.current.s.selectedItems.keys()]).toEqual([3])
    act(() => r.result.current.a.clear())
    expect(r.result.current.s.selectionActive).toBe(false)
    expect(r.result.current.s.selectedItems.size).toBe(0)
  })

  it("counts selected collections into approxCount and drops them on clear", () => {
    const r = renderHook(() => ({ s: useSelection(), a: useSelectionActions() }), { wrapper })
    act(() => r.result.current.a.selectItems([item(1), item(2)]))
    act(() => r.result.current.a.toggleCollection(10, 5))
    act(() => r.result.current.a.toggleCollection(11, 7))
    expect(r.result.current.s.approxCount).toBe(2 + 5 + 7)
    expect(r.result.current.s.isCollectionSelected(10)).toBe(true)
    act(() => r.result.current.a.toggleCollection(10, 5))
    expect(r.result.current.s.approxCount).toBe(2 + 7)
    expect(r.result.current.s.selectionActive).toBe(true)
    act(() => r.result.current.a.clear())
    expect(r.result.current.s.approxCount).toBe(0)
    expect(r.result.current.s.selectedCollectionIds.size).toBe(0)
  })

  it("persists across a remount of the views under the provider and resets when the provider unmounts", () => {
    const view = renderHook(() => useSelection(), { wrapper })
    act(() => view.result.current.toggleItem(item(1)))
    view.rerender()
    expect(view.result.current.selectedItems.has(1)).toBe(true)
    view.unmount()
    const fresh = renderHook(() => useSelection(), { wrapper })
    expect(fresh.result.current.selectedItems.size).toBe(0)
  })

  it("without a provider is empty and ignores writes", () => {
    const r = renderHook(() => ({ s: useSelection(), a: useSelectionActions() }))
    act(() => r.result.current.a.toggleItem(item(1)))
    expect(r.result.current.s.selectionActive).toBe(false)
  })
})

describe("selection render counts", () => {
  function Card({ id, counts }: { id: number; counts: Map<number, number> }) {
    const selected = useIsItemSelected(id)
    return (
      <Profiler id={String(id)} onRender={() => counts.set(id, (counts.get(id) ?? 0) + 1)}>
        <span data-testid={`c${id}`}>{selected ? "on" : "off"}</span>
      </Profiler>
    )
  }
  function Active({ counts }: { counts: Map<number, number> }) {
    const active = useSelectionActive()
    return (
      <Profiler id="active" onRender={() => counts.set(-1, (counts.get(-1) ?? 0) + 1)}>
        <span>{active ? "active" : "idle"}</span>
      </Profiler>
    )
  }
  function Collection({ counts }: { counts: Map<number, number> }) {
    const on = useIsCollectionSelected(10)
    return (
      <Profiler id="col" onRender={() => counts.set(-2, (counts.get(-2) ?? 0) + 1)}>
        <span>{on ? "col-on" : "col-off"}</span>
      </Profiler>
    )
  }

  function setup() {
    const counts = new Map<number, number>()
    let actions!: ReturnType<typeof useSelectionActions>
    function Grab() {
      actions = useSelectionActions()
      return null
    }
    render(
      <SelectionProvider>
        <Grab />
        <Active counts={counts} />
        <Collection counts={counts} />
        {[1, 2, 3, 4].map((id) => (
          <Card key={id} id={id} counts={counts} />
        ))}
      </SelectionProvider>,
    )
    return { counts, actions }
  }

  it("ticking a second card re-renders only that card", () => {
    const { counts, actions } = setup()
    act(() => actions.toggleItem(item(1)))
    counts.clear()
    act(() => actions.toggleItem(item(3)))
    expect([...counts.keys()]).toEqual([3])
  })

  it("the active flag re-renders its consumers only when the selection goes empty <-> non-empty", () => {
    const { counts, actions } = setup()
    act(() => actions.toggleItem(item(1)))
    expect(counts.get(-1)).toBe(2)
    act(() => actions.toggleItem(item(2)))
    act(() => actions.toggleItem(item(2)))
    expect(counts.get(-1)).toBe(2)
    act(() => actions.clear())
    expect(counts.get(-1)).toBe(3)
  })

  it("a collection tick re-renders only that collection's consumer", () => {
    const { counts, actions } = setup()
    counts.clear()
    act(() => actions.toggleCollection(10, 3))
    // the collection tile and the active flag (collection selection makes the selection active)
    expect([...counts.keys()].sort((a, b) => a - b)).toEqual([-2, -1])
  })

  it("clearing an empty selection does nothing", () => {
    const { counts, actions } = setup()
    counts.clear()
    act(() => actions.clear())
    expect(counts.size).toBe(0)
  })
})

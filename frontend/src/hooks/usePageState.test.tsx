import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { usePageState } from "./usePageState"

describe("usePageState", () => {
  it("starts on page 1 and does not reset on mount", () => {
    const { result } = renderHook(() => usePageState("a"))
    expect(result.current[0]).toBe(1)
  })

  it("setPage changes the page", () => {
    const { result } = renderHook(() => usePageState("a"))
    act(() => result.current[1](3))
    expect(result.current[0]).toBe(3)
  })

  it("an unchanged key keeps the page across renders", () => {
    const { result, rerender } = renderHook(({ k }) => usePageState(k), { initialProps: { k: "a" } })
    act(() => result.current[1](3))
    rerender({ k: "a" })
    expect(result.current[0]).toBe(3)
  })

  it("a changed key resets to page 1 in the same render, never returning the old page", () => {
    const seen: number[] = []
    const { result, rerender } = renderHook(
      ({ k }) => {
        const r = usePageState(k)
        seen.push(r[0])
        return r
      },
      { initialProps: { k: "a" } },
    )
    act(() => result.current[1](3))
    seen.length = 0
    rerender({ k: "b" })
    expect(result.current[0]).toBe(1)
    expect(seen.every((p) => p === 1)).toBe(true)
    act(() => result.current[1](2))
    expect(result.current[0]).toBe(2)
  })
})

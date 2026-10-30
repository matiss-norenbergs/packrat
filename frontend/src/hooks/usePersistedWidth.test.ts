import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { usePersistedWidth } from "@/hooks/usePersistedWidth"

const KEY = "test:width"

beforeEach(() => localStorage.clear())

describe("usePersistedWidth", () => {
  it("resolves to the default when nothing is stored", () => {
    const { result } = renderHook(() => usePersistedWidth(KEY, 500))
    expect(result.current[0]).toBe(500)
  })

  it("reads a valid stored value over the default", () => {
    localStorage.setItem(KEY, "412")
    const { result } = renderHook(() => usePersistedWidth(KEY, 500))
    expect(result.current[0]).toBe(412)
  })

  it.each(["garbage", "NaN", "0", "-50", "Infinity", ""])("ignores invalid stored value %j", (raw) => {
    localStorage.setItem(KEY, raw)
    const { result } = renderHook(() => usePersistedWidth(KEY, 500))
    expect(result.current[0]).toBe(500)
  })

  it("persists on set", () => {
    const { result } = renderHook(() => usePersistedWidth(KEY, 500))
    act(() => result.current[1](450))
    expect(result.current[0]).toBe(450)
    expect(localStorage.getItem(KEY)).toBe("450")
  })

  it("removes the key and falls back to the default on null", () => {
    localStorage.setItem(KEY, "450")
    const { result } = renderHook(() => usePersistedWidth(KEY, 500))
    act(() => result.current[1](null))
    expect(result.current[0]).toBe(500)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it("follows a changed default after a reset", () => {
    localStorage.setItem(KEY, "450")
    const { result, rerender } = renderHook(({ d }) => usePersistedWidth(KEY, d), { initialProps: { d: 500 } })
    act(() => result.current[1](null))
    rerender({ d: 360 })
    expect(result.current[0]).toBe(360)
  })
})

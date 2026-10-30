import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { usePersistedWidth } from "@/hooks/usePersistedWidth"

const KEY = "test:width"

beforeEach(() => localStorage.clear())

describe("usePersistedWidth", () => {
  it("defaults to 320 when nothing is stored", () => {
    const { result } = renderHook(() => usePersistedWidth(KEY))
    expect(result.current[0]).toBe(320)
  })

  it("honours a custom default", () => {
    const { result } = renderHook(() => usePersistedWidth(KEY, 400))
    expect(result.current[0]).toBe(400)
  })

  it("reads a valid stored value", () => {
    localStorage.setItem(KEY, "412")
    const { result } = renderHook(() => usePersistedWidth(KEY))
    expect(result.current[0]).toBe(412)
  })

  it.each(["garbage", "NaN", "0", "-50", "Infinity", ""])("ignores invalid stored value %j", (raw) => {
    localStorage.setItem(KEY, raw)
    const { result } = renderHook(() => usePersistedWidth(KEY))
    expect(result.current[0]).toBe(320)
  })

  it("persists on set", () => {
    const { result } = renderHook(() => usePersistedWidth(KEY))
    act(() => result.current[1](450))
    expect(result.current[0]).toBe(450)
    expect(localStorage.getItem(KEY)).toBe("450")
  })
})

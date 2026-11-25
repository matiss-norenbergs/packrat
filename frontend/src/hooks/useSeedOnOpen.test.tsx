import { describe, expect, it } from "vitest"
import { renderHook } from "@testing-library/react"
import { useSeedOnOpen } from "./useSeedOnOpen"

describe("useSeedOnOpen", () => {
  it("seeds on open and target change, not on new closure or object identity", () => {
    const calls: string[] = []
    const { rerender } = renderHook(
      ({ open, id, v }) => useSeedOnOpen(open, id, () => calls.push(v)),
      { initialProps: { open: false, id: 1, v: "a" } },
    )
    expect(calls).toEqual([])
    rerender({ open: true, id: 1, v: "b" })
    expect(calls).toEqual(["b"])
    rerender({ open: true, id: 1, v: "c" }) // refetch: new closure, same target
    expect(calls).toEqual(["b"])
    rerender({ open: true, id: 2, v: "d" })
    expect(calls).toEqual(["b", "d"])
    rerender({ open: false, id: 2, v: "e" })
    rerender({ open: true, id: 2, v: "f" })
    expect(calls).toEqual(["b", "d", "f"])
  })
})

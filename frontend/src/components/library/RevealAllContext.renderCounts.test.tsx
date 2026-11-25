import { Profiler, memo } from "react"
import { RouterProvider, createMemoryRouter, useNavigate } from "react-router-dom"
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { RevealAllProvider, useIsRevealed, useRevealActions } from "./RevealAllContext"

afterEach(cleanup)

describe("reveal render counts", () => {
  const counts = new Map<number, number>()
  const Cell = memo(function Cell({ id }: { id: number }) {
    const revealed = useIsRevealed(id)
    return (
      <Profiler id={String(id)} onRender={() => counts.set(id, (counts.get(id) ?? 0) + 1)}>
        <span>{revealed ? "on" : "off"}</span>
      </Profiler>
    )
  })
  let actions!: ReturnType<typeof useRevealActions>
  let navigate!: ReturnType<typeof useNavigate>
  function Page() {
    actions = useRevealActions()
    navigate = useNavigate()
    return (
      <>
        {[1, 2, 3].map((id) => (
          <Cell key={id} id={id} />
        ))}
      </>
    )
  }
  function setup() {
    counts.clear()
    const router = createMemoryRouter([{ path: "/lib", element: <RevealAllProvider clearOnNavigate><Page /></RevealAllProvider> }], { initialEntries: ["/lib"] })
    render(<RouterProvider router={router} />)
    counts.clear()
  }

  it("revealing one item re-renders only that item", () => {
    setup()
    act(() => actions.toggleItem(2))
    expect([...counts.keys()]).toEqual([2])
  })

  it("reveal-all re-renders every item once, and hideItem of an unrevealed item nothing", () => {
    setup()
    act(() => actions.hideItem(1))
    expect(counts.size).toBe(0)
    act(() => actions.toggleRevealAll())
    expect([...counts.keys()].sort()).toEqual([1, 2, 3])
  })

  it("a filter / URL change re-renders no item and keeps the reveals", () => {
    setup()
    act(() => actions.toggleItem(2))
    counts.clear()
    act(() => {
      void navigate("/lib?q=x")
    })
    expect(counts.size).toBe(0)
  })
})

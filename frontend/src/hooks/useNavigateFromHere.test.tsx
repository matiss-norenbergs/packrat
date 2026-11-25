import { Profiler, memo } from "react"
import { RouterProvider, createMemoryRouter, useLocation, useNavigate } from "react-router-dom"
import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import { useNavigateFromHere } from "./useNavigateFromHere"

afterEach(cleanup)

describe("useNavigateFromHere", () => {
  let renders = 0
  const Cell = memo(function Cell() {
    const go = useNavigateFromHere()
    return (
      <Profiler id="cell" onRender={() => renders++}>
        <button onClick={() => go("/item/1")}>open</button>
      </Profiler>
    )
  })
  let navigate!: ReturnType<typeof useNavigate>
  function Page() {
    navigate = useNavigate()
    return <Cell />
  }
  function Item() {
    return <span data-testid="from">{String((useLocation().state as { from?: string } | null)?.from)}</span>
  }

  it("navigates with the current path and query as `from`, and never re-renders its component on navigation", async () => {
    const router = createMemoryRouter([{ path: "/lib", element: <Page /> }, { path: "/item/:id", element: <Item /> }], { initialEntries: ["/lib"] })
    render(<RouterProvider router={router} />)
    renders = 0
    await act(async () => {
      await navigate("/lib?q=abc")
    })
    expect(renders).toBe(0)
    await userEvent.click(screen.getByText("open"))
    expect(screen.getByTestId("from").textContent).toBe("/lib?q=abc")
  })
})

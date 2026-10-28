import { Link, MemoryRouter, Outlet, RouterProvider, createMemoryRouter } from "react-router-dom"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import { RevealAllProvider, useRevealAll } from "@/components/library/RevealAllContext"

afterEach(cleanup)

function Probe() {
  const { isRevealed, revealAll, toggleItem, revealItems, toggleRevealAll } = useRevealAll()
  return (
    <div>
      <span data-testid="shown">{[1, 2, 3].filter(isRevealed).join(",") || "none"}</span>
      <span data-testid="all">{revealAll ? "on" : "off"}</span>
      <button onClick={() => toggleItem(1)}>toggle1</button>
      <button onClick={() => revealItems([2, 3])}>reveal23</button>
      <button onClick={toggleRevealAll}>all</button>
      <Link to="/item/2">sameRoute</Link>
      <Link to="/lib">lib</Link>
      <Link to="/other">other</Link>
      <Link to="/lib?q=x">libq</Link>
    </div>
  )
}

function renderApp(route: string, clear = true) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <RevealAllProvider clearOnNavigate={clear}>
            <Outlet />
          </RevealAllProvider>
        ),
        children: [
          { path: "/item/:id", element: <Probe /> },
          { path: "/lib", element: <Probe /> },
          { path: "/other", element: <Probe /> },
        ],
      },
    ],
    { initialEntries: [route] },
  )
  return render(<RouterProvider router={router} />)
}

const click = (name: string) => userEvent.click(screen.getByRole("button", { name }))
const go = (name: string) => userEvent.click(screen.getByRole("link", { name }))
const shown = () => screen.getByTestId("shown").textContent
const revealAllOnPage = () => screen.getByTestId("all").textContent

describe("RevealAllProvider route changes", () => {
  it("keeps reveals when only the params change within the same route", async () => {
    renderApp("/item/1")
    await click("toggle1")
    await click("reveal23")
    await go("sameRoute")
    expect(shown()).toBe("1,2,3")
  })

  it("re-blurs individually revealed items when the matched route changes", async () => {
    renderApp("/item/1")
    await click("toggle1")
    await click("reveal23")
    await go("lib")
    expect(shown()).toBe("none")
  })

  it("clears when moving from the library to another route", async () => {
    renderApp("/lib")
    await click("toggle1")
    await go("other")
    expect(shown()).toBe("none")
  })

  it("keeps individual reveals when only the query string changes", async () => {
    renderApp("/lib")
    await click("toggle1")
    await go("libq")
    expect(shown()).toBe("1")
  })

  it("keeps reveal-all across same-route and different-route navigation", async () => {
    renderApp("/item/1")
    await click("all")
    await go("sameRoute")
    expect(revealAllOnPage()).toBe("on")
    await go("lib")
    expect(revealAllOnPage()).toBe("on")
    expect(shown()).toBe("1,2,3")
  })

  it("turning reveal-all off still clears individual reveals", async () => {
    renderApp("/lib")
    await click("toggle1")
    await click("all")
    await click("all")
    expect(shown()).toBe("none")
  })

  it("does not clear on navigation without clearOnNavigate (per-page providers)", async () => {
    renderApp("/lib", false)
    await click("toggle1")
    await go("other")
    expect(shown()).toBe("1")
  })
})

describe("RevealAllProvider.hideAll", () => {
  function HideProbe() {
    const { hideAll } = useRevealAll()
    return <button onClick={hideAll}>hide</button>
  }
  function renderBoth() {
    return render(
      <RevealAllProvider>
        <Probe />
        <HideProbe />
      </RevealAllProvider>,
      { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> },
    )
  }

  it("turns reveal-all off and clears individual reveals", async () => {
    renderBoth()
    await click("toggle1")
    await click("all")
    expect(revealAllOnPage()).toBe("on")
    await click("hide")
    expect(revealAllOnPage()).toBe("off")
    expect(shown()).toBe("none")
  })

  it("clears individual reveals when reveal-all is already off, and is idempotent", async () => {
    renderBoth()
    await click("toggle1")
    await click("hide")
    await click("hide")
    expect(revealAllOnPage()).toBe("off")
    expect(shown()).toBe("none")
  })

  it("leaves toggleRevealAll working afterwards", async () => {
    renderBoth()
    await click("hide")
    await click("all")
    expect(revealAllOnPage()).toBe("on")
    expect(shown()).toBe("1,2,3")
    await click("all")
    expect(revealAllOnPage()).toBe("off")
  })
})

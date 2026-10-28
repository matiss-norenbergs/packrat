import { Link, Route, Routes } from "react-router-dom"
import { cleanup, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import { RevealAllProvider, useRevealAll } from "@/components/library/RevealAllContext"
import { mockFetch, renderWithProviders } from "@/test/mockApi"

afterEach(cleanup)

function Probe({ ids }: { ids: number[] }) {
  const { isRevealed, revealAll, toggleItem, revealItems, toggleRevealAll } = useRevealAll()
  return (
    <div>
      <span data-testid="shown">{ids.filter(isRevealed).join(",") || "none"}</span>
      <span data-testid="all">{revealAll ? "on" : "off"}</span>
      <button onClick={() => toggleItem(1)}>toggle1</button>
      <button onClick={() => revealItems([2, 3])}>reveal23</button>
      <button onClick={toggleRevealAll}>all</button>
      <Link to="/other">other</Link>
      <Link to="/other?q=x">otherq</Link>
      <Link to="/lib?q=x">libq</Link>
    </div>
  )
}

function App({ clear = true }: { clear?: boolean }) {
  return (
    <RevealAllProvider clearOnNavigate={clear}>
      <Routes>
        <Route path="/lib" element={<Probe ids={[1, 2, 3]} />} />
        <Route path="/other" element={<Probe ids={[1, 2, 3]} />} />
      </Routes>
    </RevealAllProvider>
  )
}

const click = (name: string) => userEvent.click(screen.getByRole("button", { name }))
const go = (name: string) => userEvent.click(screen.getByRole("link", { name }))
const shown = () => screen.getByTestId("shown").textContent

describe("RevealAllProvider route changes", () => {
  it("re-blurs individually revealed items on a pathname change", async () => {
    mockFetch(() => ({ status: 404 }))
    renderWithProviders(<App />, "/lib")
    await click("toggle1")
    await click("reveal23")
    expect(shown()).toBe("1,2,3")
    await go("other")
    expect(shown()).toBe("none")
  })

  it("keeps reveal-all across a pathname change", async () => {
    renderWithProviders(<App />, "/lib")
    await click("all")
    await go("other")
    expect(screen.getByTestId("all").textContent).toBe("on")
    expect(shown()).toBe("1,2,3")
  })

  it("keeps individual reveals when only the query string changes", async () => {
    renderWithProviders(<App />, "/lib")
    await click("toggle1")
    await go("libq")
    expect(shown()).toBe("1")
  })

  it("turning reveal-all off still clears individual reveals", async () => {
    renderWithProviders(<App />, "/lib")
    await click("toggle1")
    await click("all")
    await click("all")
    expect(shown()).toBe("none")
  })

  it("does not clear on navigation without clearOnNavigate (per-page providers)", async () => {
    renderWithProviders(<App clear={false} />, "/lib")
    await click("toggle1")
    await go("other")
    expect(shown()).toBe("1")
  })
})

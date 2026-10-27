import { Link, Route, Routes } from "react-router-dom"
import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import { FloatingActionDock } from "@/components/FloatingActionDock"
import { RevealAllProvider, useRevealAll } from "@/components/library/RevealAllContext"
import { RevealAllFloatingAction } from "@/components/library/RevealAllFloatingAction"
import { mockFetch, renderWithProviders } from "@/test/mockApi"

afterEach(cleanup)

const PRIVATE_COLLECTION = { id: 1, effectiveIsPrivate: true, totalItemCount: 3 }
const PUBLIC_COLLECTION = { id: 2, effectiveIsPrivate: false, totalItemCount: 3 }
const EMPTY_PRIVATE_COLLECTION = { id: 3, effectiveIsPrivate: true, totalItemCount: 0 }

function serve(opts: { privacy: boolean; collections?: object[]; tags?: object[] }) {
  return mockFetch((url) => {
    if (url.endsWith("/settings")) return { status: 200, body: { privacyEnabled: opts.privacy } }
    if (url.endsWith("/collections")) return { status: 200, body: opts.collections ?? [] }
    if (url.endsWith("/tags")) return { status: 200, body: opts.tags ?? [] }
    return { status: 404 }
  })
}

function Harness() {
  return (
    <RevealAllProvider>
      <FloatingActionDock>
        <RevealAllFloatingAction />
        <State />
      </FloatingActionDock>
    </RevealAllProvider>
  )
}
function State() {
  const { revealAll } = useRevealAll()
  return <span data-testid="state">{revealAll ? "on" : "off"}</span>
}

const button = () => screen.queryByRole("button", { name: /private items/ })

describe("RevealAllFloatingAction", () => {
  it("is hidden when privacy is off", async () => {
    const fetchFn = serve({ privacy: false, collections: [PRIVATE_COLLECTION] })
    renderWithProviders(<Harness />)
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(3))
    await new Promise((r) => setTimeout(r, 20))
    expect(button()).toBeNull()
  })

  it("is hidden when privacy is on but nothing is private", async () => {
    const fetchFn = serve({
      privacy: true,
      collections: [PUBLIC_COLLECTION, EMPTY_PRIVATE_COLLECTION],
      tags: [{ id: 1, isPrivate: true, usageCount: 0 }],
    })
    renderWithProviders(<Harness />)
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(3))
    await new Promise((r) => setTimeout(r, 20))
    expect(button()).toBeNull()
  })

  it("is shown for a private collection with items", async () => {
    serve({ privacy: true, collections: [PRIVATE_COLLECTION] })
    renderWithProviders(<Harness />)
    expect(await screen.findByRole("button", { name: "Reveal all private items" })).toBeInTheDocument()
  })

  it("is shown for a private tag in use", async () => {
    serve({ privacy: true, tags: [{ id: 1, isPrivate: true, usageCount: 2 }] })
    renderWithProviders(<Harness />)
    expect(await screen.findByRole("button", { name: "Reveal all private items" })).toBeInTheDocument()
  })

  it("toggles reveal-all and flips label and active state", async () => {
    serve({ privacy: true, collections: [PRIVATE_COLLECTION] })
    renderWithProviders(<Harness />)
    const on = await screen.findByRole("button", { name: "Reveal all private items" })
    expect(on).toHaveAttribute("data-variant", "outline")
    await userEvent.click(on)
    const off = await screen.findByRole("button", { name: "Hide all private items" })
    expect(off).toHaveAttribute("data-variant", "default")
    expect(screen.getByTestId("state")).toHaveTextContent("on")
    await userEvent.click(off)
    expect(await screen.findByRole("button", { name: "Reveal all private items" })).toBeInTheDocument()
    expect(screen.getByTestId("state")).toHaveTextContent("off")
  })

  it("keeps reveal-all on across navigation between pages sharing the provider", async () => {
    serve({ privacy: true, collections: [PRIVATE_COLLECTION] })
    renderWithProviders(
      <RevealAllProvider>
        <FloatingActionDock>
          <Link to="/b">go b</Link>
          <Routes>
            <Route path="/" element={<><RevealAllFloatingAction /><State /></>} />
            <Route path="/b" element={<><RevealAllFloatingAction /><State /></>} />
          </Routes>
        </FloatingActionDock>
      </RevealAllProvider>,
    )
    await userEvent.click(await screen.findByRole("button", { name: "Reveal all private items" }))
    await userEvent.click(screen.getByText("go b"))
    expect(await screen.findByRole("button", { name: "Hide all private items" })).toBeInTheDocument()
    expect(screen.getByTestId("state")).toHaveTextContent("on")
  })
})

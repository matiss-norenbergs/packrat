import { cleanup, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import { PrivateLock } from "@/components/collections/PrivateLock"
import { TooltipProvider } from "@/components/ui/tooltip"
import { mockFetch, renderWithProviders } from "@/test/mockApi"
import type { Collection } from "@/types/api"

afterEach(cleanup)

function col(over: Partial<Collection>): Collection {
  return { id: 1, name: "C", parentId: null, isPrivate: false, effectiveIsPrivate: false, ...over } as Collection
}

const PARENT = col({ id: 1, name: "Movies", isPrivate: true, effectiveIsPrivate: true })
const CHILD = col({ id: 2, name: "Action", parentId: 1, effectiveIsPrivate: true })
const PLAIN = col({ id: 3, name: "Plain" })
const ALL = [PARENT, CHILD, PLAIN]

function renderLock(c: Collection, privacy = true) {
  mockFetch((url) =>
    url.endsWith("/settings") ? { status: 200, body: { privacyEnabled: privacy } } : { status: 404 },
  )
  return renderWithProviders(
    <TooltipProvider>
      <PrivateLock collection={c} collections={ALL} className="h-3 w-3" />
    </TooltipProvider>,
  )
}

describe("PrivateLock", () => {
  it("renders nothing with privacy off", async () => {
    const { container } = renderLock(PARENT, false)
    await new Promise((r) => setTimeout(r, 20))
    expect(container.querySelector("svg")).toBeNull()
  })

  it("own private is primary with a Private tooltip", async () => {
    renderLock(PARENT)
    const icon = await screen.findByLabelText("Private")
    expect(icon).toHaveClass("text-primary")
    await userEvent.hover(icon)
    expect((await screen.findAllByText("Private")).length).toBeGreaterThan(0)
  })

  it("inherited only is muted and names the ancestor", async () => {
    renderLock(CHILD)
    const icon = await screen.findByLabelText("Inherited private")
    expect(icon).toHaveClass("text-muted-foreground")
    expect(icon).not.toHaveClass("text-primary")
    await userEvent.hover(icon)
    expect((await screen.findAllByText("Inherited from Movies")).length).toBeGreaterThan(0)
  })

  it("renders nothing for a non-private collection", async () => {
    const { container } = renderLock(PLAIN)
    await new Promise((r) => setTimeout(r, 20))
    expect(container.querySelector("svg")).toBeNull()
  })
})

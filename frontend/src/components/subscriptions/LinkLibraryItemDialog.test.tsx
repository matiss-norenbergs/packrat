import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { mockFetch, renderWithProviders } from "@/test/mockApi"
import type { SubscriptionEntry } from "@/types/api"
import { LinkLibraryItemDialog } from "./LinkLibraryItemDialog"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const entry = { sourceId: "s1", title: "foo" } as unknown as SubscriptionEntry
const A = { id: 1, title: "Alpha", filename: "a.mp4", tags: [], status: "ready" }

function setup(failing: Set<string>, listed: (url: string) => unknown[]) {
  mockFetch((url) => {
    for (const f of failing) if (url.includes(f)) return { status: 500, body: { error: "boom" } }
    if (url.includes("/library")) return { status: 200, body: { items: listed(url), total: 1 } }
    return { status: 200, body: {} }
  })
  renderWithProviders(
    <TooltipProvider>
      <LinkLibraryItemDialog subscriptionId={1} entry={entry} onOpenChange={() => {}} />
    </TooltipProvider>,
  )
}

describe("LinkLibraryItemDialog", () => {
  it("disables Link once the search changes away from the selection", async () => {
    const user = userEvent.setup()
    setup(new Set(), (url) => (url.includes("q=foo") ? [A] : []))
    await user.click(await screen.findByRole("button", { name: /Alpha/ }))
    expect(screen.getByRole("button", { name: "Link" })).toBeEnabled()
    const input = screen.getByPlaceholderText("Search library…")
    await user.clear(input)
    await user.type(input, "bar")
    expect(screen.getByRole("button", { name: "Link" })).toBeDisabled()
    expect(await screen.findByText("No matches.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Link" })).toBeDisabled()
  })

  it("shows an error with Retry for a failed search, not 'No matches.'", async () => {
    const user = userEvent.setup()
    const failing = new Set(["q=foo"])
    setup(failing, () => [A])
    expect(await screen.findByText("Search failed.")).toBeInTheDocument()
    expect(screen.queryByText("No matches.")).toBeNull()
    failing.clear()
    await user.click(screen.getByRole("button", { name: /retry/i }))
    await waitFor(() => expect(screen.getByRole("button", { name: /Alpha/ })).toBeInTheDocument())
  })
})

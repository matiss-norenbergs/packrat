import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mockFetch } from "@/test/mockApi"
import type { LibraryItem } from "@/types/api"
import { LibraryItemActionsMenu } from "./LibraryItemActionsMenu"

beforeEach(() => {
  mockFetch((url) => {
    if (url.endsWith("/settings")) return { status: 200, body: { thumbnailEnhancementEnabled: true, featureCompareListEnabled: true, featureFrameMatchingEnabled: true } }
    if (url.includes("compare")) return { status: 200, body: [] }
    return { status: 200, body: [] }
  })
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const item = (over: Partial<LibraryItem> = {}) =>
  ({ id: 1, title: "T", filename: "a.mp4", path: "m/a.mp4", mediaType: "video", status: "completed", originalUrl: "https://x/y", thumbnail: "t.jpg", generateNfo: true, nfoExists: true, tags: [], activeDownloadId: null, ...over }) as LibraryItem

async function openMenu(it: LibraryItem) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LibraryItemActionsMenu item={it} />
    </QueryClientProvider>,
  )
  await userEvent.click(screen.getByRole("button"))
}

describe("LibraryItemActionsMenu", () => {
  it("shows only Copy URL, Metadata and Delete while the item is downloading", async () => {
    await openMenu(item({ status: "ghost", activeDownloadId: 3 }))
    const entries = (await screen.findAllByRole("menuitem")).map((e) => e.textContent?.trim())
    expect(entries).toEqual(["Copy URL", "Metadata", "Delete"])
    expect(screen.queryByRole("menuitem", { name: /edit/i })).toBeNull()
    expect(screen.queryByRole("menuitem", { name: /redownload|download now/i })).toBeNull()
    // No separator at the edges of the menu.
    const menu = screen.getByRole("menu")
    expect(menu.firstElementChild?.getAttribute("role")).not.toBe("separator")
    expect(menu.lastElementChild?.getAttribute("role")).not.toBe("separator")
  })

  it("is the normal menu without an active download", async () => {
    await openMenu(item())
    const entries = (await screen.findAllByRole("menuitem")).map((e) => e.textContent?.trim())
    expect(entries).toContain("Edit")
    expect(entries).toContain("Move")
    expect(entries).toContain("Redownload")
  })
})

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactElement } from "react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ArtistDialog } from "@/components/artists/ArtistDialog"
import { CollectionDialog } from "@/components/collections/CollectionDialog"
import { EditLibraryItemDialog } from "@/components/library/EditLibraryItemDialog"
import { RevealAllProvider } from "@/components/library/RevealAllContext"
import { EditSubscriptionDialog } from "@/components/subscriptions/EditSubscriptionDialog"
import { TagDialog } from "@/components/tags/TagDialog"
import { TooltipProvider } from "@/components/ui/tooltip"
import { mockFetch } from "@/test/mockApi"
import type { Artist, Collection, LibraryItem, Subscription, Tag } from "@/types/api"

// A refetch hands an open edit dialog a NEW object for the same row. What the user typed must survive;
// opening another target, or reopening, re-seeds from the (latest) server values.

beforeEach(() => {
  mockFetch((url) => ({ status: 200, body: url.endsWith("/settings") ? {} : [] }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function harness(make: (ui: { open: boolean }) => ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrap = (el: ReactElement) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TooltipProvider>
          <RevealAllProvider>{el}</RevealAllProvider>
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
  const view = render(wrap(make({ open: true })))
  return {
    rerender: (el: ReactElement) => view.rerender(wrap(el)),
  }
}

const item = (over: Partial<LibraryItem> = {}) =>
  ({ id: 1, title: "Server title", filename: "a.mp4", tags: [], generateNfo: false, activeDownloadId: null, ...over }) as unknown as LibraryItem
const sub = (over: Partial<Subscription> = {}) =>
  ({ id: 1, url: "https://x", title: "S", mediaType: "video", collectionId: null, tags: [], autoDownload: false, generateNfo: false, checkIntervalHours: 6, enabled: true, unseenEntryCount: 0, ...over }) as unknown as Subscription
const coll = (over: Partial<Collection> = {}) =>
  ({ id: 3, name: "Show", rootPath: "Show", defaultQuality: "best", defaultDownloadType: "video", isPrivate: false, browseAsShow: false, ...over }) as unknown as Collection
const tag = (over: Partial<Tag> = {}) => ({ id: 4, name: "tag", isPrivate: false, ...over }) as unknown as Tag
const artist = (over: Partial<Artist> = {}) => ({ id: 7, name: "Old", birthday: null, isPrivate: false, ...over }) as unknown as Artist

interface Case {
  name: string
  label: string
  render: (target: { id: number; field: string; noise: number }, open: boolean) => ReactElement
}

const noop = () => {}
const cases: Case[] = [
  {
    name: "EditLibraryItemDialog",
    label: "Title",
    render: (t, open) => <EditLibraryItemDialog open={open} onOpenChange={noop} item={item({ id: t.id, title: t.field, downloadedAt: String(t.noise), activeDownloadId: t.noise })} />,
  },
  {
    name: "CollectionDialog",
    label: "Name",
    render: (t, open) => <CollectionDialog open={open} onOpenChange={noop} collection={coll({ id: t.id, name: t.field, year: t.noise })} />,
  },
  {
    name: "TagDialog",
    label: "Name",
    render: (t, open) => <TagDialog open={open} onOpenChange={noop} tag={tag({ id: t.id, name: t.field, usageCount: t.noise } as Partial<Tag>)} />,
  },
  {
    name: "ArtistDialog",
    label: "Name",
    render: (t, open) => <ArtistDialog open={open} onOpenChange={noop} artist={artist({ id: t.id, name: t.field, usageCount: t.noise } as Partial<Artist>)} />,
  },
]

describe.each(cases)("$name re-seeding", ({ label, render: renderCase }) => {
  it("keeps typed edits across a refetch, re-seeds for another target and on reopen", async () => {
    const user = userEvent.setup()
    const h = harness(() => renderCase({ id: 1, field: "Server A", noise: 0 }, true))
    const input = () => screen.getByLabelText(label, { selector: "input" }) as HTMLInputElement
    expect(input().value).toBe("Server A")

    await user.type(input(), " + mine")
    expect(input().value).toBe("Server A + mine")

    // Refetch: same row, new object (and an unrelated field changed, server title too).
    h.rerender(renderCase({ id: 1, field: "Server A changed", noise: 5 }, true))
    expect(input().value).toBe("Server A + mine")

    // Another target in the same dialog instance re-seeds.
    h.rerender(renderCase({ id: 2, field: "Server B", noise: 5 }, true))
    expect(input().value).toBe("Server B")

    await user.type(input(), "!")
    // Close, then reopen: discards edits and starts from the latest server data.
    h.rerender(renderCase({ id: 2, field: "Server B v2", noise: 6 }, false))
    h.rerender(renderCase({ id: 2, field: "Server B v3", noise: 7 }, true))
    expect(input().value).toBe("Server B v3")
  })
})

describe("EditSubscriptionDialog re-seeding", () => {
  const r = (id: number, enabled: boolean, unseen: number, open = true) => (
    <EditSubscriptionDialog open={open} onOpenChange={noop} subscription={sub({ id, enabled, unseenEntryCount: unseen })} />
  )
  it("keeps the edit when unseenEntryCount changes, re-seeds for another subscription and on reopen", async () => {
    const user = userEvent.setup()
    const h = harness(() => r(1, true, 0))
    const box = () => screen.getByLabelText("Enabled")
    expect(box()).toHaveAttribute("data-state", "checked")
    await user.click(box())
    expect(box()).toHaveAttribute("data-state", "unchecked")

    h.rerender(r(1, true, 3))
    expect(box()).toHaveAttribute("data-state", "unchecked")

    h.rerender(r(2, true, 3))
    expect(box()).toHaveAttribute("data-state", "checked")

    await user.click(box())
    h.rerender(r(2, true, 4, false))
    h.rerender(r(2, true, 4, true))
    expect(box()).toHaveAttribute("data-state", "checked")
  })
})

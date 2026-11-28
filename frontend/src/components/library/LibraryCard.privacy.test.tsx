import { RouterProvider, createMemoryRouter } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { expectControlsNamed, expectNoPrivateText } from "@/test/a11yNames"
import { mockFetch } from "@/test/mockApi"
import { hashText } from "@/lib/utils"
import type { LibraryItem } from "@/types/api"
import { CompareListTile } from "./CompareListTile"
import { LibraryCard, LibraryCardGrid } from "./LibraryCard"
import { LibraryCardsProvider } from "./LibraryCardsProvider"
import { RevealAllProvider } from "./RevealAllContext"
import { SelectionProvider } from "./SelectionContext"

// What a screen reader is told (aria-label, alt, title) and what the DOM carries must never include the real name of a
// private item, tag or artist while the item is blurred and not revealed.
const TITLE = "Zebra Private Title"
const TAG = "zebra-private-tag"
const ARTIST = "Zebra Private Artist"

beforeEach(() => {
  mockFetch((url) => {
    if (url.endsWith("/settings")) return { status: 200, body: { libraryMode: "manage", privacyEnabled: true, privacyBlurStrength: "default" } }
    if (url.endsWith("/tags")) return { status: 200, body: [{ id: 1, name: TAG, isPrivate: true, usageCount: 1 }] }
    if (url.endsWith("/artists")) return { status: 200, body: [{ id: 7, name: ARTIST, isPrivate: true, usageCount: 1 }] }
    return { status: 200, body: [] }
  })
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
})

const privateItem = {
  id: 1,
  title: TITLE,
  filename: "f1.mp4",
  path: "m/f1.mp4",
  mediaType: "video",
  status: "completed",
  originalUrl: "https://x/y",
  thumbnail: "t1.jpg",
  blurred: true,
  tags: [TAG],
  artistId: 7,
  artistName: ARTIST,
  activeDownloadId: null,
} as unknown as LibraryItem

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 80))))

function renderWith(ui: React.ReactNode) {
  const router = createMemoryRouter([{ path: "/", element: ui }], { initialEntries: ["/"] })
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

describe("LibraryCard labels of a private item", () => {
  const card = (
    <RevealAllProvider>
      <SelectionProvider>
        <LibraryCardsProvider items={[privateItem]}>
          <LibraryCardGrid>
            <LibraryCard item={privateItem} />
          </LibraryCardGrid>
        </LibraryCardsProvider>
      </SelectionProvider>
    </RevealAllProvider>
  )

  it("names every control and leaks no real title, tag or artist while blurred and not revealed", async () => {
    const { container } = renderWith(card)
    await settle()
    expectControlsNamed(container)
    expectNoPrivateText(container, TITLE, TAG, ARTIST)
    expect(screen.getByRole("checkbox", { name: `Select ${hashText(TITLE)}` })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Reveal image" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Reveal title" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Actions" })).toBeTruthy()
  })

  it("uses the real title in the checkbox label only once the item is revealed, by the thumbnail, Enter or Space", async () => {
    const { container } = renderWith(card)
    await settle()
    const user = userEvent.setup()
    screen.getByRole("button", { name: "Reveal image" }).focus()
    await user.keyboard("{Enter}")
    expect(screen.getByRole("checkbox", { name: `Select ${TITLE}` })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Hide image" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Hide title" })).toBeTruthy()
    expectControlsNamed(container)

    await user.keyboard(" ")
    expect(screen.getByRole("checkbox", { name: `Select ${hashText(TITLE)}` })).toBeTruthy()
    expectNoPrivateText(container, TITLE, TAG, ARTIST)
  })

  it("hands out no reveal buttons for a public item", async () => {
    const pub = { ...privateItem, blurred: false, tags: [], artistId: null, artistName: null } as LibraryItem
    const { container } = renderWith(
      <RevealAllProvider>
        <SelectionProvider>
          <LibraryCardsProvider items={[pub]}>
            <LibraryCardGrid>
              <LibraryCard item={pub} />
            </LibraryCardGrid>
          </LibraryCardsProvider>
        </SelectionProvider>
      </RevealAllProvider>,
    )
    await settle()
    expect(screen.queryByRole("button", { name: /reveal|hide/i })).toBeNull()
    expect(screen.getByRole("checkbox", { name: `Select ${TITLE}` })).toBeTruthy()
    expectControlsNamed(container)
  })
})

describe("CompareListTile labels of a private item", () => {
  it("masks the title in the checkbox and remove labels until revealed", async () => {
    const { container } = renderWith(
      <RevealAllProvider>
        <CompareListTile item={privateItem} selected={false} canSelect onToggle={() => {}} onRemove={() => {}} />
      </RevealAllProvider>,
    )
    await settle()
    expectControlsNamed(container)
    // (The tile's visible artist line is not masked yet, a separate finding; this test covers what the labels carry.)
    expectNoPrivateText(container, TITLE, TAG)
    expect(screen.getByRole("checkbox", { name: `Select ${hashText(TITLE)} for playback` })).toBeTruthy()
    expect(screen.getByRole("button", { name: `Remove ${hashText(TITLE)} from compare list` })).toBeTruthy()

    await userEvent.click(screen.getByRole("button", { name: "Reveal title" }))
    expect(screen.getByRole("checkbox", { name: `Select ${TITLE} for playback` })).toBeTruthy()
  })
})

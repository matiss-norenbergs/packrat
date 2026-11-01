import { useState } from "react"
import { cleanup, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FloatingActionDock } from "@/components/FloatingActionDock"
import { RevealAllProvider, useRevealAll } from "@/components/library/RevealAllContext"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ArtistImagesPanel, ArtistsPage } from "@/pages/ArtistsPage"
import { mockFetch, renderWithProviders } from "@/test/mockApi"
import { hashText } from "@/lib/utils"
import type { Artist } from "@/types/api"

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function artist(over: Partial<Artist>): Artist {
  return {
    id: 1,
    name: "A",
    selectedImagePath: "sel.jpg",
    birthday: null,
    isPrivate: false,
    createdAt: "",
    usageCount: 0,
    ...over,
  }
}

const PRIV = artist({ id: 1, name: "Priv", isPrivate: true, selectedImagePath: "p-sel.jpg" })
const PUB = artist({ id: 2, name: "Pub", selectedImagePath: "u-sel.jpg" })
const ARTISTS = [PRIV, PUB]

const GALLERY: Record<number, { id: number; artistId: number; relativePath: string; createdAt: string }[]> = {
  1: [1, 2, 3].map((n) => ({ id: n, artistId: 1, relativePath: `p-${n}.jpg`, createdAt: "" })),
  2: [4, 5].map((n) => ({ id: n, artistId: 2, relativePath: `u-${n}.jpg`, createdAt: "" })),
}

function serve(privacy = true, artists: Artist[] = ARTISTS) {
  mockFetch((url) => {
    if (url.endsWith("/settings")) return { status: 200, body: { privacyEnabled: privacy } }
    if (url.endsWith("/artists")) return { status: 200, body: artists }
    const m = url.match(/\/artists\/(\d+)\/images$/)
    if (m) return { status: 200, body: GALLERY[Number(m[1])] ?? [] }
    if (url.endsWith("/collections") || url.endsWith("/tags")) return { status: 200, body: [] }
    return { status: 404 }
  })
}

const imgs = () => Array.from(document.querySelectorAll("img")) as HTMLImageElement[]
const blurredFlags = () => imgs().map((i) => i.className.includes("blur-"))
const allBlurred = () => blurredFlags().length > 0 && blurredFlags().every(Boolean)
const noneBlurred = () => blurredFlags().length > 0 && blurredFlags().every((b) => !b)

function Harness({ panelInitiallyOpen = true }: { panelInitiallyOpen?: boolean }) {
  const [current, setCurrent] = useState<Artist | undefined>(PRIV)
  const [open, setOpen] = useState(panelInitiallyOpen)
  const { toggleRevealAll } = useRevealAll()
  return (
    <>
      {ARTISTS.map((a) => (
        <button key={a.id} onClick={() => setCurrent(a)}>
          select {a.name}
        </button>
      ))}
      <button onClick={() => setCurrent(undefined)}>select none</button>
      <button onClick={() => setOpen((o) => !o)}>toggle panel</button>
      <button onClick={toggleRevealAll}>toggle all</button>
      <ArtistImagesPanel artist={current} selectedCount={current ? 1 : 0} panelOpen={open} />
    </>
  )
}

function renderPanel(privacy = true) {
  serve(privacy)
  return renderWithProviders(
    <TooltipProvider>
      <RevealAllProvider>
        <Harness />
      </RevealAllProvider>
    </TooltipProvider>,
  )
}

describe("ArtistImagesPanel privacy", () => {
  it("blurs the selected image and every gallery thumbnail of a private artist", async () => {
    renderPanel()
    await waitFor(() => expect(imgs()).toHaveLength(1 + 3))
    expect(allBlurred()).toBe(true)
  })

  it("does not blur a public artist", async () => {
    const user = userEvent.setup()
    renderPanel()
    await waitFor(() => expect(allBlurred()).toBe(true))
    await user.click(screen.getByText("select Pub"))
    await waitFor(() => expect(imgs()).toHaveLength(1 + 2))
    expect(noneBlurred()).toBe(true)
  })

  it("does not blur with the master switch off", async () => {
    renderPanel(false)
    await waitFor(() => expect(imgs()).toHaveLength(1 + 3))
    expect(noneBlurred()).toBe(true)
  })

  it("a click on any image reveals and hides all of the artist's images together", async () => {
    const user = userEvent.setup()
    renderPanel()
    await waitFor(() => expect(imgs()).toHaveLength(4))
    await user.click(imgs()[2])
    expect(noneBlurred()).toBe(true)
    await user.click(imgs()[0])
    expect(allBlurred()).toBe(true)
  })

  it("a click reveal is dropped on selecting another artist, clearing, and closing the panel", async () => {
    const user = userEvent.setup()
    renderPanel()
    await waitFor(() => expect(imgs()).toHaveLength(4))
    await user.click(imgs()[0])
    expect(noneBlurred()).toBe(true)

    await user.click(screen.getByText("select Pub"))
    await user.click(screen.getByText("select Priv"))
    await waitFor(() => expect(imgs()).toHaveLength(4))
    expect(allBlurred()).toBe(true)

    await user.click(imgs()[0])
    await user.click(screen.getByText("select none"))
    await user.click(screen.getByText("select Priv"))
    await waitFor(() => expect(imgs()).toHaveLength(4))
    expect(allBlurred()).toBe(true)

    await user.click(imgs()[0])
    expect(noneBlurred()).toBe(true)
    await user.click(screen.getByText("toggle panel"))
    await user.click(screen.getByText("toggle panel"))
    await waitFor(() => expect(imgs()).toHaveLength(4))
    expect(allBlurred()).toBe(true)
  })

  it("reveal-all reveals, survives selection changes, and turning it off re-blurs click-revealed images too", async () => {
    const user = userEvent.setup()
    renderPanel()
    await waitFor(() => expect(imgs()).toHaveLength(4))
    await user.click(imgs()[0])
    await user.click(screen.getByText("toggle all"))
    expect(noneBlurred()).toBe(true)
    await user.click(screen.getByText("select Pub"))
    await user.click(screen.getByText("select Priv"))
    await waitFor(() => expect(imgs()).toHaveLength(4))
    expect(noneBlurred()).toBe(true)
    await user.click(screen.getByText("toggle all"))
    expect(allBlurred()).toBe(true)
  })
})

function renderPage(privacy: boolean, artists: Artist[] = ARTISTS) {
  serve(privacy, artists)
  return renderWithProviders(
    <TooltipProvider>
      <RevealAllProvider>
        <FloatingActionDock>
          <ArtistsPage />
        </FloatingActionDock>
      </RevealAllProvider>
    </TooltipProvider>,
  )
}

const fab = () => screen.queryByRole("button", { name: /private items/ })

describe("ArtistsPage privacy", () => {
  it("shows the Private column with a lock only for private artists, only with privacy on", async () => {
    const { unmount } = renderPage(true)
    await screen.findByText(hashText("Priv"))
    expect(screen.getByRole("columnheader", { name: "Private" })).toBeInTheDocument()
    const rows = screen.getAllByRole("row")
    const rowOf = (name: string) => rows.find((r) => within(r).queryByText(name)) as HTMLElement
    expect(within(rowOf(hashText("Priv"))).getByLabelText("Private")).toBeInTheDocument()
    expect(within(rowOf("Pub")).queryByLabelText("Private")).toBeNull()
    unmount()

    renderPage(false)
    await screen.findByText("Priv")
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole("columnheader", { name: "Private" })).toBeNull()
    expect(screen.queryByLabelText("Private")).toBeNull()
  })

  it("floating button appears for a private artist alone and reveals the panel images", async () => {
    const user = userEvent.setup()
    renderPage(true)
    await user.click(await screen.findByText(hashText("Priv")))
    await waitFor(() => expect(imgs().length).toBeGreaterThan(1))
    expect(allBlurred()).toBe(true)
    await user.click(await screen.findByRole("button", { name: "Reveal all private items" }))
    expect(noneBlurred()).toBe(true)
    await user.click(screen.getByRole("button", { name: "Hide all private items" }))
    expect(allBlurred()).toBe(true)
  })

  it("hides the floating button with privacy off or when no artist is private", async () => {
    const { unmount } = renderPage(false)
    await screen.findByText("Priv")
    await new Promise((r) => setTimeout(r, 20))
    expect(fab()).toBeNull()
    unmount()

    renderPage(true, [PUB])
    await screen.findByText("Pub")
    await new Promise((r) => setTimeout(r, 20))
    expect(fab()).toBeNull()
  })
})

import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { CollectionInfoPanel } from "@/components/collections/CollectionInfoPanel"
import { RevealAllProvider, useRevealAll } from "@/components/library/RevealAllContext"
import { TooltipProvider } from "@/components/ui/tooltip"
import { mockFetch, renderWithProviders } from "@/test/mockApi"
import type { Collection } from "@/types/api"

afterEach(cleanup)

function col(over: Partial<Collection>): Collection {
  return {
    id: 1,
    name: "C",
    parentId: null,
    rootPath: "/r",
    path: "C",
    defaultQuality: "best",
    defaultDownloadType: "video",
    filenameTemplate: "",
    isPrivate: false,
    effectiveIsPrivate: false,
    seasonNumber: null,
    year: null,
    sequenceMin: null,
    sequenceMax: null,
    artistId: null,
    coverImagePath: "c.jpg",
    coverImageSmallPath: null,
    coverImageMediumPath: null,
    browseAsShow: false,
    itemCount: 1,
    totalItemCount: 1,
    ghostItemCount: 0,
    totalGhostItemCount: 0,
    sequenceGaps: null,
    latestItemThumbnailPath: null,
    jellyfinLibraryId: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  } as Collection
}

const GRAND = col({ id: 1, name: "Movies", isPrivate: true, effectiveIsPrivate: true })
const PARENT = col({ id: 2, name: "Action", parentId: 1, effectiveIsPrivate: true })
const CHILD = col({ id: 3, name: "Heat", parentId: 2, effectiveIsPrivate: true })
const PLAIN = col({ id: 4, name: "Plain" })
const ALL = [GRAND, PARENT, CHILD, PLAIN]

function serve(privacy = true) {
  mockFetch((url) => {
    if (url.endsWith("/settings")) return { status: 200, body: { privacyEnabled: privacy } }
    if (url.endsWith("/collections")) return { status: 200, body: ALL }
    if (url.endsWith("/artists")) return { status: 200, body: [] }
    return { status: 404 }
  })
}

function Harness({ initial }: { initial: Collection }) {
  const [current, setCurrent] = useState(initial)
  const { toggleRevealAll } = useRevealAll()
  return (
    <>
      {ALL.map((c) => (
        <button key={c.id} onClick={() => setCurrent(c)}>
          select {c.name}
        </button>
      ))}
      <button onClick={toggleRevealAll}>toggle all</button>
      <CollectionInfoPanel collection={current} selectedCount={1} />
    </>
  )
}

function renderPanel(initial: Collection, privacy = true) {
  serve(privacy)
  return renderWithProviders(
    <TooltipProvider>
      <RevealAllProvider>
        <Harness initial={initial} />
      </RevealAllProvider>
    </TooltipProvider>,
  )
}

const cover = () => document.querySelector("img") as HTMLImageElement
const blurred = () => cover().className.includes("blur-")
const privateRow = () => screen.getByText("Private").parentElement as HTMLElement

describe("CollectionInfoPanel privacy", () => {
  it("blurs own-private and inherited-private covers, not plain ones", async () => {
    const user = userEvent.setup()
    renderPanel(GRAND)
    await waitFor(() => expect(blurred()).toBe(true))
    await user.click(screen.getByText("select Heat"))
    expect(blurred()).toBe(true)
    await user.click(screen.getByText("select Plain"))
    expect(blurred()).toBe(false)
  })

  it("does not blur with the master switch off and shows No", async () => {
    renderPanel(CHILD, false)
    await waitFor(() => expect(privateRow()).toHaveTextContent("No"))
    expect(blurred()).toBe(false)
  })

  it("click reveals and hides; the reveal is kept per collection across selection", async () => {
    const user = userEvent.setup()
    renderPanel(GRAND)
    await waitFor(() => expect(blurred()).toBe(true))
    await user.click(cover())
    expect(blurred()).toBe(false)
    await user.click(screen.getByText("select Heat"))
    expect(blurred()).toBe(true)
    await user.click(screen.getByText("select Movies"))
    expect(blurred()).toBe(false)
    await user.click(cover())
    expect(blurred()).toBe(true)
  })

  it("reveal-all reveals and turning it off re-blurs, including individual reveals", async () => {
    const user = userEvent.setup()
    renderPanel(GRAND)
    await waitFor(() => expect(blurred()).toBe(true))
    await user.click(cover())
    await user.click(screen.getByText("select Heat"))
    await user.click(screen.getByText("toggle all"))
    expect(blurred()).toBe(false)
    await user.click(screen.getByText("toggle all"))
    expect(blurred()).toBe(true)
    await user.click(screen.getByText("select Movies"))
    expect(blurred()).toBe(true)
  })

  it("Private row: Yes / Inherited (nearest private ancestor) / No", async () => {
    const user = userEvent.setup()
    renderPanel(GRAND)
    await waitFor(() => expect(privateRow()).toHaveTextContent("Yes"))
    await user.click(screen.getByText("select Heat"))
    const badge = await screen.findByText("Inherited")
    await user.hover(badge)
    expect((await screen.findAllByText("Inherited from Movies")).length).toBeGreaterThan(0)
    await user.unhover(badge)
    await user.click(screen.getByText("select Action"))
    expect(screen.getByText("Inherited")).toBeInTheDocument()
    await user.click(screen.getByText("select Plain"))
    expect(privateRow()).toHaveTextContent("No")
  })
})

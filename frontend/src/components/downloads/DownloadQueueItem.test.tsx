import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DownloadQueueItem } from "@/components/downloads/DownloadQueueItem"
import { RevealAllProvider, useRevealAll } from "@/components/library/RevealAllContext"
import { TooltipProvider } from "@/components/ui/tooltip"
import { downloadRevealKey } from "@/lib/revealKeys"
import { hashText } from "@/lib/utils"
import { expectControlsNamed, expectNoPrivateText } from "@/test/a11yNames"
import { mockFetch } from "@/test/mockApi"
import type { Download } from "@/types/api"

afterEach(cleanup)
beforeEach(() => {
  mockFetch(() => ({ status: 200, body: {} }))
})

function makeDownload(over: Partial<Download>): Download {
  return {
    id: 1,
    url: "https://example.com/v/1",
    collectionId: null,
    collectionName: null,
    folder: "",
    filename: "",
    downloadType: "video",
    quality: "best",
    audioFormat: null,
    status: "completed",
    title: "Secret Title",
    uploader: null,
    duration: null,
    thumbnail: "/thumb/1.jpg",
    errorMessage: null,
    createdAt: "",
    updatedAt: "",
    completedAt: null,
    percent: 100,
    speedBytesPerSec: 0,
    etaSeconds: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    blurred: true,
    ...over,
  }
}

function Toggle() {
  const { revealAll, toggleRevealAll } = useRevealAll()
  return <button onClick={toggleRevealAll}>{revealAll ? "all-on" : "all-off"}</button>
}

function renderRows(downloads: Download[]) {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <RevealAllProvider>
          <Toggle />
          {downloads.map((d) => (
            <DownloadQueueItem
              key={d.id}
              download={d}
              selected={false}
              onSelectedChange={() => {}}
              onMouseDown={() => {}}
              onMouseEnter={() => {}}
            />
          ))}
        </RevealAllProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

const A = makeDownload({
  id: 1,
  title: "Alpha Secret",
  thumbnail: "/thumb/1.jpg",
})
const B = makeDownload({
  id: 2,
  title: "Bravo Secret",
  thumbnail: "/thumb/2.jpg",
})
const thumb = (n: number) => document.querySelector(`img[src="/thumb/${n}.jpg"]`) as HTMLImageElement
const isBlurredImg = (n: number) => thumb(n).className.includes("grayscale")

describe("downloadRevealKey", () => {
  it("never produces an integer, so it cannot collide with item (positive) or show (negative) keys", () => {
    for (const id of [1, 2, 50, 12345]) {
      expect(Number.isInteger(downloadRevealKey(id))).toBe(false)
    }
  })
})

describe("DownloadQueueItem reveal", () => {
  it("is blurred and hashed by default", () => {
    renderRows([A])
    expect(screen.getByText(hashText("Alpha Secret"))).toBeInTheDocument()
    expect(screen.queryByText("Alpha Secret")).toBeNull()
    expect(isBlurredImg(1)).toBe(true)
  })

  it("reveals only that row when its title is clicked, and hides it again", async () => {
    const user = userEvent.setup()
    renderRows([A, B])
    await user.click(screen.getByText(hashText("Alpha Secret")))
    expect(screen.getByText("Alpha Secret")).toBeInTheDocument()
    expect(isBlurredImg(1)).toBe(false)
    expect(screen.getByText(hashText("Bravo Secret"))).toBeInTheDocument()
    expect(isBlurredImg(2)).toBe(true)
    await user.click(screen.getByText("Alpha Secret"))
    expect(screen.getByText(hashText("Alpha Secret"))).toBeInTheDocument()
    expect(isBlurredImg(1)).toBe(true)
  })

  it("reveals only that row when its thumbnail is clicked, and hides it again", async () => {
    const user = userEvent.setup()
    renderRows([A, B])
    await user.click(thumb(2))
    expect(screen.getByText("Bravo Secret")).toBeInTheDocument()
    expect(isBlurredImg(2)).toBe(false)
    expect(isBlurredImg(1)).toBe(true)
    await user.click(thumb(2))
    expect(screen.getByText(hashText("Bravo Secret"))).toBeInTheDocument()
    expect(isBlurredImg(2)).toBe(true)
  })

  it("reveal-all reveals every blurred row; turning it off re-blurs, including individually revealed rows", async () => {
    const user = userEvent.setup()
    renderRows([A, B])
    await user.click(screen.getByText(hashText("Alpha Secret")))
    await user.click(screen.getByText("all-off"))
    expect(screen.getByText("Alpha Secret")).toBeInTheDocument()
    expect(screen.getByText("Bravo Secret")).toBeInTheDocument()
    expect(isBlurredImg(1)).toBe(false)
    expect(isBlurredImg(2)).toBe(false)
    await user.click(screen.getByText("all-on"))
    expect(screen.getByText(hashText("Alpha Secret"))).toBeInTheDocument()
    expect(screen.getByText(hashText("Bravo Secret"))).toBeInTheDocument()
    expect(isBlurredImg(1)).toBe(true)
    expect(isBlurredImg(2)).toBe(true)
  })

  it("never blurs a non-blurred row", () => {
    renderRows([
      makeDownload({
        id: 3,
        title: "Plain",
        thumbnail: "/thumb/3.jpg",
        blurred: false,
      }),
    ])
    expect(screen.getByText("Plain")).toBeInTheDocument()
    expect(isBlurredImg(3)).toBe(false)
  })
})

describe("DownloadQueueItem thumbnail source", () => {
  const imgSrc = () => document.querySelector("img")?.getAttribute("src") ?? null

  it("sends a remote thumbnail through the preview proxy", () => {
    renderRows([makeDownload({ blurred: false, thumbnail: "https://cdn.example.com/t.jpg?a=1&b=2" })])
    expect(imgSrc()).toBe(
      `/api/downloads/preview-image?url=${encodeURIComponent("https://cdn.example.com/t.jpg?a=1&b=2")}&kind=thumbnail`,
    )
  })

  it("keeps a local path and renders nothing for a bad scheme", () => {
    renderRows([makeDownload({ blurred: false, thumbnail: "/thumb/1.jpg" })])
    expect(imgSrc()).toBe("/thumb/1.jpg")
    cleanup()
    renderRows([makeDownload({ blurred: false, thumbnail: "javascript:alert(1)" })])
    expect(imgSrc()).toBeNull()
  })
})

describe("DownloadQueueItem accessible names", () => {
  it("names every control, with the checkbox label masked like the visible title (never the real name while hidden)", async () => {
    const user = userEvent.setup()
    const { container } = renderRows([makeDownload({ id: 1, title: "Alpha Secret", status: "downloading", percent: 40 })])
    expectControlsNamed(container)
    expectNoPrivateText(container, "Alpha Secret")
    expect(screen.getByRole("checkbox", { name: `Select ${hashText("Alpha Secret")}` })).toBeInTheDocument()
    expect(screen.getByRole("progressbar", { name: "Download progress" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Reveal title" }))
    expect(screen.getByRole("checkbox", { name: "Select Alpha Secret" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Hide image" })).toHaveAttribute("aria-pressed", "true")
  })

  it("does not mask a public download's checkbox label", () => {
    renderRows([makeDownload({ id: 3, title: "Public One", blurred: false })])
    expect(screen.getByRole("checkbox", { name: "Select Public One" })).toBeInTheDocument()
  })
})

import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NewDownloadDialog } from "@/components/downloads/NewDownloadDialog"
import { RedownloadFromUrlDialog } from "@/components/library/RedownloadFromUrlDialog"
import { duplicateTitle, hashText } from "@/lib/utils"
import { mockFetch, renderWithProviders } from "@/test/mockApi"
import type { LibraryItem } from "@/types/api"

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

const SECRET = "My Private Video"
const duplicate = (blurred: boolean) => ({
  libraryItemId: 7,
  title: SECRET,
  thumbnail: "thumbs/secret.jpg",
  downloadedAt: "2026-01-02T03:04:05Z",
  blurred,
})

describe("duplicateTitle", () => {
  it("hashes the title only when the match is blurred", () => {
    expect(duplicateTitle({ title: SECRET, blurred: false })).toBe(SECRET)
    expect(duplicateTitle({ title: SECRET, blurred: true })).toBe(hashText(SECRET))
    expect(duplicateTitle({ title: SECRET, blurred: true })).not.toContain("Private")
  })
})

describe("New Download duplicate warning", () => {
  const serve = (blurred: boolean) =>
    mockFetch((url) => {
      if (url.endsWith("/downloads/preview")) {
        return {
          status: 200,
          body: { title: "Whatever", uploader: "u", uploadDate: "", duration: 10, thumbnail: null, resolution: null, isPlaylist: false, duplicate: duplicate(blurred) },
        }
      }
      if (url.endsWith("/settings")) return { status: 200, body: {} }
      if (url.endsWith("/collections") || url.endsWith("/tags") || url.endsWith("/artists")) return { status: 200, body: [] }
      return { status: 404 }
    })

  async function open() {
    renderWithProviders(<NewDownloadDialog />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: /New Download/ }))
    await user.type(await screen.findByPlaceholderText("https://..."), "https://example.com/watch?v=1")
  }

  it("shows the title hashed and no thumbnail for a blurred match", async () => {
    serve(true)
    await open()
    const notice = await screen.findByText(/Already in your library/, undefined, { timeout: 5000 })
    expect(notice).toHaveTextContent(hashText(SECRET))
    expect(notice).not.toHaveTextContent(SECRET)
    expect(notice.querySelector("img")).toBeNull()
    expect(document.body.innerHTML).not.toContain("secret.jpg")
  })

  it("shows the real title when the match is not blurred", async () => {
    serve(false)
    await open()
    const notice = await screen.findByText(/Already in your library/, undefined, { timeout: 5000 })
    expect(notice).toHaveTextContent(SECRET)
  })
})

describe("Redownload from URL duplicate warning", () => {
  const item = { id: 1, title: "Current", filename: "c.mp4", path: "c.mp4", blurred: false, tags: [] } as unknown as LibraryItem

  async function fetchPreview(blurred: boolean) {
    mockFetch((url) => {
      if (url.includes("/redownload/preview-url")) {
        return {
          status: 200,
          body: { title: "New", uploader: "", duration: 0, description: "", thumbnail: "", resolution: null, duplicate: duplicate(blurred) },
        }
      }
      return { status: 404 }
    })
    renderWithProviders(<RedownloadFromUrlDialog item={item} open onOpenChange={() => {}} />)
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText("https://…"), "https://example.com/x")
    await user.click(screen.getByRole("button", { name: "Fetch" }))
    return screen.findByText(/already in your library as/)
  }

  it("hashes the title of a blurred match", async () => {
    const notice = await fetchPreview(true)
    expect(notice).toHaveTextContent(hashText(SECRET))
    expect(notice).not.toHaveTextContent(SECRET)
    await waitFor(() => expect(document.body.innerHTML).not.toContain("secret.jpg"))
  })

  it("shows the title of an unblurred match", async () => {
    const notice = await fetchPreview(false)
    expect(notice).toHaveTextContent(SECRET)
  })
})

import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FloatingActionDock } from "@/components/FloatingActionDock"
import { RevealAllProvider } from "@/components/library/RevealAllContext"
import { TooltipProvider } from "@/components/ui/tooltip"
import { DownloadsPage } from "@/pages/DownloadsPage"
import { hashText } from "@/lib/utils"
import { mockFetch, renderWithProviders } from "@/test/mockApi"

beforeEach(() => {
  // NewDownloadDialog (in the toolbar) reads a media query on mount.
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

// 26 blurred downloads → two pages (PAGE_SIZE 25). The API returns them
// newest-first as-is; the page doesn't re-sort.
const DOWNLOADS = Array.from({ length: 26 }, (_, i) => ({
  id: i + 1,
  url: `https://example.com/v/${i + 1}`,
  status: "completed",
  title: `Video ${i + 1}`,
  thumbnail: null,
  errorMessage: null,
  percent: 100,
  speedBytesPerSec: 0,
  etaSeconds: 0,
  blurred: true,
}))

function serve(opts: { privacy: boolean; collections?: object[] }) {
  return mockFetch((url) => {
    if (url.endsWith("/settings")) return { status: 200, body: { privacyEnabled: opts.privacy } }
    if (url.endsWith("/collections")) return { status: 200, body: opts.collections ?? [] }
    if (url.endsWith("/tags")) return { status: 200, body: [] }
    if (url.endsWith("/downloads")) return { status: 200, body: DOWNLOADS }
    return { status: 404 }
  })
}

function renderPage() {
  return renderWithProviders(
    <TooltipProvider>
      <RevealAllProvider>
        <FloatingActionDock>
          <DownloadsPage />
        </FloatingActionDock>
      </RevealAllProvider>
    </TooltipProvider>,
  )
}

const PRIVATE = [{ id: 1, effectiveIsPrivate: true, totalItemCount: 3 }]
const fab = () => screen.queryByRole("button", { name: /private items/ })

describe("DownloadsPage reveal-all", () => {
  it("shows the floating button when privacy is on and a private collection has items", async () => {
    serve({ privacy: true, collections: PRIVATE })
    renderPage()
    expect(await screen.findByRole("button", { name: "Reveal all private items" })).toBeInTheDocument()
  })

  it("hides the button when privacy is off or nothing is private", async () => {
    serve({ privacy: false, collections: PRIVATE })
    const { unmount } = renderPage()
    await screen.findByText(hashText("Video 1"))
    await new Promise((r) => setTimeout(r, 20))
    expect(fab()).toBeNull()
    unmount()

    serve({
      privacy: true,
      collections: [{ id: 2, effectiveIsPrivate: false, totalItemCount: 5 }],
    })
    renderPage()
    await screen.findByText(hashText("Video 1"))
    await new Promise((r) => setTimeout(r, 20))
    expect(fab()).toBeNull()
  })

  it("reveals all blurred rows from the button", async () => {
    const user = userEvent.setup()
    serve({ privacy: true, collections: PRIVATE })
    renderPage()
    await screen.findByText(hashText("Video 1"))
    await user.click(await screen.findByRole("button", { name: "Reveal all private items" }))
    expect(screen.getByText("Video 1")).toBeInTheDocument()
    expect(screen.getByText("Video 25")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Hide all private items" }))
    expect(screen.getByText(hashText("Video 1"))).toBeInTheDocument()
  })

  it("keeps a row revealed across pagination", async () => {
    const user = userEvent.setup()
    serve({ privacy: true, collections: PRIVATE })
    renderPage()
    await user.click(await screen.findByText(hashText("Video 3")))
    expect(screen.getByText("Video 3")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText(hashText("Video 26"))
    await user.click(screen.getByRole("button", { name: "Previous" }))
    await waitFor(() => expect(screen.getByText("Video 3")).toBeInTheDocument())
    expect(screen.getByText(hashText("Video 4"))).toBeInTheDocument()
  })
})

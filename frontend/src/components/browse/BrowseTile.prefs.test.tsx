import { act, cleanup, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BrowseTile } from "@/components/browse/BrowseTile"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useBrowsePrefs } from "@/hooks/useBrowsePrefs"
import type { LibraryItem } from "@/types/api"
import { mockFetch, renderWithProviders } from "@/test/mockApi"
import { enterTauri, leaveTauri } from "@/test/tauriShell"

const ITEM = { id: 1, title: "Secret clip", blurred: true, status: "available", mediaType: "video", thumbnailSmallPath: null } as unknown as LibraryItem

// Stands in for the Settings dialog's switch and reset.
function PrefsProbe() {
  const prefs = useBrowsePrefs()
  return (
    <>
      <span data-testid="server-blur">{String(prefs.serverBlurPrivate)}</span>
      <button type="button" onClick={() => prefs.setBlurPrivate(false)}>
        blur off
      </button>
      <button type="button" onClick={prefs.resetBlurPrivate}>
        reset
      </button>
    </>
  )
}

beforeEach(() => {
  localStorage.clear()
  mockFetch((url) => (url.endsWith("/settings") ? { status: 200, body: { libraryAutoplay: true, browseIgnorePrivacy: false } } : { status: 404 }))
})
afterEach(() => {
  cleanup()
  leaveTauri()
  vi.unstubAllGlobals()
})

describe("BrowseTile and the Android app's blur override", () => {
  it("un-blurs and re-blurs at once when the device override changes", async () => {
    enterTauri("android")
    renderWithProviders(
      <TooltipProvider>
        <PrefsProbe />
        <BrowseTile item={ITEM} />
      </TooltipProvider>,
    )
    await waitFor(() => expect(screen.getByTestId("server-blur")).toHaveTextContent("true"))
    expect(screen.queryByRole("link", { name: "Secret clip" })).toBeNull() // blurred: no link, hashed title

    act(() => screen.getByRole("button", { name: "blur off" }).click())
    expect(screen.getByRole("link", { name: "Secret clip" })).toBeInTheDocument()

    act(() => screen.getByRole("button", { name: "reset" }).click())
    expect(screen.queryByRole("link", { name: "Secret clip" })).toBeNull()
  })
})

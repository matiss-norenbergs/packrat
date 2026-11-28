import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { RouterProvider, createMemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BrowseHeader } from "@/components/browse/BrowseHeader"
import { TooltipProvider } from "@/components/ui/tooltip"
import { BROWSE_AUTOPLAY_KEY, BROWSE_BLUR_PRIVATE_KEY } from "@/hooks/useBrowsePrefs"
import { activateProfile, addProfile } from "@/lib/serverProfiles"
import { mockFetch } from "@/test/mockApi"
import { enterTauri, leaveTauri } from "@/test/tauriShell"

const getVersion = vi.fn<() => Promise<string>>()
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => getVersion() }))

// jsdom lacks these, and Radix's menu calls them.
beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
  window.HTMLElement.prototype.hasPointerCapture = vi.fn()
  window.HTMLElement.prototype.releasePointerCapture = vi.fn()
  localStorage.clear()
  getVersion.mockReset().mockResolvedValue("1.4.0")
  activateProfile(addProfile("http://nas:50505", "Home").id)
})
afterEach(() => {
  leaveTauri()
})

type Server = { version?: number; settings?: { libraryAutoplay: boolean; browseIgnorePrivacy: boolean } }

function mockServer({ version = 200, settings = { libraryAutoplay: true, browseIgnorePrivacy: false } }: Server = {}) {
  return mockFetch((url) => {
    if (url.endsWith("/api/version")) return version === 200 ? { status: 200, body: { version: "1.3.2" } } : { status: version }
    if (url.endsWith("/api/settings")) return { status: 200, body: settings }
    return { status: 200 }
  })
}

// The header on a Browse page, with an earlier entry ("/browse/7") to go back to, so a test can
// tell "Back closed the dialog" from "Back left the page".
function renderHeader() {
  const router = createMemoryRouter([{ path: "/browse/*", element: <BrowseHeader /> }], {
    initialEntries: ["/browse/7", "/browse"],
    initialIndex: 1,
  })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return router
}

async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "App menu" }))
  await user.click(await screen.findByRole("menuitem", { name: "Settings" }))
  return screen.findByRole("dialog", { name: "Settings" })
}

describe("Browse Settings in the Android app", () => {
  beforeEach(() => enterTauri("android"))

  it("is in the app menu after Change server and before Sign out", async () => {
    mockServer()
    renderHeader()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "App menu" }))
    const items = (await screen.findAllByRole("menuitem")).map((el) => el.textContent?.trim())
    expect(items).toEqual(["Change server", "Settings", "Sign out"])
  })

  it("shows the effective values, following the server by default", async () => {
    mockServer({ settings: { libraryAutoplay: false, browseIgnorePrivacy: true } })
    renderHeader()
    await openSettings(userEvent.setup())
    const autoplay = screen.getByRole("switch", { name: /Autoplay/ })
    const blur = screen.getByRole("switch", { name: /Blur private items/ })
    await waitFor(() => expect(autoplay).toHaveAttribute("aria-checked", "false"))
    expect(blur).toHaveAttribute("aria-checked", "false") // browseIgnorePrivacy: true → no blur
    expect(screen.getAllByText("Following the server setting")).toHaveLength(2)
    expect(screen.queryByRole("button", { name: "Use server setting" })).toBeNull()
  })

  it("toggling sets a device override, reset follows the server again, and nothing is sent to the server", async () => {
    const fetchMock = mockServer({ settings: { libraryAutoplay: true, browseIgnorePrivacy: false } })
    renderHeader()
    const user = userEvent.setup()
    await openSettings(user)
    const blur = screen.getByRole("switch", { name: /Blur private items/ })
    await waitFor(() => expect(blur).toHaveAttribute("aria-checked", "true"))

    await user.click(blur)
    expect(blur).toHaveAttribute("aria-checked", "false")
    expect(localStorage.getItem(BROWSE_BLUR_PRIVATE_KEY)).toBe("false")
    expect(screen.getByText("Set on this device")).toBeInTheDocument()

    await user.click(screen.getByRole("switch", { name: /Autoplay/ }))
    expect(localStorage.getItem(BROWSE_AUTOPLAY_KEY)).toBe("false")

    const resets = screen.getAllByRole("button", { name: "Use server setting" })
    expect(resets).toHaveLength(2)
    await user.click(resets[1]) // the blur row's
    expect(blur).toHaveAttribute("aria-checked", "true")
    expect(localStorage.getItem(BROWSE_BLUR_PRIVATE_KEY)).toBeNull()
    expect(localStorage.getItem(BROWSE_AUTOPLAY_KEY)).toBe("false") // the other override stays

    const writes = fetchMock.mock.calls.filter(([, init]) => (init?.method ?? "GET").toUpperCase() !== "GET")
    expect(writes).toEqual([])
  })

  it("shows the app and server versions", async () => {
    mockServer()
    renderHeader()
    await openSettings(userEvent.setup())
    expect(await screen.findByText("v1.4.0")).toBeInTheDocument()
    expect(await screen.findByText("v1.3.2")).toBeInTheDocument()
  })

  it("says Unavailable when either version can't be read", async () => {
    getVersion.mockRejectedValue(new Error("no shell"))
    mockServer({ version: 500 })
    renderHeader()
    await openSettings(userEvent.setup())
    await waitFor(() => expect(screen.getAllByText("Unavailable")).toHaveLength(2))
  })

  it("Back closes the dialog and stays on the page", async () => {
    mockServer()
    const router = renderHeader()
    await openSettings(userEvent.setup())
    expect(router.state.location.state).toMatchObject({ browseSettings: true })

    await act(() => router.navigate(-1))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(router.state.location.pathname).toBe("/browse")
  })

  it("closing with the X leaves no extra history entry behind", async () => {
    mockServer()
    const router = renderHeader()
    const user = userEvent.setup()
    await openSettings(user)

    await user.click(screen.getByRole("button", { name: "Close" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(router.state.location.pathname).toBe("/browse")
    expect(router.state.location.state).toBeNull()

    // The next Back leaves the page, as it would have before the dialog was opened.
    await act(() => router.navigate(-1))
    expect(router.state.location.pathname).toBe("/browse/7")
  })

  it("an entry restored with the dialog open is cleaned up in place on close", async () => {
    mockServer()
    const router = createMemoryRouter([{ path: "/browse/*", element: <BrowseHeader /> }], {
      initialEntries: [{ pathname: "/browse", state: { browseSettings: true, from: "/browse/7" } }],
    })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </QueryClientProvider>,
    )
    const user = userEvent.setup()
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Close" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(router.state.historyAction).toBe("REPLACE")
    expect(router.state.location.state).toEqual({ from: "/browse/7" })
  })
})

describe.each([
  ["web", () => {}],
  ["desktop app", () => enterTauri("desktop")],
])("Browse Settings on the %s", (_name, enter) => {
  beforeEach(() => enter())

  it("isn't offered (no app menu, no Settings entry)", () => {
    mockServer()
    renderHeader()
    expect(screen.queryByRole("button", { name: "App menu" })).toBeNull()
    expect(screen.queryByText("Settings")).toBeNull()
  })
})

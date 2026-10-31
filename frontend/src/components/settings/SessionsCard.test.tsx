import { cleanup, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SessionsCard } from "@/components/settings/SessionsCard"
import { callsTo, mockFetch, renderWithProviders } from "@/test/mockApi"
import type { ActiveSession } from "@/types/api"

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m), success: (m: string) => toastSuccess(m) } }))

const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0"

const NOW = Date.now()
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

const THIS: ActiveSession = {
  id: "aaaa", client: "web", ip: "192.168.1.10", userAgent: CHROME_WIN, createdAt: iso(86_400_000), lastSeenAt: iso(1000), current: true,
}
const PHONE: ActiveSession = {
  id: "bbbb", client: "web", ip: "10.0.0.5", userAgent: FIREFOX_LINUX, createdAt: iso(3 * 86_400_000), lastSeenAt: iso(2 * 3_600_000), current: false,
}
const DESKTOP: ActiveSession = {
  id: "cccc", client: "desktop", ip: "10.0.0.6", userAgent: "", createdAt: iso(5 * 86_400_000), lastSeenAt: iso(10 * 60_000), current: false,
}
const LEGACY: ActiveSession = {
  id: "dddd", client: "", ip: "", userAgent: "", createdAt: iso(9 * 86_400_000), lastSeenAt: iso(9 * 86_400_000), current: false,
}

function fakeServer(initial: ActiveSession[]) {
  let sessions = [...initial]
  return mockFetch((url, init) => {
    if (url.endsWith("/auth/sessions") && (!init.method || init.method === "GET")) return { status: 200, body: { sessions } }
    if (url.endsWith("/auth/sessions/revoke-others")) {
      const revoked = sessions.filter((s) => !s.current).length
      sessions = sessions.filter((s) => s.current)
      return { status: 200, body: { revoked } }
    }
    const m = url.match(/\/auth\/sessions\/([^/]+)$/)
    if (m && init.method === "DELETE") {
      if (!sessions.some((s) => s.id === m[1])) return { status: 404, body: { error: "session not found" } }
      sessions = sessions.filter((s) => s.id !== m[1])
      return { status: 204 }
    }
    return { status: 404 }
  })
}

beforeEach(() => {
  toastError.mockReset()
  toastSuccess.mockReset()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("SessionsCard", () => {
  it("lists devices, marks this one and describes the rest", async () => {
    fakeServer([THIS, PHONE, DESKTOP, LEGACY])
    renderWithProviders(<SessionsCard />)

    const rows = await screen.findAllByRole("row")
    expect(rows).toHaveLength(5) // header + 4
    const [, thisRow, phoneRow, desktopRow, legacyRow] = rows
    expect(within(thisRow).getByText("Chrome on Windows")).toBeInTheDocument()
    expect(within(thisRow).getByText("This device")).toBeInTheDocument()
    expect(within(thisRow).getByText("192.168.1.10")).toBeInTheDocument()
    expect(within(thisRow).getByText("Now")).toBeInTheDocument()
    expect(within(phoneRow).getByText("Firefox on Linux")).toBeInTheDocument()
    expect(within(phoneRow).getByText("2 h ago")).toBeInTheDocument()
    expect(within(phoneRow).queryByText("This device")).not.toBeInTheDocument()
    expect(within(desktopRow).getByText("Packrat desktop app")).toBeInTheDocument()
    expect(within(desktopRow).getByText("10 min ago")).toBeInTheDocument()
    expect(within(legacyRow).getByText("Unknown device")).toBeInTheDocument()
    expect(within(legacyRow).getByText("—")).toBeInTheDocument()
  })

  it("centres the date columns and the action column's icon", async () => {
    fakeServer([THIS, PHONE])
    renderWithProviders(<SessionsCard />)
    const rows = await screen.findAllByRole("row")
    const cells = within(rows[2]).getAllByRole("cell")
    expect(cells[2]).toHaveClass("text-center") // signed in
    expect(cells[3]).toHaveClass("text-center") // last active
    expect(cells[4]).toHaveClass("text-center")
    expect(within(cells[4]).getByRole("button").parentElement).toHaveClass("flex", "justify-center") // icon cells centre their content
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Device", "IP address", "Signed in", "Last active", ""])
    expect(screen.getAllByRole("columnheader")[4]).not.toHaveClass("w-10")
    expect(screen.getByRole("table").parentElement).toHaveClass("max-h-80", "overflow-auto")
  })

  it("puts the user agent and the full dates in title attributes", async () => {
    fakeServer([THIS])
    renderWithProviders(<SessionsCard />)
    const [, row] = await screen.findAllByRole("row")
    expect(within(row).getByText("Chrome on Windows")).toHaveAttribute("title", CHROME_WIN)
    expect(within(row).getByText("Now")).toHaveAttribute("title", new Date(THIS.lastSeenAt).toLocaleString())
    expect(within(row).getByText(new Date(THIS.createdAt).toLocaleDateString())).toHaveAttribute("title", new Date(THIS.createdAt).toLocaleString())
  })

  it("disables every sign-out button while one is pending and re-enables them with a working handler", async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const fetchMock = fakeServer([THIS, PHONE, DESKTOP])
    const inner = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (init?.method === "DELETE" && url.endsWith("/auth/sessions/bbbb")) await gate
      return inner(url, init as never)
    })
    renderWithProviders(<SessionsCard />)
    const user = userEvent.setup()
    const phone = await screen.findByRole("button", { name: "Sign out Firefox on Linux" })
    const desktop = screen.getByRole("button", { name: "Sign out Packrat desktop app" })
    expect(phone).toBeEnabled()
    expect(desktop).toBeEnabled()

    await user.click(phone)
    await waitFor(() => expect(desktop).toBeDisabled())
    expect(screen.getByRole("button", { name: "Sign out this device" })).toBeDisabled()

    release()
    await waitFor(() => expect(screen.queryByText("Firefox on Linux")).not.toBeInTheDocument())
    // The memoized columns picked isPending back up, and the handler is the current one (targets the clicked row).
    const desktopAgain = screen.getByRole("button", { name: "Sign out Packrat desktop app" })
    await waitFor(() => expect(desktopAgain).toBeEnabled())
    await user.click(desktopAgain)
    await waitFor(() => expect(callsTo(fetchMock, "/auth/sessions/cccc")).toHaveLength(1))
    expect((callsTo(fetchMock, "/auth/sessions/cccc")[0][1] as RequestInit).method).toBe("DELETE")
  })

  it("signs out one device without a confirmation", async () => {
    const fetchMock = fakeServer([THIS, PHONE])
    renderWithProviders(<SessionsCard />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: "Sign out Firefox on Linux" }))

    await waitFor(() => expect(callsTo(fetchMock, "/auth/sessions/bbbb")).toHaveLength(1))
    expect((callsTo(fetchMock, "/auth/sessions/bbbb")[0][1] as RequestInit).method).toBe("DELETE")
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText("Firefox on Linux")).not.toBeInTheDocument())
    expect(toastSuccess).toHaveBeenCalledWith("Signed out Firefox on Linux")
  })

  it("confirms with the count before signing out all other devices", async () => {
    const fetchMock = fakeServer([THIS, PHONE, DESKTOP])
    renderWithProviders(<SessionsCard />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: "Sign out all other devices" }))

    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Sign out 2 other devices?")).toBeInTheDocument()
    expect(callsTo(fetchMock, "/auth/sessions/revoke-others")).toHaveLength(0)

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
    expect(callsTo(fetchMock, "/auth/sessions/revoke-others")).toHaveLength(0)

    await user.click(screen.getByRole("button", { name: "Sign out all other devices" }))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Sign out" }))
    await waitFor(() => expect(callsTo(fetchMock, "/auth/sessions/revoke-others")).toHaveLength(1))
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(2)) // header + this device
    expect(toastSuccess).toHaveBeenCalledWith("Signed out 2 other devices")
  })

  it("uses the singular for one other device", async () => {
    fakeServer([THIS, PHONE])
    renderWithProviders(<SessionsCard />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: "Sign out all other devices" }))
    expect(await screen.findByText("Sign out 1 other device?")).toBeInTheDocument()
  })

  it("handles having no other devices", async () => {
    fakeServer([THIS])
    renderWithProviders(<SessionsCard />)
    expect(await screen.findByText("No other devices are signed in.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Sign out all other devices" })).toBeDisabled()
  })

  it("signing out this device is a logout", async () => {
    const fetchMock = fakeServer([THIS, PHONE])
    renderWithProviders(<SessionsCard />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: "Sign out this device" }))
    await waitFor(() => expect(callsTo(fetchMock, "/auth/sessions/aaaa")).toHaveLength(1))
    // No "Signed out <device>" toast for your own session: you are simply taken to the login page.
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it("shows an error and refreshes when the session is already gone", async () => {
    const fetchMock = fakeServer([THIS, PHONE])
    renderWithProviders(<SessionsCard />)
    const user = userEvent.setup()
    const button = await screen.findByRole("button", { name: "Sign out Firefox on Linux" })
    // Revoked elsewhere meanwhile: the server no longer knows it.
    fetchMock.mockImplementationOnce(async () => ({
      ok: false, status: 404, statusText: "404", headers: { get: () => null }, json: async () => ({ error: "session not found" }),
    }))
    await user.click(button)
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("session not found"))
  })
})

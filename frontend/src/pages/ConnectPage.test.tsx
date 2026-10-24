import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { activateProfile, addProfile, getActiveProfile, getProfiles, isAddingServer, setAddingServer } from "@/lib/serverProfiles"
import { ConnectPage } from "@/pages/ConnectPage"
import { mockFetch } from "@/test/mockApi"

const reloadApp = vi.fn()
vi.mock("@/lib/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server")>()),
  reloadApp: () => reloadApp(),
}))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  reloadApp.mockReset()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const healthy = () => mockFetch(() => ({ status: 200, body: { status: "ok" } }))

describe("ConnectPage", () => {
  it("first run: saves the server as the first, active profile named after its host", async () => {
    healthy()
    render(<ConnectPage />)
    const user = userEvent.setup()
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull()
    expect(screen.getByLabelText(/Name/)).toHaveAttribute("placeholder", "e.g. Home server")
    await user.type(screen.getByLabelText("Server address"), "192.168.1.20:50505")
    expect(screen.getByLabelText(/Name/)).toHaveAttribute("placeholder", "192.168.1.20:50505")
    await user.click(screen.getByRole("button", { name: "Connect" }))
    await waitFor(() => expect(reloadApp).toHaveBeenCalledOnce())
    expect(getProfiles()).toHaveLength(1)
    expect(getActiveProfile()).toMatchObject({ name: "192.168.1.20:50505", url: "http://192.168.1.20:50505" })
  })

  it("uses the name that was typed", async () => {
    healthy()
    render(<ConnectPage />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText("Server address"), "nas:1")
    await user.type(screen.getByLabelText(/Name/), "Basement NAS")
    await user.click(screen.getByRole("button", { name: "Connect" }))
    await waitFor(() => expect(reloadApp).toHaveBeenCalled())
    expect(getActiveProfile()?.name).toBe("Basement NAS")
  })

  it("does not save a server that does not answer", async () => {
    mockFetch(() => ({ status: 500 }))
    render(<ConnectPage />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText("Server address"), "nas:1")
    await user.click(screen.getByRole("button", { name: "Connect" }))
    expect(await screen.findByText(/Is this a Packrat server/)).toBeInTheDocument()
    expect(getProfiles()).toEqual([])
    expect(reloadApp).not.toHaveBeenCalled()
  })

  it("adding another server: starts blank, can be cancelled back to the current one", async () => {
    const home = addProfile("http://nas:50505", "Home")
    activateProfile(home.id)
    setAddingServer(true)
    render(<ConnectPage />)
    expect(screen.getByText("Add a server")).toBeInTheDocument()
    expect(screen.getByLabelText("Server address")).toHaveValue("")
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }))
    expect(isAddingServer()).toBe(false)
    expect(reloadApp).toHaveBeenCalledOnce()
    expect(getActiveProfile()?.id).toBe(home.id)
  })

  it("adding another server keeps the old one and its login, and switches to the new one", async () => {
    healthy()
    const home = addProfile("http://nas:50505", "Home")
    activateProfile(home.id)
    localStorage.setItem(`packrat.token.${home.id}`, "home-token")
    setAddingServer(true)
    render(<ConnectPage />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText("Server address"), "https://work.example")
    await user.click(screen.getByRole("button", { name: "Connect" }))
    await waitFor(() => expect(reloadApp).toHaveBeenCalled())
    expect(getProfiles().map((p) => p.name)).toEqual(["Home", "work.example"])
    expect(getActiveProfile()?.name).toBe("work.example")
    expect(isAddingServer()).toBe(false)
    expect(localStorage.getItem(`packrat.token.${home.id}`)).toBe("home-token")
  })

  it("lists saved servers to pick from", async () => {
    const home = addProfile("http://nas:50505", "Home")
    const work = addProfile("https://work.example", "Work")
    activateProfile(home.id)
    render(<ConnectPage />)
    await userEvent.setup().click(screen.getByRole("button", { name: /Work/ }))
    expect(getActiveProfile()?.id).toBe(work.id)
    expect(reloadApp).toHaveBeenCalledOnce()
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"
import { openProfile, startAddingServer } from "@/lib/serverSwitch"
import {
  getActiveProfile,
  getProfiles,
  isAddingServer,
  setAddingServer,
  setServerUrl,
  showsConnectScreen,
} from "@/lib/server"
import { enterTauri } from "@/test/tauriShell"

// Only the page reload is stubbed (jsdom cannot navigate); the profile list and the "adding a server" flag are the real ones.
const reloadApp = vi.hoisted(() => vi.fn())
vi.mock("@/lib/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/server")>()), reloadApp }))

beforeEach(() => {
  reloadApp.mockReset()
  enterTauri("desktop")
  setServerUrl("https://one.example", "One")
  setServerUrl("https://two.example", "Two") // the last one set is active
})

const profileId = (name: string) => getProfiles().find((p) => p.name === name)!.id

describe("openProfile", () => {
  it("makes that profile the active one and reloads, so the app restarts against it", () => {
    expect(getActiveProfile()?.name).toBe("Two")
    openProfile(profileId("One"))
    expect(getActiveProfile()?.name).toBe("One")
    expect(reloadApp).toHaveBeenCalledTimes(1)
  })

  it("leaves the add-server screen and shows the app of the chosen profile", () => {
    setAddingServer(true)
    expect(showsConnectScreen()).toBe(true)
    openProfile(profileId("One"))
    expect(isAddingServer()).toBe(false)
    expect(showsConnectScreen()).toBe(false)
  })

  it("does not reload before the profile is switched (the reload must see the new profile)", () => {
    reloadApp.mockImplementation(() => expect(getActiveProfile()?.name).toBe("One"))
    openProfile(profileId("One"))
    expect(reloadApp).toHaveBeenCalledTimes(1)
  })
})

describe("startAddingServer", () => {
  it("shows the connect screen but keeps the current server until a new one is saved", () => {
    expect(isAddingServer()).toBe(false)
    startAddingServer()
    expect(isAddingServer()).toBe(true)
    expect(showsConnectScreen()).toBe(true)
    expect(getActiveProfile()?.name).toBe("Two")
    expect(getProfiles()).toHaveLength(2)
    expect(reloadApp).toHaveBeenCalledTimes(1)
  })
})

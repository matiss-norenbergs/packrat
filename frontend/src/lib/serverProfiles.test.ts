import { beforeEach, describe, expect, it } from "vitest"
import {
  activateProfile,
  addProfile,
  deactivateProfile,
  deleteProfile,
  deriveProfileName,
  getActiveProfile,
  getLastServerUrl,
  getProfiles,
  isAddingServer,
  setAddingServer,
  updateProfile,
} from "@/lib/serverProfiles"

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe("deriveProfileName", () => {
  it("uses the host, and numbers duplicates", () => {
    expect(deriveProfileName("http://nas:50505")).toBe("nas:50505")
    expect(deriveProfileName("https://packrat.example.com/app")).toBe("packrat.example.com")
    expect(deriveProfileName("http://nas:50505", ["nas:50505"])).toBe("nas:50505 (2)")
    expect(deriveProfileName("http://nas:50505", ["nas:50505", "nas:50505 (2)"])).toBe("nas:50505 (3)")
  })
})

describe("profile storage", () => {
  it("starts empty with nothing active", () => {
    expect(getProfiles()).toEqual([])
    expect(getActiveProfile()).toBeNull()
  })

  it("adds, activates and stamps last-used", () => {
    const p = addProfile("http://nas:50505")
    expect(p).toMatchObject({ name: "nas:50505", url: "http://nas:50505" })
    expect(getActiveProfile()).toBeNull() // adding doesn't switch
    const before = Date.now()
    activateProfile(p.id)
    expect(getActiveProfile()?.id).toBe(p.id)
    expect(getActiveProfile()!.lastUsedAt).toBeGreaterThanOrEqual(before)
    expect(getLastServerUrl()).toBe("http://nas:50505")
  })

  it("uses the given name, trimmed, and falls back to the host when blank", () => {
    expect(addProfile("http://a:1", "  Home  ").name).toBe("Home")
    expect(addProfile("http://b:2", "   ").name).toBe("b:2")
  })

  it("does not duplicate a server that is already saved", () => {
    const first = addProfile("http://nas:50505", "Home")
    const again = addProfile("http://nas:50505", "Other name")
    expect(again.id).toBe(first.id)
    expect(getProfiles()).toHaveLength(1)
    expect(getProfiles()[0].name).toBe("Home")
  })

  it("renames, re-addresses and deletes; deleting the active one leaves none active", () => {
    const a = addProfile("http://a:1")
    const b = addProfile("http://b:2")
    activateProfile(a.id)
    updateProfile(a.id, { name: "Alpha", url: "http://a:9" })
    expect(getProfiles().find((p) => p.id === a.id)).toMatchObject({ name: "Alpha", url: "http://a:9" })
    deleteProfile(b.id)
    expect(getActiveProfile()?.id).toBe(a.id)
    deleteProfile(a.id)
    expect(getProfiles()).toEqual([])
    expect(getActiveProfile()).toBeNull()
  })

  it("deactivating keeps the profiles", () => {
    const a = addProfile("http://a:1")
    activateProfile(a.id)
    deactivateProfile()
    expect(getActiveProfile()).toBeNull()
    expect(getProfiles()).toHaveLength(1)
  })

  it("ignores an active id that no longer exists, and malformed stored data", () => {
    localStorage.setItem("packrat.profiles", JSON.stringify([{ id: "a", name: "A", url: "http://a", lastUsedAt: 1 }, { nope: true }]))
    localStorage.setItem("packrat.activeProfile", "gone")
    expect(getProfiles().map((p) => p.id)).toEqual(["a"])
    expect(getActiveProfile()).toBeNull()
    localStorage.setItem("packrat.profiles", "{not json")
    expect(getProfiles()).toEqual([])
  })

  it("never writes a token into the profile list", () => {
    localStorage.setItem("packrat.serverUrl", "http://nas:50505")
    localStorage.setItem("packrat.token", "secret-token")
    getProfiles()
    expect(localStorage.getItem("packrat.profiles")).not.toContain("secret-token")
  })
})

describe("migrating a single server", () => {
  it("turns packrat.serverUrl into the first, active profile (named after its host)", () => {
    localStorage.setItem("packrat.serverUrl", "http://nas:50505")
    const [p, ...rest] = getProfiles()
    expect(rest).toEqual([])
    expect(p).toMatchObject({ name: "nas:50505", url: "http://nas:50505" })
    expect(getActiveProfile()?.id).toBe(p.id)
    expect(localStorage.getItem("packrat.serverUrl")).toBeNull()
  })

  it("carries a localStorage token over to the profile, out of the old key", () => {
    localStorage.setItem("packrat.serverUrl", "http://nas:50505")
    localStorage.setItem("packrat.token", "tok")
    const [p] = getProfiles()
    expect(localStorage.getItem(`packrat.token.${p.id}`)).toBe("tok")
    expect(localStorage.getItem("packrat.token")).toBeNull()
  })

  it("happens once, and not again after every profile is removed", () => {
    localStorage.setItem("packrat.serverUrl", "http://nas:50505")
    const [p] = getProfiles()
    expect(getProfiles()[0].id).toBe(p.id) // stable across calls
    deleteProfile(p.id)
    localStorage.setItem("packrat.serverUrl", "http://stale:1") // would be a leftover from nowhere
    expect(getProfiles()).toEqual([])
  })

  it("does nothing on a fresh install", () => {
    expect(getProfiles()).toEqual([])
    expect(localStorage.getItem("packrat.legacyTokenProfile")).toBeNull()
  })
})

describe("adding-a-server flag", () => {
  it("lives in sessionStorage", () => {
    expect(isAddingServer()).toBe(false)
    setAddingServer(true)
    expect(isAddingServer()).toBe(true)
    expect(localStorage.length).toBe(0)
    setAddingServer(false)
    expect(isAddingServer()).toBe(false)
  })
})

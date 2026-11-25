import { QueryClient } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { authStatusQueryKey } from "@/hooks/useAuth"
import { AUTH_RECHECK_INTERVAL_MS, recheckAuthAfterSocketDrop } from "@/lib/authRecheck"
import type { AuthStatus } from "@/types/api"

const fetchAuthStatus = vi.fn()
vi.mock("@/lib/api", () => ({ fetchAuthStatus: () => fetchAuthStatus() }))

let client: QueryClient
const setHidden = (hidden: boolean) => Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden })
const status = () => client.getQueryData<AuthStatus>(authStatusQueryKey)

beforeEach(() => {
  client = new QueryClient()
  client.setQueryData<AuthStatus>(authStatusQueryKey, { setupRequired: false, authenticated: true })
  client.setQueryData(["library", "items"], ["private"])
  fetchAuthStatus.mockReset().mockResolvedValue({ setupRequired: false, authenticated: true })
  setHidden(false)
})
afterEach(() => setHidden(false))

describe("recheckAuthAfterSocketDrop", () => {
  it("is throttled to one check per interval", async () => {
    await recheckAuthAfterSocketDrop(client, 1_000)
    await recheckAuthAfterSocketDrop(client, 1_000 + AUTH_RECHECK_INTERVAL_MS - 1)
    expect(fetchAuthStatus).toHaveBeenCalledTimes(1)
    await recheckAuthAfterSocketDrop(client, 1_000 + AUTH_RECHECK_INTERVAL_MS)
    expect(fetchAuthStatus).toHaveBeenCalledTimes(2)
  })

  it("skips while the tab is hidden, without using up the throttle", async () => {
    setHidden(true)
    await recheckAuthAfterSocketDrop(client, 1_000)
    expect(fetchAuthStatus).not.toHaveBeenCalled()
    setHidden(false)
    await recheckAuthAfterSocketDrop(client, 1_001)
    expect(fetchAuthStatus).toHaveBeenCalledTimes(1)
  })

  it("skips when the page is not signed in", async () => {
    client.setQueryData<AuthStatus>(authStatusQueryKey, { setupRequired: false, authenticated: false })
    await recheckAuthAfterSocketDrop(client, 1_000)
    expect(fetchAuthStatus).not.toHaveBeenCalled()
  })

  it("a revoked session logs out and drops protected queries", async () => {
    fetchAuthStatus.mockResolvedValue({ setupRequired: false, authenticated: false })
    await recheckAuthAfterSocketDrop(client, 1_000)
    expect(status()?.authenticated).toBe(false)
    expect(client.getQueryData(["library", "items"])).toBeUndefined()
  })

  it("an unreachable server is not a verdict", async () => {
    fetchAuthStatus.mockRejectedValue(new TypeError("Failed to fetch"))
    await recheckAuthAfterSocketDrop(client, 1_000)
    expect(status()?.authenticated).toBe(true)
  })
})

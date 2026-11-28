import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  authStatusQueryKey,
  markLoggedOut,
  useAuthStatus,
  useChangePassword,
  useLogin,
  useLogin2fa,
  useLogout,
  useSetupAccount,
} from "@/hooks/useAuth"
import { useRevokeOtherSessions, useRevokeSession, useSessions } from "@/hooks/useSessions"
import {
  securityNoticeQueryKey,
  twoFactorQueryKey,
  useDisableTwoFactor,
  useEnableTwoFactor,
  useRegenerateRecoveryCodes,
  useSecurityNotice,
  useStartTwoFactorSetup,
  useTwoFactorStatus,
} from "@/hooks/useTwoFactor"
import { WRONG_CODE_MESSAGE } from "@/lib/api"
import { bodyOf, callsTo, mockFetch } from "@/test/mockApi"
import { flushTasks } from "@/test/settle"
import type { ActiveSession, AuthStatus } from "@/types/api"

// The contract of the auth, sessions and two-factor hooks: which request each one sends (URL, method, JSON body), what it writes
// to or drops from the query cache, and what the user is told. The request layer underneath is real (mocked fetch only).

const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
const AUTHED: AuthStatus = { setupRequired: false, authenticated: true }
const status = () => client.getQueryData<AuthStatus>(authStatusQueryKey)

beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
})

type Reply = { status: number; body?: unknown }
// One responder per test: `routes` maps "METHOD /path" to a reply; anything else is a 404 so a stray request fails loudly.
function serve(routes: Record<string, Reply | (() => Reply)>) {
  return mockFetch((url, init) => {
    const path = url.replace(/^.*\/api/, "")
    const route = routes[`${init.method ?? "GET"} ${path}`]
    if (!route) return { status: 404, body: { error: `unrouted ${init.method ?? "GET"} ${path}` } }
    return typeof route === "function" ? route() : route
  })
}
const sent = (fn: ReturnType<typeof mockFetch>, path: string, method: string) =>
  callsTo(fn, path).filter(([, init]) => (init.method ?? "GET") === method)

describe("useAuthStatus", () => {
  it("reads GET /auth/status", async () => {
    const fn = serve({ "GET /auth/status": { status: 200, body: AUTHED } })
    const { result } = renderHook(() => useAuthStatus(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(AUTHED))
    expect(sent(fn, "/auth/status", "GET")).toHaveLength(1)
  })
})

describe("useSetupAccount", () => {
  it("POSTs the credentials and marks the account signed in at once (no refetch race)", async () => {
    const fn = serve({ "POST /auth/setup": { status: 204 } })
    client.setQueryData<AuthStatus>(authStatusQueryKey, { setupRequired: true, authenticated: false })
    const { result } = renderHook(() => useSetupAccount(), { wrapper })
    await act(() => result.current.mutateAsync({ username: "admin", password: "correct horse" }))
    expect(bodyOf(sent(fn, "/auth/setup", "POST")[0])).toEqual({ username: "admin", password: "correct horse" })
    expect(status()).toEqual(AUTHED)
  })

  it("a refused setup shows the reason and leaves the status alone", async () => {
    serve({ "POST /auth/setup": { status: 400, body: { error: "password too short" } } })
    client.setQueryData<AuthStatus>(authStatusQueryKey, { setupRequired: true, authenticated: false })
    const { result } = renderHook(() => useSetupAccount(), { wrapper })
    await act(() => result.current.mutateAsync({ username: "a", password: "b" }).catch(() => {}))
    expect(toast.error).toHaveBeenCalledWith("Setup failed: password too short")
    expect(status()).toEqual({ setupRequired: true, authenticated: false })
  })
})

describe("useLogin", () => {
  it("POSTs the credentials and marks the account signed in", async () => {
    const fn = serve({ "POST /auth/login": { status: 204 } })
    client.setQueryData<AuthStatus>(authStatusQueryKey, { setupRequired: false, authenticated: false })
    const { result } = renderHook(() => useLogin(), { wrapper })
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.mutateAsync({ username: "admin", password: "pw" })
    })
    expect(outcome).toEqual({ twoFactorRequired: false })
    expect(bodyOf(sent(fn, "/auth/login", "POST")[0])).toEqual({ username: "admin", password: "pw" })
    expect(status()).toEqual(AUTHED)
  })

  it("an account with 2FA is NOT signed in yet: the cache stays signed out and the challenge is handed back", async () => {
    serve({ "POST /auth/login": { status: 200, body: { twoFactorRequired: true, challengeToken: "chal", expiresInSeconds: 120 } } })
    client.setQueryData<AuthStatus>(authStatusQueryKey, { setupRequired: false, authenticated: false })
    const { result } = renderHook(() => useLogin(), { wrapper })
    let outcome: unknown
    await act(async () => {
      outcome = await result.current.mutateAsync({ username: "admin", password: "pw" })
    })
    expect(outcome).toEqual({ twoFactorRequired: true, challengeToken: "chal", expiresInSeconds: 120 })
    expect(status()).toEqual({ setupRequired: false, authenticated: false })
  })

  it("a wrong password shows the server's message and stays signed out", async () => {
    serve({ "POST /auth/login": { status: 401, body: { error: "invalid credentials" } } })
    client.setQueryData<AuthStatus>(authStatusQueryKey, { setupRequired: false, authenticated: false })
    const { result } = renderHook(() => useLogin(), { wrapper })
    await act(() => result.current.mutateAsync({ username: "admin", password: "bad" }).catch(() => {}))
    expect(toast.error).toHaveBeenCalledWith("invalid credentials")
    expect(status()?.authenticated).toBe(false)
  })
})

describe("useLogin2fa", () => {
  it("POSTs the challenge with the code and marks the account signed in", async () => {
    const fn = serve({ "POST /auth/login/2fa": { status: 204 } })
    client.setQueryData<AuthStatus>(authStatusQueryKey, { setupRequired: false, authenticated: false })
    const { result } = renderHook(() => useLogin2fa(), { wrapper })
    await act(() => result.current.mutateAsync({ challengeToken: "chal", code: "123456" }))
    expect(bodyOf(sent(fn, "/auth/login/2fa", "POST")[0])).toEqual({ challengeToken: "chal", code: "123456" })
    expect(status()).toEqual(AUTHED)
  })

  it("a wrong code gets the friendly sentence and does not sign in", async () => {
    serve({ "POST /auth/login/2fa": { status: 401, body: { error: "invalid code" } } })
    client.setQueryData<AuthStatus>(authStatusQueryKey, { setupRequired: false, authenticated: false })
    const { result } = renderHook(() => useLogin2fa(), { wrapper })
    await act(() => result.current.mutateAsync({ challengeToken: "chal", code: "000000" }).catch(() => {}))
    expect(toast.error).toHaveBeenCalledWith(WRONG_CODE_MESSAGE)
    expect(status()?.authenticated).toBe(false)
  })
})

describe("markLoggedOut / useLogout", () => {
  function seed() {
    client.setQueryData<AuthStatus>(authStatusQueryKey, AUTHED)
    client.setQueryData(["library", "items"], ["private item"])
    client.setQueryData(["downloads"], ["private download"])
    client.setQueryData(["auth", "preferences"], { theme: "dark" })
  }

  it("marks the status signed out and drops every protected query, but keeps other auth entries", () => {
    seed()
    markLoggedOut(client)
    expect(status()).toEqual({ setupRequired: false, authenticated: false })
    expect(client.getQueryData(["library", "items"])).toBeUndefined()
    expect(client.getQueryData(["downloads"])).toBeUndefined()
    expect(client.getQueryData(["auth", "preferences"])).toEqual({ theme: "dark" })
  })

  it("logging out POSTs /auth/logout, then clears the session locally", async () => {
    seed()
    const fn = serve({ "POST /auth/logout": { status: 204 } })
    const { result } = renderHook(() => useLogout(), { wrapper })
    await act(() => result.current.mutateAsync())
    expect(sent(fn, "/auth/logout", "POST")).toHaveLength(1)
    expect(status()?.authenticated).toBe(false)
    expect(client.getQueryData(["library", "items"])).toBeUndefined()
  })

  it("a failed logout is reported and the session stays as it was", async () => {
    seed()
    serve({ "POST /auth/logout": { status: 500, body: { error: "boom" } } })
    const { result } = renderHook(() => useLogout(), { wrapper })
    await act(() => result.current.mutateAsync().catch(() => {}))
    expect(toast.error).toHaveBeenCalledWith("Logout failed: boom")
    expect(status()).toEqual(AUTHED)
    expect(client.getQueryData(["library", "items"])).toEqual(["private item"])
  })
})

describe("useChangePassword", () => {
  it("PATCHes both passwords and confirms", async () => {
    const fn = serve({ "PATCH /auth/password": { status: 204 } })
    const { result } = renderHook(() => useChangePassword(), { wrapper })
    await act(() => result.current.mutateAsync({ currentPassword: "old", newPassword: "new" }))
    expect(bodyOf(sent(fn, "/auth/password", "PATCH")[0])).toEqual({ currentPassword: "old", newPassword: "new" })
    expect(toast.success).toHaveBeenCalledWith("Password changed")
  })

  it("a wrong current password shows the server's message", async () => {
    serve({ "PATCH /auth/password": { status: 400, body: { error: "current password is incorrect" } } })
    const { result } = renderHook(() => useChangePassword(), { wrapper })
    await act(() => result.current.mutateAsync({ currentPassword: "x", newPassword: "y" }).catch(() => {}))
    expect(toast.error).toHaveBeenCalledWith("current password is incorrect")
    expect(toast.success).not.toHaveBeenCalled()
  })
})

const session = (id: string, current = false): ActiveSession =>
  ({ id, client: "web", ip: "1.2.3.4", userAgent: "UA", createdAt: "", lastSeenAt: "", current }) as ActiveSession

describe("useSessions", () => {
  it("lists the devices from GET /auth/sessions", async () => {
    serve({ "GET /auth/sessions": { status: 200, body: { sessions: [session("a", true), session("b")] } } })
    const { result } = renderHook(() => useSessions(), { wrapper })
    await waitFor(() => expect(result.current.data).toHaveLength(2))
    expect(result.current.data?.map((s) => s.id)).toEqual(["a", "b"])
  })
})

describe("useRevokeSession", () => {
  it("revoking another device DELETEs it (id URL-encoded), refreshes the list and stays signed in", async () => {
    const fn = serve({
      "GET /auth/sessions": { status: 200, body: { sessions: [session("a", true), session("b/c")] } },
      "DELETE /auth/sessions/b%2Fc": { status: 204 },
    })
    client.setQueryData<AuthStatus>(authStatusQueryKey, AUTHED)
    const list = renderHook(() => useSessions(), { wrapper })
    await waitFor(() => expect(list.result.current.data).toHaveLength(2))
    const { result } = renderHook(() => useRevokeSession(), { wrapper })
    await act(() => result.current.mutateAsync(session("b/c")))
    expect(sent(fn, "/auth/sessions/b%2Fc", "DELETE")).toHaveLength(1)
    await waitFor(() => expect(sent(fn, "/auth/sessions", "GET")).toHaveLength(2)) // the list was invalidated and refetched
    expect(status()).toEqual(AUTHED)
  })

  it("revoking the device you are on is a logout: signed out, protected queries dropped", async () => {
    const fn = serve({ "DELETE /auth/sessions/a": { status: 204 } })
    client.setQueryData<AuthStatus>(authStatusQueryKey, AUTHED)
    client.setQueryData(["library", "items"], ["private item"])
    const { result } = renderHook(() => useRevokeSession(), { wrapper })
    await act(() => result.current.mutateAsync(session("a", true)))
    expect(sent(fn, "/auth/sessions/a", "DELETE")).toHaveLength(1)
    expect(status()?.authenticated).toBe(false)
    expect(client.getQueryData(["library", "items"])).toBeUndefined()
  })

  it("a row that is already gone is reported and the list is refreshed anyway; no logout", async () => {
    const fn = serve({
      "GET /auth/sessions": { status: 200, body: { sessions: [session("a", true)] } },
      "DELETE /auth/sessions/zz": { status: 404, body: { error: "session not found" } },
    })
    client.setQueryData<AuthStatus>(authStatusQueryKey, AUTHED)
    const list = renderHook(() => useSessions(), { wrapper })
    await waitFor(() => expect(list.result.current.data).toHaveLength(1))
    const { result } = renderHook(() => useRevokeSession(), { wrapper })
    await act(() => result.current.mutateAsync(session("zz")).catch(() => {}))
    expect(toast.error).toHaveBeenCalledWith("session not found")
    await waitFor(() => expect(sent(fn, "/auth/sessions", "GET")).toHaveLength(2))
    expect(status()).toEqual(AUTHED)
  })
})

describe("useRevokeOtherSessions", () => {
  it.each([
    [1, "Signed out 1 other device"],
    [3, "Signed out 3 other devices"],
  ])("POSTs revoke-others and reports %i revoked", async (revoked, message) => {
    const fn = serve({
      "POST /auth/sessions/revoke-others": { status: 200, body: { revoked } },
      "GET /auth/sessions": { status: 200, body: { sessions: [] } },
    })
    const list = renderHook(() => useSessions(), { wrapper })
    await waitFor(() => expect(list.result.current.data).toEqual([]))
    const { result } = renderHook(() => useRevokeOtherSessions(), { wrapper })
    await act(() => result.current.mutateAsync())
    expect(sent(fn, "/auth/sessions/revoke-others", "POST")).toHaveLength(1)
    expect(toast.success).toHaveBeenCalledWith(message)
    await waitFor(() => expect(sent(fn, "/auth/sessions", "GET")).toHaveLength(2))
  })

  it("a failure shows the server's message", async () => {
    serve({ "POST /auth/sessions/revoke-others": { status: 500, body: { error: "boom" } } })
    const { result } = renderHook(() => useRevokeOtherSessions(), { wrapper })
    await act(() => result.current.mutateAsync().catch(() => {}))
    expect(toast.error).toHaveBeenCalledWith("boom")
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe("two-factor hooks", () => {
  it("useTwoFactorStatus reads GET /auth/2fa", async () => {
    serve({ "GET /auth/2fa": { status: 200, body: { enabled: true, recoveryCodesRemaining: 8 } } })
    const { result } = renderHook(() => useTwoFactorStatus(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual({ enabled: true, recoveryCodesRemaining: 8 }))
  })

  it("useStartTwoFactorSetup POSTs /auth/2fa/setup and hands back the secret", async () => {
    const fn = serve({ "POST /auth/2fa/setup": { status: 200, body: { secret: "ABC", otpauthUrl: "otpauth://x" } } })
    const { result } = renderHook(() => useStartTwoFactorSetup(), { wrapper })
    let setup: unknown
    await act(async () => {
      setup = await result.current.mutateAsync()
    })
    expect(setup).toEqual({ secret: "ABC", otpauthUrl: "otpauth://x" })
    expect(sent(fn, "/auth/2fa/setup", "POST")).toHaveLength(1)
  })

  it("enabling POSTs the password and code, returns the recovery codes, and refreshes the status", async () => {
    let enabled = false
    const fn = serve({
      "GET /auth/2fa": () => ({ status: 200, body: { enabled, recoveryCodesRemaining: enabled ? 8 : 0 } }),
      "POST /auth/2fa/enable": () => {
        enabled = true
        return { status: 200, body: { recoveryCodes: ["aaaa-bbbb", "cccc-dddd"] } }
      },
    })
    const status2fa = renderHook(() => useTwoFactorStatus(), { wrapper })
    await waitFor(() => expect(status2fa.result.current.data?.enabled).toBe(false))
    const { result } = renderHook(() => useEnableTwoFactor(), { wrapper })
    let codes: unknown
    await act(async () => {
      codes = await result.current.mutateAsync({ password: "pw", code: "123456" })
    })
    expect(codes).toEqual(["aaaa-bbbb", "cccc-dddd"])
    expect(bodyOf(sent(fn, "/auth/2fa/enable", "POST")[0])).toEqual({ password: "pw", code: "123456" })
    await waitFor(() => expect(status2fa.result.current.data?.enabled).toBe(true)) // the status query was invalidated
    expect(client.getQueryState(twoFactorQueryKey)?.isInvalidated).toBe(false)
  })

  it("enabling with a wrong code throws the friendly message and leaves the status alone", async () => {
    const fn = serve({
      "GET /auth/2fa": { status: 200, body: { enabled: false, recoveryCodesRemaining: 0 } },
      "POST /auth/2fa/enable": { status: 401, body: { error: "invalid code" } },
    })
    const status2fa = renderHook(() => useTwoFactorStatus(), { wrapper })
    await waitFor(() => expect(status2fa.result.current.data).toBeDefined())
    const { result } = renderHook(() => useEnableTwoFactor(), { wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync({ password: "pw", code: "000000" })).rejects.toThrow(WRONG_CODE_MESSAGE)
    })
    await flushTasks()
    expect(sent(fn, "/auth/2fa", "GET")).toHaveLength(1) // no refetch after a failed enable
  })

  it("disabling POSTs the password and TOTP code, or a recovery code, and refreshes the status", async () => {
    const fn = serve({
      "GET /auth/2fa": { status: 200, body: { enabled: true, recoveryCodesRemaining: 8 } },
      "POST /auth/2fa/disable": { status: 204 },
    })
    const status2fa = renderHook(() => useTwoFactorStatus(), { wrapper })
    await waitFor(() => expect(status2fa.result.current.data).toBeDefined())
    const { result } = renderHook(() => useDisableTwoFactor(), { wrapper })
    await act(() => result.current.mutateAsync({ password: "pw", code: "123456" }))
    await act(() => result.current.mutateAsync({ password: "pw", recoveryCode: "aaaa-bbbb" }))
    const bodies = sent(fn, "/auth/2fa/disable", "POST").map(bodyOf)
    expect(bodies).toEqual([
      { password: "pw", code: "123456" },
      { password: "pw", recoveryCode: "aaaa-bbbb" },
    ])
    await waitFor(() => expect(sent(fn, "/auth/2fa", "GET").length).toBeGreaterThan(1))
  })

  it("a wrong recovery code on disable gets the recovery-code sentence", async () => {
    serve({ "POST /auth/2fa/disable": { status: 401, body: { error: "invalid code" } } })
    const { result } = renderHook(() => useDisableTwoFactor(), { wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync({ password: "pw", recoveryCode: "bad" })).rejects.toThrow("That recovery code isn't valid or was already used.")
    })
  })

  it("regenerating recovery codes POSTs the password and code, returns the new codes, and refreshes the status", async () => {
    const fn = serve({
      "GET /auth/2fa": { status: 200, body: { enabled: true, recoveryCodesRemaining: 2 } },
      "POST /auth/2fa/recovery-codes": { status: 200, body: { recoveryCodes: ["n1", "n2"] } },
    })
    const status2fa = renderHook(() => useTwoFactorStatus(), { wrapper })
    await waitFor(() => expect(status2fa.result.current.data).toBeDefined())
    const { result } = renderHook(() => useRegenerateRecoveryCodes(), { wrapper })
    let codes: unknown
    await act(async () => {
      codes = await result.current.mutateAsync({ password: "pw", code: "123456" })
    })
    expect(codes).toEqual(["n1", "n2"])
    expect(bodyOf(sent(fn, "/auth/2fa/recovery-codes", "POST")[0])).toEqual({ password: "pw", code: "123456" })
    await waitFor(() => expect(sent(fn, "/auth/2fa", "GET").length).toBeGreaterThan(1))
  })
})

describe("useSecurityNotice", () => {
  const NOTICE = { failedAttempts: 3, since: "2026-11-01T00:00:00Z", lastAttemptAt: "2026-11-02T00:00:00Z" }

  it("asks nothing while signed out", async () => {
    const fn = serve({ "GET /auth/security-notice": { status: 200, body: NOTICE } })
    const { result } = renderHook(() => useSecurityNotice(false), { wrapper })
    await flushTasks()
    expect(sent(fn, "/auth/security-notice", "GET")).toHaveLength(0)
    expect(result.current.notice).toBeNull()
  })

  it("exposes the notice only when there were failed attempts", async () => {
    serve({ "GET /auth/security-notice": { status: 200, body: { ...NOTICE, failedAttempts: 0 } } })
    const { result } = renderHook(() => useSecurityNotice(true), { wrapper })
    await waitFor(() => expect(client.getQueryData(securityNoticeQueryKey)).toBeDefined())
    expect(result.current.notice).toBeNull()
  })

  it("dismissing hides it at once (before the server answers) and POSTs the acknowledgement", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const fn = mockFetch((url, init) => {
      if (url.endsWith("/auth/security-notice") && (init.method ?? "GET") === "GET") return { status: 200, body: NOTICE }
      return { status: 204 }
    })
    // Hold the ack's response so the optimistic update is observable on its own.
    const inner = fn.getMockImplementation()!
    fn.mockImplementation(async (url: string, init: Parameters<typeof inner>[1]) => {
      if (url.endsWith("/auth/security-notice/ack")) await gate
      return inner(url, init)
    })
    const { result } = renderHook(() => useSecurityNotice(true), { wrapper })
    await waitFor(() => expect(result.current.notice).toEqual(NOTICE))
    act(() => result.current.dismiss())
    await waitFor(() => expect(result.current.notice).toBeNull()) // optimistic: gone while the ack is still pending
    release()
    await waitFor(() => expect(sent(fn, "/auth/security-notice/ack", "POST")).toHaveLength(1))
  })
})

import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { settingsQueryKey } from "@/hooks/useSettings"
import { useSettingsDraft } from "@/hooks/useSettingsDraft"
import type { Settings } from "@/types/api"

const server = (over: Partial<Settings> = {}) =>
  ({ maxConcurrentDownloads: 2, downloadTimeoutMinutes: 0, proxy: "", ...over }) as unknown as Settings

// Number inputs are edited as strings, like the tabs do.
const toForm = (s: Settings) => ({
  maxConcurrent: String(s.maxConcurrentDownloads),
  timeout: String(s.downloadTimeoutMinutes),
})

function setup(initial: Settings) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(settingsQueryKey, initial)
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const hook = renderHook(({ settings }) => useSettingsDraft(settings, toForm), { wrapper, initialProps: { settings: initial } })
  return { client, ...hook }
}

describe("useSettingsDraft", () => {
  it("shows the server values until a field is edited", () => {
    const { result } = setup(server())
    expect(result.current.form).toEqual({ maxConcurrent: "2", timeout: "0" })
    expect(result.current.field("maxConcurrent")[0]).toBe("2")
  })

  it("an edit overrides the server value for that field only", () => {
    const { result } = setup(server())
    act(() => result.current.set("maxConcurrent", "5"))
    expect(result.current.form).toEqual({ maxConcurrent: "5", timeout: "0" })

    act(() => result.current.field("timeout")[1]("30"))
    expect(result.current.form).toEqual({ maxConcurrent: "5", timeout: "30" })
  })

  it("lets a tab derive dirty/payload by comparing the form against the server", () => {
    const initial = server()
    const { result } = setup(initial)
    const payloadOf = (s: Settings) => {
      const n = Number(result.current.form.maxConcurrent)
      return n > 0 && n !== s.maxConcurrentDownloads ? { maxConcurrentDownloads: n } : {}
    }
    expect(payloadOf(initial)).toEqual({})
    act(() => result.current.set("maxConcurrent", "4"))
    expect(payloadOf(initial)).toEqual({ maxConcurrentDownloads: 4 })
    act(() => result.current.set("maxConcurrent", "2")) // edited back to the stored value
    expect(payloadOf(initial)).toEqual({})
  })

  it("keeps edits when refreshed server data arrives, and untouched fields follow the server", () => {
    const { result, rerender } = setup(server())
    act(() => result.current.set("maxConcurrent", "5"))

    rerender({ settings: server({ maxConcurrentDownloads: 9, downloadTimeoutMinutes: 15 }) })

    expect(result.current.form).toEqual({ maxConcurrent: "5", timeout: "15" })
  })

  it("afterSave drops the edits so the form shows what the server stored", () => {
    const { result, rerender } = setup(server())
    act(() => result.current.set("maxConcurrent", "50"))

    // The server clamped 50 to 8 when saving.
    rerender({ settings: server({ maxConcurrentDownloads: 8 }) })
    expect(result.current.form.maxConcurrent).toBe("50")
    act(() => result.current.afterSave())

    expect(result.current.form).toEqual({ maxConcurrent: "8", timeout: "0" })
  })

  it("afterSave keeps the edits when the settings refetch failed", async () => {
    const { result, client } = setup(server())
    act(() => result.current.set("maxConcurrent", "5"))
    await client.fetchQuery({ queryKey: settingsQueryKey, queryFn: () => Promise.reject(new Error("down")), staleTime: 0 }).catch(() => {})
    expect(client.getQueryState(settingsQueryKey)?.status).toBe("error")

    act(() => result.current.afterSave())

    expect(result.current.form.maxConcurrent).toBe("5")
  })
})

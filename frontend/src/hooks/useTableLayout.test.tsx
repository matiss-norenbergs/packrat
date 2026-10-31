import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { normalizeTableLayout, tableLayoutsQueryKey, useTableLayout } from "@/hooks/useTableLayout"
import { markLoggedOut } from "@/hooks/useAuth"
import type { TableLayout, TableLayouts } from "@/types/api"

const api = vi.hoisted(() => ({ fetchTableLayouts: vi.fn(), saveTableLayout: vi.fn(), deleteTableLayout: vi.fn() }))
vi.mock("@/lib/api", () => api)
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const DEFAULTS: TableLayout = { v: 1, hidden: ["usage"] }
const KEYS = ["name", "birthday", "usage"]

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}

function setup(initial?: TableLayouts, defaults: TableLayout = DEFAULTS, tableId = "artists") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (initial) client.setQueryData(tableLayoutsQueryKey, initial)
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const hook = renderHook(() => useTableLayout(tableId, defaults, { knownKeys: KEYS, hideableKeys: ["birthday", "usage"] }), { wrapper })
  return { client, ...hook }
}

beforeEach(() => {
  api.fetchTableLayouts.mockReset().mockResolvedValue({})
  api.saveTableLayout.mockReset().mockImplementation(async (_id: string, l: TableLayout) => l)
  api.deleteTableLayout.mockReset().mockResolvedValue(undefined)
  toast.success.mockReset()
  toast.error.mockReset()
})
afterEach(cleanup)

describe("normalizeTableLayout", () => {
  it("ignores field order, treats missing and empty hidden alike, sorts and dedupes", () => {
    const a = normalizeTableLayout({ v: 1, widths: { b: 50, a: 40 }, hidden: ["y", "x", "x"] })
    const b = normalizeTableLayout({ v: 1, hidden: ["x", "y"], widths: { a: 40, b: 50 } })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(normalizeTableLayout({ v: 1, hidden: [], widths: {} })).toEqual(normalizeTableLayout({ v: 1 }))
    expect("hidden" in normalizeTableLayout({ v: 1, hidden: [] })).toBe(false)
  })

  it("drops keys of columns that no longer exist and non-hideable hidden keys", () => {
    const out = normalizeTableLayout(
      { v: 1, hidden: ["gone", "name", "usage"], widths: { gone: 50, name: 80 }, sort: { key: "gone", dir: "asc" } },
      { knownKeys: KEYS, hideableKeys: ["usage"] },
    )
    expect(out).toEqual({ v: 1, hidden: ["usage"], widths: { name: 80 } })
  })
})

describe("useTableLayout", () => {
  it("uses the defaults as the baseline when nothing is saved", () => {
    const { result } = setup({})
    expect(result.current.saved).toBeNull()
    expect(result.current.hasSaved).toBe(false)
    expect(result.current.baseline).toEqual({ v: 1, hidden: ["usage"] })
    expect(result.current.working).toEqual(result.current.baseline)
    expect(result.current.dirty).toBe(false)
  })

  it("uses the saved layout as the baseline when there is one", () => {
    const { result } = setup({ artists: { v: 1, hidden: ["birthday"] }, tags: { v: 1, hidden: ["x"] } })
    expect(result.current.saved).toEqual({ v: 1, hidden: ["birthday"] })
    expect(result.current.baseline).toEqual({ v: 1, hidden: ["birthday"] })
    expect(result.current.working).toEqual({ v: 1, hidden: ["birthday"] })
    expect(result.current.hasSaved).toBe(true)
    expect(result.current.dirty).toBe(false)
  })

  it("is dirty after an edit, and not when the edit only reorders or adds empty fields", () => {
    const { result } = setup({ artists: { v: 1, hidden: ["birthday", "usage"] } })
    act(() => result.current.setWorking((l) => ({ ...l, hidden: ["birthday"] })))
    expect(result.current.dirty).toBe(true)
    act(() => result.current.setWorking({ v: 1, widths: {}, hidden: ["usage", "birthday"] }))
    expect(result.current.dirty).toBe(false)
    act(() => result.current.setWorking({ v: 1, hidden: ["usage", "birthday", "gone"] }))
    expect(result.current.dirty).toBe(false) // a column that no longer exists is ignored
  })

  it("restore() returns to the baseline without a request or a toast", () => {
    const { result } = setup({ artists: { v: 1, hidden: ["birthday"] } })
    act(() => result.current.setWorking({ v: 1, hidden: [] }))
    expect(result.current.dirty).toBe(true)
    act(() => result.current.restore())
    expect(result.current.working).toEqual({ v: 1, hidden: ["birthday"] })
    expect(result.current.dirty).toBe(false)
    expect(api.saveTableLayout).not.toHaveBeenCalled()
    expect(api.deleteTableLayout).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("save() PUTs the working layout, updates the cache, and toasts only on the response", async () => {
    const d = deferred<TableLayout>()
    api.saveTableLayout.mockReturnValueOnce(d.promise)
    const { result, client } = setup({ tags: { v: 1, hidden: ["x"] } })
    act(() => result.current.setWorking({ v: 1, hidden: ["usage", "birthday"] }))
    let done!: Promise<void>
    act(() => {
      done = result.current.save()
    })
    expect(api.saveTableLayout).toHaveBeenCalledWith("artists", { v: 1, hidden: ["birthday", "usage"] })
    expect(toast.success).not.toHaveBeenCalled()
    expect(result.current.dirty).toBe(true) // nothing changes until the server answers
    await act(async () => {
      d.resolve({ v: 1, hidden: ["birthday", "usage"] })
      await done
    })
    expect(toast.success).toHaveBeenCalledWith("Layout saved")
    expect(client.getQueryData<TableLayouts>(tableLayoutsQueryKey)).toEqual({
      tags: { v: 1, hidden: ["x"] },
      artists: { v: 1, hidden: ["birthday", "usage"] },
    })
    await waitFor(() => expect(result.current.hasSaved).toBe(true)) // the query cache notifies asynchronously
    expect(result.current.dirty).toBe(false)
  })

  it("a failed save() toasts the error and leaves the working state untouched", async () => {
    api.saveTableLayout.mockRejectedValueOnce(new Error("boom"))
    const { result } = setup({})
    act(() => result.current.setWorking({ v: 1, hidden: ["birthday"] }))
    await act(() => result.current.save())
    expect(toast.error).toHaveBeenCalledWith("Couldn't save the layout: boom")
    expect(toast.success).not.toHaveBeenCalled()
    expect(result.current.working).toEqual({ v: 1, hidden: ["birthday"] })
    expect(result.current.hasSaved).toBe(false)
    expect(result.current.dirty).toBe(true)
  })

  it("clear() DELETEs, then applies the defaults, and toasts on the response", async () => {
    const d = deferred<void>()
    api.deleteTableLayout.mockReturnValueOnce(d.promise)
    const { result, client } = setup({ artists: { v: 1, hidden: ["birthday"] }, tags: { v: 1 } })
    act(() => result.current.setWorking({ v: 1, hidden: [] }))
    let done!: Promise<void>
    act(() => {
      done = result.current.clear()
    })
    expect(api.deleteTableLayout).toHaveBeenCalledWith("artists")
    expect(toast.success).not.toHaveBeenCalled()
    expect(result.current.hasSaved).toBe(true)
    await act(async () => {
      d.resolve()
      await done
    })
    expect(toast.success).toHaveBeenCalledWith("Layout cleared")
    expect(client.getQueryData<TableLayouts>(tableLayoutsQueryKey)).toEqual({ tags: { v: 1 } })
    await waitFor(() => expect(result.current.hasSaved).toBe(false))
    expect(result.current.working).toEqual({ v: 1, hidden: ["usage"] })
    expect(result.current.dirty).toBe(false)
  })

  it("a failed clear() keeps the saved layout and the working state", async () => {
    api.deleteTableLayout.mockRejectedValueOnce(new Error("nope"))
    const { result } = setup({ artists: { v: 1, hidden: ["birthday"] } })
    act(() => result.current.setWorking({ v: 1 }))
    await act(() => result.current.clear())
    expect(toast.error).toHaveBeenCalledWith("Couldn't clear the layout: nope")
    expect(result.current.hasSaved).toBe(true)
    expect(result.current.working).toEqual({ v: 1 })
  })

  it("ignores a second save/clear while one is in flight, silently", async () => {
    const d = deferred<TableLayout>()
    api.saveTableLayout.mockReturnValueOnce(d.promise)
    const { result } = setup({ artists: { v: 1 } })
    act(() => result.current.setWorking({ v: 1, hidden: ["usage"] }))
    let first!: Promise<void>
    act(() => {
      first = result.current.save()
    })
    await act(async () => {
      await result.current.save()
      await result.current.clear()
    })
    expect(api.saveTableLayout).toHaveBeenCalledTimes(1)
    expect(api.deleteTableLayout).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    await act(async () => {
      d.resolve({ v: 1, hidden: ["usage"] })
      await first
    })
    expect(toast.success).toHaveBeenCalledTimes(1)
    // And it works again afterwards.
    await act(() => result.current.clear())
    expect(api.deleteTableLayout).toHaveBeenCalledTimes(1)
  })

  it("adopts a saved layout that arrives late if the user has not edited", async () => {
    const d = deferred<TableLayouts>()
    api.fetchTableLayouts.mockReturnValueOnce(d.promise)
    const { result } = setup()
    expect(result.current.working).toEqual({ v: 1, hidden: ["usage"] }) // defaults while loading
    await act(async () => d.resolve({ artists: { v: 1, hidden: ["birthday"] } }))
    await waitFor(() => expect(result.current.hasSaved).toBe(true))
    expect(result.current.working).toEqual({ v: 1, hidden: ["birthday"] })
    expect(result.current.dirty).toBe(false)
  })

  it("does not override an edit made before the saved layout arrives", async () => {
    const d = deferred<TableLayouts>()
    api.fetchTableLayouts.mockReturnValueOnce(d.promise)
    const { result } = setup()
    act(() => result.current.setWorking({ v: 1, hidden: ["birthday", "usage"] }))
    await act(async () => d.resolve({ artists: { v: 1, hidden: ["birthday"] } }))
    await waitFor(() => expect(result.current.hasSaved).toBe(true))
    expect(result.current.working).toEqual({ v: 1, hidden: ["birthday", "usage"] })
    expect(result.current.dirty).toBe(true)
  })

  it("starts from the baseline again on a fresh mount (no persistence across navigation)", () => {
    const first = setup({})
    act(() => first.result.current.setWorking({ v: 1, hidden: ["birthday"] }))
    expect(first.result.current.dirty).toBe(true)
    first.unmount()
    const second = setup({})
    expect(second.result.current.dirty).toBe(false)
  })

  it("in controlled mode the owner holds the working layout", async () => {
    const onChange = vi.fn()
    const client = new QueryClient()
    client.setQueryData(tableLayoutsQueryKey, { artists: { v: 1, hidden: ["birthday"] } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const working: TableLayout = { v: 1, hidden: ["usage"] }
    const { result } = renderHook(() => useTableLayout("artists", DEFAULTS, { controlled: { working, onChange } }), { wrapper })
    expect(result.current.working).toBe(working)
    expect(result.current.dirty).toBe(true)
    act(() => result.current.restore())
    expect(onChange).toHaveBeenLastCalledWith({ v: 1, hidden: ["birthday"] })
    act(() => result.current.setWorking((l) => ({ ...l, hidden: [] })))
    expect(onChange).toHaveBeenLastCalledWith({ v: 1, hidden: [] })
    await act(() => result.current.clear())
    expect(onChange).toHaveBeenLastCalledWith({ v: 1, hidden: ["usage"] })
  })
})

describe("logout", () => {
  it("drops the cached layouts so the next account's are fetched", () => {
    const client = new QueryClient()
    client.setQueryData(tableLayoutsQueryKey, { artists: { v: 1 } })
    markLoggedOut(client)
    expect(client.getQueryData(tableLayoutsQueryKey)).toBeUndefined()
  })
})

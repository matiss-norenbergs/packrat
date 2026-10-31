import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useLibrarySort } from "@/hooks/useLibrarySort"
import { LibrarySortProvider } from "./LibrarySortContext"
import { tableLayoutsQueryKey } from "@/hooks/useTableLayout"
import type { TableLayout, TableLayouts } from "@/types/api"

const api = vi.hoisted(() => ({ fetchTableLayouts: vi.fn(), saveTableLayout: vi.fn(), deleteTableLayout: vi.fn() }))
vi.mock("@/lib/api", () => api)
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}

function setup(initial?: TableLayouts, withProvider = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (initial) client.setQueryData(tableLayoutsQueryKey, initial)
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{withProvider ? <LibrarySortProvider>{children}</LibrarySortProvider> : children}</QueryClientProvider>
  )
  return { client, ...renderHook(() => useLibrarySort(), { wrapper }) }
}

beforeEach(() => {
  api.fetchTableLayouts.mockReset().mockResolvedValue({})
  api.saveTableLayout.mockReset().mockImplementation(async (_id: string, l: TableLayout) => l)
  api.deleteTableLayout.mockReset().mockResolvedValue(undefined)
  toast.success.mockReset()
  toast.error.mockReset()
})
afterEach(cleanup)

const SAVED: TableLayouts = { library: { v: 1, sort: { key: "title", dir: "asc" }, hidden: ["year"], widths: { title: 300 } } }

describe("baseline", () => {
  it("is the saved library sort", () => {
    const { result } = setup(SAVED)
    expect(result.current.sort).toEqual({ key: "title", dir: "asc" })
    expect(result.current.baseline).toEqual({ key: "title", dir: "asc" })
    expect(result.current.differs).toBe(false)
  })

  it("is downloadedAt desc without a saved layout", () => {
    const { result } = setup({})
    expect(result.current.sort).toEqual({ key: "downloadedAt", dir: "desc" })
    expect(result.current.differs).toBe(false)
  })

  it("ignores a saved sort with an unknown key", () => {
    const { result } = setup({ library: { v: 1, sort: { key: "bogus", dir: "asc" } } })
    expect(result.current.sort).toEqual({ key: "downloadedAt", dir: "desc" })
  })
})

describe("working sort", () => {
  it("setSort applies at once and differs from the baseline until it is equal again", () => {
    const { result } = setup({})
    act(() => result.current.setSort({ key: "year", dir: "asc" }))
    expect(result.current.sort).toEqual({ key: "year", dir: "asc" })
    expect(result.current.differs).toBe(true)
    act(() => result.current.setSort({ key: "downloadedAt", dir: "desc" }))
    expect(result.current.differs).toBe(false)
  })

  it("adopts a late saved layout while the user has not changed the sort", async () => {
    const d = deferred<TableLayouts>()
    api.fetchTableLayouts.mockReturnValue(d.promise)
    const { result } = setup()
    expect(result.current.ready).toBe(false)
    expect(result.current.sort.key).toBe("downloadedAt")
    await act(async () => d.resolve(SAVED))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.sort).toEqual({ key: "title", dir: "asc" })
    expect(result.current.differs).toBe(false)
  })

  it("keeps the user's change when the saved layout arrives late", async () => {
    const d = deferred<TableLayouts>()
    api.fetchTableLayouts.mockReturnValue(d.promise)
    const { result } = setup()
    act(() => result.current.setSort({ key: "duration", dir: "desc" }))
    await act(async () => d.resolve(SAVED))
    expect(result.current.sort).toEqual({ key: "duration", dir: "desc" })
    expect(result.current.differs).toBe(true)
  })

  it("is ready when the layouts fetch fails (the default applies)", async () => {
    api.fetchTableLayouts.mockRejectedValue(new Error("nope"))
    const { result } = setup()
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.sort).toEqual({ key: "downloadedAt", dir: "desc" })
  })
})

describe("shared layout", () => {
  const FULL: TableLayouts = {
    library: { v: 1, sort: { key: "seasonNumber", dir: "desc" }, hidden: ["artist", "tags"], widths: { artist: 260, size: 300, title: 500, bogus: 400 } },
  }

  it("starts from the default layout: the columns that are off by default are hidden", () => {
    const { result } = setup({})
    expect(result.current.layout).toEqual({ v: 1, hidden: ["downloadedAt", "duration", "size", "year"] })
  })

  it("applies a saved layout's hidden columns and widths instead of dropping them (flex and unknown columns are normalized away)", () => {
    const { result } = setup(FULL)
    expect(result.current.layout).toEqual({
      v: 1,
      sort: { key: "seasonNumber", dir: "desc" },
      hidden: ["artist", "tags"],
      widths: { artist: 260, size: 300 },
    })
    expect(result.current.sort).toEqual({ key: "seasonNumber", dir: "desc" })
    expect(result.current.differs).toBe(false)
  })

  it("keeps a saved sort by a key that is not a column (filename, sequenceNumber)", () => {
    const { result } = setup({ library: { v: 1, sort: { key: "filename", dir: "asc" } } })
    expect(result.current.sort).toEqual({ key: "filename", dir: "asc" })
    expect(result.current.layout.sort).toEqual({ key: "filename", dir: "asc" })
  })

  it("setLayout replaces the working layout and the sort follows it", () => {
    const { result } = setup(FULL)
    act(() => result.current.setLayout({ v: 1, hidden: ["year"], sort: { key: "year", dir: "asc" } }))
    expect(result.current.layout).toEqual({ v: 1, hidden: ["year"], sort: { key: "year", dir: "asc" } })
    expect(result.current.sort).toEqual({ key: "year", dir: "asc" })
    expect(result.current.differs).toBe(true)
  })

  it("setSort keeps the hidden columns and widths of the working layout", () => {
    const { result } = setup(FULL)
    act(() => result.current.setSort({ key: "title", dir: "asc" }))
    expect(result.current.layout).toEqual({ v: 1, sort: { key: "title", dir: "asc" }, hidden: ["artist", "tags"], widths: { artist: 260, size: 300 } })
  })

  it("a stored layout with only a sort keeps the default hidden columns", () => {
    const { result } = setup({ library: { v: 1, sort: { key: "title", dir: "asc" } } })
    expect(result.current.layout).toEqual({ v: 1, sort: { key: "title", dir: "asc" }, hidden: ["downloadedAt", "duration", "size", "year"] })
    expect(result.current.differs).toBe(false)
  })

  it("an explicit empty hidden shows every column, and an explicit hidden list wins", () => {
    expect(setup({ library: { v: 1, hidden: [] } }).result.current.layout).toEqual({ v: 1 })
    expect(setup({ library: { v: 1, hidden: ["artist"] } }).result.current.layout).toEqual({ v: 1, hidden: ["artist"] })
  })

  it("saveSortAsDefault on a sort-only layout still stores only the sort", async () => {
    const { result } = setup({ library: { v: 1, sort: { key: "title", dir: "asc" } } })
    act(() => result.current.setSort({ key: "year", dir: "desc" }))
    await act(async () => void (await result.current.saveSortAsDefault()))
    expect(api.saveTableLayout).toHaveBeenCalledWith("library", { v: 1, sort: { key: "year", dir: "desc" } })
  })

  it("hiding a column is not a sort difference", () => {
    const { result } = setup({})
    act(() => result.current.setLayout({ v: 1, hidden: ["year"] }))
    expect(result.current.differs).toBe(false)
  })
})

describe("without the provider", () => {
  it("returns the saved sort, read-only", () => {
    const { result } = setup(SAVED, false)
    expect(result.current.sort).toEqual({ key: "title", dir: "asc" })
    act(() => result.current.setSort({ key: "year", dir: "asc" }))
    expect(result.current.sort).toEqual({ key: "title", dir: "asc" })
    expect(result.current.differs).toBe(false)
  })

  it("returns the default when nothing is saved", () => {
    const { result } = setup({}, false)
    expect(result.current.sort).toEqual({ key: "downloadedAt", dir: "desc" })
    expect(result.current.ready).toBe(true)
  })

  it("is not ready until the layouts answer", async () => {
    const d = deferred<TableLayouts>()
    api.fetchTableLayouts.mockReturnValue(d.promise)
    const { result } = setup(undefined, false)
    expect(result.current.ready).toBe(false)
    await act(async () => d.resolve(SAVED))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.sort.key).toBe("title")
  })

  it("saveSortAsDefault is a no-op", async () => {
    const { result } = setup(SAVED, false)
    await act(async () => {
      expect(await result.current.saveSortAsDefault()).toBe(false)
    })
    expect(api.saveTableLayout).not.toHaveBeenCalled()
  })
})

describe("saveSortAsDefault", () => {
  it("saves only the sort, keeps hidden and widths, updates the cache and the baseline", async () => {
    const { result, client } = setup(SAVED)
    act(() => result.current.setSort({ key: "year", dir: "desc" }))
    await act(async () => {
      expect(await result.current.saveSortAsDefault()).toBe(true)
    })
    expect(api.saveTableLayout).toHaveBeenCalledWith("library", { v: 1, sort: { key: "year", dir: "desc" }, hidden: ["year"], widths: { title: 300 } })
    expect(toast.success).toHaveBeenCalledWith("Default sort saved")
    expect(client.getQueryData<TableLayouts>(tableLayoutsQueryKey)?.library?.sort).toEqual({ key: "year", dir: "desc" })
    await waitFor(() => expect(result.current.baseline).toEqual({ key: "year", dir: "desc" }))
    expect(result.current.differs).toBe(false)
  })

  it("creates a layout with just the sort when none is saved", async () => {
    const { result } = setup({})
    act(() => result.current.setSort({ key: "title", dir: "desc" }))
    await act(async () => void (await result.current.saveSortAsDefault()))
    expect(api.saveTableLayout).toHaveBeenCalledWith("library", { v: 1, sort: { key: "title", dir: "desc" } })
  })

  it("omits a sort equal to the default but keeps other fields", async () => {
    const { result } = setup(SAVED)
    act(() => result.current.setSort({ key: "downloadedAt", dir: "desc" }))
    await act(async () => void (await result.current.saveSortAsDefault()))
    expect(api.saveTableLayout).toHaveBeenCalledWith("library", { v: 1, hidden: ["year"], widths: { title: 300 } })
    expect(api.deleteTableLayout).not.toHaveBeenCalled()
  })

  it("deletes the layout when nothing but v would be left", async () => {
    const { result, client } = setup({ library: { v: 1, sort: { key: "title", dir: "asc" } } })
    act(() => result.current.setSort({ key: "downloadedAt", dir: "desc" }))
    await act(async () => void (await result.current.saveSortAsDefault()))
    expect(api.deleteTableLayout).toHaveBeenCalledWith("library")
    expect(api.saveTableLayout).not.toHaveBeenCalled()
    expect(client.getQueryData<TableLayouts>(tableLayoutsQueryKey)).toEqual({})
    await waitFor(() => expect(result.current.differs).toBe(false))
  })

  it("sends nothing when the default is saved and no layout exists", async () => {
    const { result } = setup({})
    await act(async () => void (await result.current.saveSortAsDefault()))
    expect(api.saveTableLayout).not.toHaveBeenCalled()
    expect(api.deleteTableLayout).not.toHaveBeenCalled()
  })

  it("toasts only when the server answers and ignores a second call in flight", async () => {
    const d = deferred<TableLayout>()
    api.saveTableLayout.mockReturnValue(d.promise)
    const { result } = setup({})
    act(() => result.current.setSort({ key: "title", dir: "asc" }))
    let first!: Promise<boolean>
    let second!: boolean
    await act(async () => {
      first = result.current.saveSortAsDefault()
      second = await result.current.saveSortAsDefault()
    })
    expect(second).toBe(false)
    expect(toast.success).not.toHaveBeenCalled()
    await act(async () => {
      d.resolve({ v: 1, sort: { key: "title", dir: "asc" } })
      await first
    })
    expect(api.saveTableLayout).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledTimes(1)
  })

  it("keeps the working sort and toasts an error when the save fails", async () => {
    api.saveTableLayout.mockRejectedValue(new Error("boom"))
    const { result } = setup({})
    act(() => result.current.setSort({ key: "title", dir: "asc" }))
    await act(async () => {
      expect(await result.current.saveSortAsDefault()).toBe(false)
    })
    expect(toast.error).toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(result.current.sort).toEqual({ key: "title", dir: "asc" })
    expect(result.current.differs).toBe(true)
  })
})

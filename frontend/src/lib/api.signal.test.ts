import { beforeEach, describe, expect, it, vi } from "vitest"
import { fetchCollections, fetchDownloads, fetchLibraryFacets, fetchLibraryQuery, fetchStats } from "./api"

const reportNetworkFailure = vi.fn()
const reportReachable = vi.fn()
vi.mock("@/lib/connection", () => ({
  reportNetworkFailure: (...a: unknown[]) => reportNetworkFailure(...a),
  reportReachable: (...a: unknown[]) => reportReachable(...a),
}))

const fetchMock = vi.fn()
beforeEach(() => {
  reportNetworkFailure.mockClear()
  reportReachable.mockClear()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve([]) })
  vi.stubGlobal("fetch", fetchMock)
})

describe("AbortSignal passthrough", () => {
  it.each<[string, (s: AbortSignal) => Promise<unknown>, string]>([
    ["fetchLibraryQuery", (s) => fetchLibraryQuery({ q: "x" }, s), "/api/library?q=x"],
    ["fetchLibraryFacets", (s) => fetchLibraryFacets(s), "/api/library/facets"],
    ["fetchDownloads", (s) => fetchDownloads(s), "/api/downloads"],
    ["fetchCollections", (s) => fetchCollections(s), "/api/collections"],
    ["fetchStats", (s) => fetchStats(s), "/api/stats"],
  ])("%s hands the signal to fetch", async (_name, call, url) => {
    const controller = new AbortController()
    await call(controller.signal)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain(url)
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
  })

  it("aborts on the wire and is not reported as a network failure", async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")))
      }),
    )
    const controller = new AbortController()
    const pending = fetchLibraryQuery({}, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(reportNetworkFailure).not.toHaveBeenCalled()
    expect(reportReachable).not.toHaveBeenCalled()
  })

  it("still reports a real network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))
    await expect(fetchDownloads()).rejects.toBeInstanceOf(TypeError)
    expect(reportNetworkFailure).toHaveBeenCalledTimes(1)
  })
})

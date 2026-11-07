import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError, scanMissingConfirmInfo, scanMissingLibraryFiles } from "@/lib/api"

type FetchInit = { method?: string; body?: string; headers: Record<string, string> }

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async (_url: string, _init: FetchInit) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  }))
  vi.stubGlobal("fetch", fn)
  return fn
}

beforeEach(() => window.localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe("scanMissingLibraryFiles", () => {
  it("sends no body unless confirming", async () => {
    const fetchMock = mockFetch(200, { scanned: 3, missing: [], unreadable: 0 })
    await scanMissingLibraryFiles()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/library/scan-missing")
    expect(init.method).toBe("POST")
    expect(init.body).toBeUndefined()
  })

  it("re-sends with confirm: true", async () => {
    const fetchMock = mockFetch(200, { scanned: 3, missing: [], unreadable: 0 })
    await scanMissingLibraryFiles(true)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ confirm: true })
  })
})

describe("scanMissingConfirmInfo", () => {
  it("reads the counts off the requiresConfirm 409", async () => {
    mockFetch(409, { error: "This would convert 10 of 12 items to ghosts.", requiresConfirm: true, scanned: 12, wouldClear: 10 })
    const err = await scanMissingLibraryFiles().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(scanMissingConfirmInfo(err)).toEqual({ scanned: 12, wouldClear: 10 })
  })

  it("is null for any other error, including a 409 without requiresConfirm", async () => {
    mockFetch(409, { error: "The media folder is empty. Is it mounted? Nothing was changed." })
    const err = await scanMissingLibraryFiles().catch((e: unknown) => e)
    expect((err as ApiError).message).toContain("media folder")
    expect(scanMissingConfirmInfo(err)).toBeNull()
    expect(scanMissingConfirmInfo(new Error("boom"))).toBeNull()
    expect(scanMissingConfirmInfo(new ApiError("x", 500, { body: { requiresConfirm: true, scanned: 1, wouldClear: 1 } }))).toBeNull()
  })
})

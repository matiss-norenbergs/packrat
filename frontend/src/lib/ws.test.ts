import { afterEach, describe, expect, it, vi } from "vitest"
import { connectDownloadsSocket } from "./ws"

let listener: (ev: { data: string }) => void = () => {}
class FakeSocket {
  addEventListener(_t: string, fn: (ev: { data: string }) => void) {
    listener = fn
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("connectDownloadsSocket", () => {
  it("ignores malformed frames quietly", () => {
    vi.stubGlobal("WebSocket", FakeSocket)
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    const onMessage = vi.fn()
    connectDownloadsSocket(onMessage)
    listener({ data: "{not json" })
    expect(onMessage).not.toHaveBeenCalled()
    expect(err).not.toHaveBeenCalled()
  })

  it("logs a throwing handler (type only) and keeps processing later events", () => {
    vi.stubGlobal("WebSocket", FakeSocket)
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    const onMessage = vi.fn((e: { type: string }) => {
      if (e.type === "boom") throw new Error("handler failed")
    })
    connectDownloadsSocket(onMessage as never)
    expect(() => listener({ data: JSON.stringify({ type: "boom", payload: { secret: "title-xyz" } }) })).not.toThrow()
    listener({ data: JSON.stringify({ type: "queue_update", payload: {} }) })
    expect(onMessage).toHaveBeenCalledTimes(2)
    expect(err).toHaveBeenCalledTimes(1)
    expect(String(err.mock.calls[0][0])).toContain("boom")
    expect(JSON.stringify(err.mock.calls[0])).not.toContain("title-xyz")
  })
})

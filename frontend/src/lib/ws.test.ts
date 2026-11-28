import { afterEach, describe, expect, it, vi } from "vitest"
import { websocketUrl } from "./server"
import { connectDownloadsSocket } from "./ws"

let listener: (ev: { data: string }) => void = () => {}
const opened: { url: string; socket: FakeSocket }[] = []
class FakeSocket {
  constructor(url: string) {
    opened.push({ url, socket: this })
  }
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

  it("opens the socket at the server's websocket URL and returns that very socket", () => {
    vi.stubGlobal("WebSocket", FakeSocket)
    opened.length = 0
    const socket = connectDownloadsSocket(vi.fn())
    expect(opened).toHaveLength(1)
    expect(opened[0].url).toBe(websocketUrl())
    expect(socket).toBe(opened[0].socket)
  })

  it("hands every well-formed frame to the handler, parsed and in order", () => {
    vi.stubGlobal("WebSocket", FakeSocket)
    const onMessage = vi.fn()
    connectDownloadsSocket(onMessage)
    listener({ data: JSON.stringify({ type: "queue_update", payload: { active: 1, queued: 2 } }) })
    listener({ data: "[]" }) // valid JSON that is not an event: still handed over, the handler's switch ignores it
    listener({ data: JSON.stringify({ type: "completed", payload: { downloadId: 5 } }) })
    expect(onMessage.mock.calls.map((c) => c[0])).toEqual([
      { type: "queue_update", payload: { active: 1, queued: 2 } },
      [],
      { type: "completed", payload: { downloadId: 5 } },
    ])
  })
})

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type ComponentProps, type RefObject } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { usePersistedVolume } from "@/hooks/usePersistedVolume"
import { PlayerSkin } from "./PlayerSkin"
import { PLAYER_HIDE_DELAY_MS } from "./playerTheme"

// jsdom's media elements don't play; give the real element controllable state and working play/pause.
function fakeMedia(el: HTMLMediaElement, init: { duration?: number } = {}) {
  const s: Record<string, number | boolean> = { paused: true, currentTime: 0, duration: init.duration ?? 100, volume: 1, muted: false, playbackRate: 1 }
  for (const k of Object.keys(s)) {
    Object.defineProperty(el, k, {
      configurable: true,
      get: () => s[k],
      set: (v) => {
        s[k] = v
        if (k === "volume" || k === "muted") el.dispatchEvent(new Event("volumechange"))
        if (k === "currentTime") el.dispatchEvent(new Event("timeupdate"))
        if (k === "playbackRate") el.dispatchEvent(new Event("ratechange"))
      },
    })
  }
  el.play = vi.fn(() => {
    s.paused = false
    el.dispatchEvent(new Event("play"))
    return Promise.resolve()
  })
  el.pause = vi.fn(() => {
    s.paused = true
    el.dispatchEvent(new Event("pause"))
  })
  return s as { paused: boolean; currentTime: number; duration: number; volume: number; muted: boolean; playbackRate: number }
}

function Harness({
  kind = "video",
  variant = "full",
  skin = {},
}: {
  kind?: "video" | "audio"
  variant?: "full" | "compact"
  skin?: Partial<ComponentProps<typeof PlayerSkin>>
}) {
  const ref = usePersistedVolume<HTMLVideoElement>()
  return (
    <>
      <input aria-label="note" />
      <PlayerSkin mediaRef={ref as RefObject<HTMLMediaElement | null>} kind={kind} variant={variant} title="Song" artist="Band" {...skin}>
        <video ref={ref} data-testid="media" />
      </PlayerSkin>
    </>
  )
}

function setup(props: Parameters<typeof Harness>[0] = {}) {
  const view = render(<Harness {...props} />)
  const el = screen.getByTestId("media") as HTMLVideoElement
  const s = fakeMedia(el)
  act(() => {
    el.dispatchEvent(new Event("loadedmetadata"))
  })
  return { el, s, ...view }
}

const frame = () => screen.getByRole("group", { name: /player/ })
// jsdom has no layout: give the frame and bar real boxes (1000x600 frame, bar along the bottom) for the geometry checks.
const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON() {} })
function stubRects() {
  frame().getBoundingClientRect = () => rect(0, 0, 1000, 600)
  frame().querySelector("[data-slot=player-bar]")!.getBoundingClientRect = () => rect(12, 520, 988, 588)
}
const barVisible = () => screen.getByRole("group").querySelector("[data-slot=player-bar]")!.getAttribute("data-visible")

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("PlayerSkin keyboard", () => {
  it("toggles playback with Space and K when focused", async () => {
    const { el, s } = setup()
    screen.getByRole("group").focus()
    fireEvent.keyDown(document.activeElement!, { key: " " })
    expect(el.play).toHaveBeenCalledTimes(1)
    expect(s.paused).toBe(false)
    fireEvent.keyDown(document.activeElement!, { key: "k" })
    expect(el.pause).toHaveBeenCalledTimes(1)
  })

  it("seeks 5 s with arrows, 10 s with Shift or J/L, and clamps", () => {
    const { s } = setup()
    screen.getByRole("group").focus()
    s.currentTime = 50
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" })
    expect(s.currentTime).toBe(55)
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft", shiftKey: true })
    expect(s.currentTime).toBe(45)
    fireEvent.keyDown(document.activeElement!, { key: "l" })
    expect(s.currentTime).toBe(55)
    fireEvent.keyDown(document.activeElement!, { key: "j" })
    fireEvent.keyDown(document.activeElement!, { key: "j" })
    fireEvent.keyDown(document.activeElement!, { key: "j" })
    fireEvent.keyDown(document.activeElement!, { key: "j" })
    fireEvent.keyDown(document.activeElement!, { key: "j" })
    fireEvent.keyDown(document.activeElement!, { key: "j" })
    expect(s.currentTime).toBe(0)
  })

  it("changes volume, mutes, steps speed and jumps with digits", () => {
    const { s } = setup()
    screen.getByRole("group").focus()
    s.volume = 0.5
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" })
    expect(s.volume).toBe(0.55)
    fireEvent.keyDown(document.activeElement!, { key: "m" })
    expect(s.muted).toBe(true)
    fireEvent.keyDown(document.activeElement!, { key: ">" })
    expect(s.playbackRate).toBe(1.25)
    fireEvent.keyDown(document.activeElement!, { key: "<" })
    fireEvent.keyDown(document.activeElement!, { key: "<" })
    expect(s.playbackRate).toBe(0.75)
    fireEvent.keyDown(document.activeElement!, { key: "5" })
    expect(s.currentTime).toBe(50)
  })

  it("ignores keys while typing in an input, and with Ctrl/Alt/Meta", async () => {
    const { el, s } = setup()
    const input = screen.getByLabelText("note")
    input.focus()
    fireEvent.pointerEnter(screen.getByRole("group")) // hovered, but the target is an input
    fireEvent.keyDown(input, { key: " " })
    fireEvent.keyDown(input, { key: "m" })
    expect(el.play).not.toHaveBeenCalled()
    expect(s.muted).toBe(false)
    screen.getByRole("group").focus()
    fireEvent.keyDown(document.activeElement!, { key: " ", ctrlKey: true })
    fireEvent.keyDown(document.activeElement!, { key: "m", metaKey: true })
    expect(el.play).not.toHaveBeenCalled()
    expect(s.muted).toBe(false)
  })

  it("does nothing when the player is neither focused nor hovered", () => {
    const { el } = setup()
    ;(document.activeElement as HTMLElement)?.blur()
    fireEvent.keyDown(document.body, { key: " " })
    expect(el.play).not.toHaveBeenCalled()
  })

  it("acts while hovered even without focus, and prevents the default only when handled", () => {
    const { el } = setup()
    fireEvent.pointerEnter(screen.getByRole("group"))
    const handled = fireEvent.keyDown(document.body, { key: " " })
    expect(handled).toBe(false) // preventDefault called
    expect(el.play).toHaveBeenCalled()
    expect(fireEvent.keyDown(document.body, { key: "q" })).toBe(true)
  })

  it("lets a focused button handle Space itself instead of double-toggling", async () => {
    const { el } = setup()
    const user = userEvent.setup()
    const play = screen.getByRole("button", { name: "Play" })
    play.focus()
    await user.keyboard(" ")
    expect(el.play).toHaveBeenCalledTimes(1)
  })

  it("seek slider handles arrows itself", () => {
    const { s, el } = setup()
    s.currentTime = 20
    act(() => void el.dispatchEvent(new Event("timeupdate")))
    const slider = screen.getByRole("slider", { name: "Seek" })
    slider.focus()
    fireEvent.keyDown(slider, { key: "ArrowRight" })
    expect(s.currentTime).toBe(25)
    fireEvent.keyDown(slider, { key: "End" })
    expect(s.currentTime).toBe(100)
  })
})

describe("PlayerSkin controls visibility", () => {
  it("hides after the delay while playing and returns on pointer movement", () => {
    vi.useFakeTimers()
    const { el } = setup()
    act(() => void el.play())
    expect(barVisible()).toBe("true")
    act(() => void vi.advanceTimersByTime(PLAYER_HIDE_DELAY_MS + 10))
    expect(barVisible()).toBe("false")
    expect(screen.getByRole("group").querySelector("[data-slot=player-hairline]")).not.toBeNull()
    fireEvent.pointerMove(screen.getByRole("group"))
    expect(barVisible()).toBe("true")
  })

  it("stays visible while paused", () => {
    vi.useFakeTimers()
    setup()
    act(() => void vi.advanceTimersByTime(PLAYER_HIDE_DELAY_MS * 3))
    expect(barVisible()).toBe("true")
  })

  it("stays visible while the pointer is over the bar (by geometry) and hides once it leaves", () => {
    vi.useFakeTimers()
    const { el } = setup()
    stubRects()
    act(() => void el.play())
    fireEvent.pointerMove(frame(), { clientX: 500, clientY: 550 }) // on the bar
    act(() => void vi.advanceTimersByTime(PLAYER_HIDE_DELAY_MS * 2))
    expect(barVisible()).toBe("true")
    fireEvent.pointerMove(frame(), { clientX: 500, clientY: 200 }) // away from it
    expect(barVisible()).toBe("true") // active again right after a move
    act(() => void vi.advanceTimersByTime(PLAYER_HIDE_DELAY_MS + 10))
    expect(barVisible()).toBe("false")
  })

  it("the bottom hot zone shows and holds the bar", () => {
    vi.useFakeTimers()
    const { el } = setup()
    stubRects()
    act(() => void el.play())
    act(() => void vi.advanceTimersByTime(PLAYER_HIDE_DELAY_MS + 10))
    expect(barVisible()).toBe("false")
    fireEvent.pointerMove(frame(), { clientX: 3, clientY: 500 }) // left of the bar, inside the bottom 20%
    expect(barVisible()).toBe("true")
    act(() => void vi.advanceTimersByTime(PLAYER_HIDE_DELAY_MS * 2))
    expect(barVisible()).toBe("true")
  })

  it("paused -> play -> idle -> a pointer move shows the bar; a click to pause keeps it while paused", () => {
    vi.useFakeTimers()
    const { el } = setup()
    stubRects()
    expect(barVisible()).toBe("true") // paused
    act(() => void el.play())
    act(() => void vi.advanceTimersByTime(PLAYER_HIDE_DELAY_MS + 10))
    expect(barVisible()).toBe("false")
    fireEvent.pointerMove(frame(), { clientX: 400, clientY: 200 })
    expect(barVisible()).toBe("true")
    act(() => void vi.advanceTimersByTime(PLAYER_HIDE_DELAY_MS + 10))
    expect(barVisible()).toBe("false")
    const surface = frame().querySelector("[data-slot=player-surface]")!
    fireEvent.pointerDown(surface, { clientX: 400, clientY: 200 })
    fireEvent.click(surface)
    act(() => void vi.advanceTimersByTime(300))
    expect(el.pause).toHaveBeenCalled()
    expect(barVisible()).toBe("true")
    act(() => void vi.advanceTimersByTime(PLAYER_HIDE_DELAY_MS * 3))
    expect(barVisible()).toBe("true") // stays while paused
  })

  it("a key that toggles playback wakes the hidden bar", () => {
    vi.useFakeTimers()
    const { el } = setup()
    act(() => void el.play())
    act(() => void vi.advanceTimersByTime(PLAYER_HIDE_DELAY_MS + 10))
    expect(barVisible()).toBe("false")
    frame().focus()
    fireEvent.keyDown(document.activeElement!, { key: "k" })
    expect(barVisible()).toBe("true")
  })

  describe("in fullscreen", () => {
    const enterFullscreen = () => {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => frame() })
      act(() => void document.dispatchEvent(new Event("fullscreenchange")))
    }
    const leaveFullscreen = () => {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => null })
      act(() => void document.dispatchEvent(new Event("fullscreenchange")))
    }
    afterEach(leaveFullscreen)

    it("a move anywhere on the document wakes the bar even if the frame gets no event", () => {
      vi.useFakeTimers()
      const { el } = setup()
      stubRects()
      enterFullscreen()
      act(() => void el.play())
      act(() => void vi.advanceTimersByTime(PLAYER_HIDE_DELAY_MS + 10))
      expect(barVisible()).toBe("false")
      fireEvent.mouseMove(document.body, { clientX: 400, clientY: 200 })
      expect(barVisible()).toBe("true")
      act(() => void vi.advanceTimersByTime(PLAYER_HIDE_DELAY_MS + 10))
      expect(barVisible()).toBe("false")
      fireEvent.pointerMove(document.body, { clientX: 450, clientY: 250 })
      expect(barVisible()).toBe("true")
    })

    it("entering fullscreen clears a stale 'pointer on the bar' so the bar can hide", () => {
      vi.useFakeTimers()
      const { el } = setup()
      stubRects()
      act(() => void el.play())
      fireEvent.pointerMove(frame(), { clientX: 500, clientY: 550 }) // on the bar before fullscreen
      enterFullscreen() // layout changes under the pointer; no leave event arrives
      act(() => void vi.advanceTimersByTime(PLAYER_HIDE_DELAY_MS + 10))
      expect(barVisible()).toBe("false")
    })

    it("stops listening on the document after leaving fullscreen", () => {
      vi.useFakeTimers()
      const { el } = setup()
      stubRects()
      enterFullscreen()
      act(() => void el.play())
      leaveFullscreen()
      act(() => void vi.advanceTimersByTime(PLAYER_HIDE_DELAY_MS + 10))
      expect(barVisible()).toBe("false")
      fireEvent.mouseMove(document.body, { clientX: 400, clientY: 200 })
      expect(barVisible()).toBe("false")
    })
  })

  it("stays visible while keyboard focus is inside the bar", () => {
    vi.useFakeTimers()
    const { el } = setup()
    act(() => void el.play())
    act(() => screen.getByRole("button", { name: "Pause" }).focus())
    act(() => void vi.advanceTimersByTime(PLAYER_HIDE_DELAY_MS * 2))
    expect(barVisible()).toBe("true")
  })

  it("a click toggles playback after the double-click window", () => {
    vi.useFakeTimers()
    const { el } = setup()
    const surface = screen.getByRole("group").querySelector("[data-slot=player-surface]")!
    fireEvent.click(surface)
    expect(el.play).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(300))
    expect(el.play).toHaveBeenCalledTimes(1)
  })

  it("a double-click requests fullscreen on the frame and does not toggle playback", () => {
    vi.useFakeTimers()
    const { el } = setup()
    const frame = screen.getByRole("group")
    frame.requestFullscreen = vi.fn(() => Promise.resolve())
    const surface = frame.querySelector("[data-slot=player-surface]")!
    fireEvent.click(surface)
    fireEvent.click(surface)
    fireEvent.doubleClick(surface)
    act(() => void vi.advanceTimersByTime(500))
    expect(frame.requestFullscreen).toHaveBeenCalledTimes(1)
    expect(el.play).not.toHaveBeenCalled()
  })
})

describe("PlayerSkin volume and speed", () => {
  it("persists volume and mute and restores them on the next element", () => {
    const first = setup()
    first.s.volume = 0.4
    first.el.dispatchEvent(new Event("volumechange"))
    first.s.muted = true
    first.el.dispatchEvent(new Event("volumechange"))
    expect(JSON.parse(localStorage.getItem("packrat:player-volume")!)).toEqual({ volume: 0.4, muted: true })
    cleanup()
    const second = render(<Harness />)
    const el = screen.getByTestId("media") as HTMLVideoElement
    expect(el.volume).toBe(0.4)
    expect(el.muted).toBe(true)
    second.unmount()
  })

  it("works with storage unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied")
    })
    const { el, s } = setup()
    expect(() => {
      s.volume = 0.3
      el.dispatchEvent(new Event("volumechange"))
    }).not.toThrow()
    expect(screen.getByRole("button", { name: /Settings, playback speed/ })).toBeTruthy()
  })

  it("the mute button toggles mute and the slider sets volume", () => {
    const { s } = setup()
    fireEvent.click(screen.getByRole("button", { name: "Mute" }))
    expect(s.muted).toBe(true)
    fireEvent.change(screen.getByRole("slider", { name: "Volume" }), { target: { value: "0.25" } })
    expect(s.volume).toBe(0.25)
    expect(s.muted).toBe(false)
  })

  it("the settings cog replaces the speed pill and its menu sets the rate; the label shows only when not 1×", async () => {
    const { s } = setup()
    const user = userEvent.setup()
    const cog = screen.getByRole("button", { name: "Settings, playback speed 1×" })
    expect(cog.textContent).toBe("") // just the icon at 1×
    expect(frame().querySelector("[data-slot=player-speed-label]")).toBeNull()
    await user.click(cog)
    expect(await screen.findByText("Playback speed")).toBeTruthy()
    await user.click(await screen.findByRole("menuitemradio", { name: "1.5×" }))
    expect(s.playbackRate).toBe(1.5)
    const after = screen.getByRole("button", { name: "Settings, playback speed 1.5×" })
    expect(after.querySelector("[data-slot=player-speed-label]")?.textContent).toBe("1.5×")
    fireEvent.keyDown(frame(), { key: "<" }) // focus is back on the cog, inside the frame
    expect(s.playbackRate).toBe(1.25)
    fireEvent.keyDown(frame(), { key: "<" })
    expect(s.playbackRate).toBe(1)
    expect(frame().querySelector("[data-slot=player-speed-label]")).toBeNull()
  })

  it("audio keeps the cog in its bar", () => {
    setup({ kind: "audio" })
    expect(screen.getByRole("button", { name: /Settings, playback speed/ })).toBeTruthy()
  })
})

describe("PlayerSkin states", () => {
  it("shows the error message when the element fails", () => {
    const { el } = setup()
    ;(el as unknown as { error: unknown }).error = { code: 4 }
    Object.defineProperty(el, "error", { value: { code: 4 }, configurable: true })
    act(() => void el.dispatchEvent(new Event("error")))
    expect(screen.getByRole("alert").textContent).toContain("This file can't be played in the browser")
    expect(screen.getByRole("alert").textContent).toMatch(/format or codec/)
  })

  it("shows the error when only the <source> child fails", () => {
    const { el } = setup()
    const source = document.createElement("source")
    el.appendChild(source)
    act(() => void source.dispatchEvent(new Event("error")))
    expect(screen.getByRole("alert")).toBeTruthy()
  })

  it("shows a spinner while waiting", () => {
    const { el } = setup()
    act(() => void el.dispatchEvent(new Event("waiting")))
    expect(screen.getByRole("status", { name: "Buffering" })).toBeTruthy()
    act(() => void el.dispatchEvent(new Event("playing")))
    expect(screen.queryByRole("status", { name: "Buffering" })).toBeNull()
  })

  it("exposes the time and slider semantics", () => {
    const { s, el } = setup()
    s.currentTime = 83
    s.duration = 2700
    act(() => void el.dispatchEvent(new Event("durationchange")))
    const slider = screen.getByRole("slider", { name: "Seek" })
    expect(slider.getAttribute("aria-valuemax")).toBe("2700")
    expect(slider.getAttribute("aria-valuenow")).toBe("83")
    expect(slider.getAttribute("aria-valuetext")).toBe("1 minute 23 seconds of 45 minutes")
    expect(screen.getByText("1:23 / 45:00")).toBeTruthy()
  })

  it("seeks from a pointer press on the bar", () => {
    const { s } = setup()
    const slider = screen.getByRole("slider", { name: "Seek" })
    const track = slider.firstElementChild as HTMLElement
    track.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, right: 200, bottom: 4, height: 4, x: 0, y: 0, toJSON() {} })
    fireEvent.pointerDown(slider, { clientX: 100, pointerId: 1 })
    expect(s.currentTime).toBe(50)
  })

  it("follows a touch drag across back-to-back events and stops on release", () => {
    const { s } = setup()
    const slider = screen.getByRole("slider", { name: "Seek" })
    const track = slider.firstElementChild as HTMLElement
    track.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, right: 200, bottom: 4, height: 4, x: 0, y: 0, toJSON() {} })
    fireEvent.pointerDown(slider, { clientX: 40, pointerId: 3, pointerType: "touch" })
    fireEvent.pointerMove(slider, { clientX: 100, pointerId: 3, pointerType: "touch" })
    fireEvent.pointerMove(slider, { clientX: 160, pointerId: 3, pointerType: "touch" })
    expect(s.currentTime).toBe(80)
    fireEvent.pointerUp(slider, { clientX: 160, pointerId: 3, pointerType: "touch" })
    fireEvent.pointerMove(slider, { clientX: 20, pointerId: 3, pointerType: "touch" })
    expect(s.currentTime).toBe(80)
  })

  it("audio: shows title/artist and a static bar without fullscreen or hairline", () => {
    setup({ kind: "audio" })
    expect(screen.getByText("Song")).toBeTruthy()
    expect(screen.getByText("Band")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /fullscreen/i })).toBeNull()
    expect(barVisible()).toBe("true")
  })

  it("compact has no speed pill, settings cog or fullscreen", () => {
    setup({ variant: "compact" })
    expect(screen.queryByRole("button", { name: /Playback speed/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /Settings/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /fullscreen/i })).toBeNull()
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy()
  })
})

describe("PlayerSkin diagnostics (URL-only)", () => {
  afterEach(() => window.history.replaceState({}, "", "/"))

  it("renders no debug element, logs nothing and starts no interval without the parameter", () => {
    vi.useFakeTimers()
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    const interval = vi.spyOn(globalThis, "setInterval")
    setup()
    act(() => void vi.advanceTimersByTime(1000))
    expect(screen.getByRole("group").querySelector("[data-slot=player-debug]")).toBeNull()
    expect(info).not.toHaveBeenCalled()
    expect(interval).not.toHaveBeenCalled()
  })

  it("?playerDebug=1 shows the box with its masking warning", () => {
    vi.useFakeTimers()
    window.history.replaceState({}, "", "/?playerDebug=1")
    setup()
    act(() => void vi.advanceTimersByTime(600))
    const box = screen.getByRole("group").querySelector("[data-slot=player-debug]")
    expect(box?.textContent).toContain("can mask flicker")
    expect(box?.textContent).toContain("showBar=true")
  })

  it("?playerDebug=log writes prefixed console lines and adds no DOM element", () => {
    vi.useFakeTimers()
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    window.history.replaceState({}, "", "/?playerDebug=log")
    setup()
    act(() => void vi.advanceTimersByTime(600))
    expect(screen.getByRole("group").querySelector("[data-slot=player-debug]")).toBeNull()
    const lines = info.mock.calls.map((c) => String(c[0]))
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.every((l) => l.startsWith("[player] "))).toBe(true)
    expect(lines.some((l) => l.includes("showBar=true"))).toBe(true)
    expect(lines.some((l) => l.includes("dom=true"))).toBe(true)
  })

  it("an unrecognized value turns diagnostics off", () => {
    vi.useFakeTimers()
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    window.history.replaceState({}, "", "/?playerDebug=yes")
    setup()
    act(() => void vi.advanceTimersByTime(600))
    expect(screen.getByRole("group").querySelector("[data-slot=player-debug]")).toBeNull()
    expect(info).not.toHaveBeenCalled()
  })
})

describe("PlayerSkin shortcuts scope", () => {
  it('shortcuts="focus" ignores keys while merely hovered, and acts once the frame has focus', () => {
    const { el } = setup({ skin: { shortcuts: "focus" } })
    fireEvent.pointerEnter(frame())
    fireEvent.keyDown(document.body, { key: " " })
    expect(el.play).not.toHaveBeenCalled()
    frame().focus()
    fireEvent.keyDown(document.activeElement!, { key: " " })
    expect(el.play).toHaveBeenCalledTimes(1)
  })

  it("the default scope still acts while hovered", () => {
    const { el } = setup({ skin: { shortcuts: "hover-or-focus" } })
    fireEvent.pointerEnter(frame())
    fireEvent.keyDown(document.body, { key: " " })
    expect(el.play).toHaveBeenCalledTimes(1)
  })

  it('shortcuts="focus" also acts when focus is on something inside the frame', () => {
    const { s } = setup({ variant: "compact", skin: { shortcuts: "focus" } })
    screen.getByRole("slider", { name: "Seek" }).focus()
    fireEvent.keyDown(document.activeElement!, { key: "m" })
    expect(s.muted).toBe(true)
  })
})

describe("PlayerSkin title overlay", () => {
  it("shows with the bar and hides together with it", () => {
    vi.useFakeTimers()
    const { el } = setup({ variant: "compact", skin: { titleOverlay: "Clip A" } })
    const title = () => frame().querySelector("[data-slot=player-title]")!
    expect(title().textContent).toBe("Clip A")
    expect(title().getAttribute("data-visible")).toBe("true") // paused
    act(() => void el.play())
    act(() => void vi.advanceTimersByTime(PLAYER_HIDE_DELAY_MS + 10))
    expect(barVisible()).toBe("false")
    expect(title().getAttribute("data-visible")).toBe("false")
    fireEvent.pointerMove(frame())
    expect(title().getAttribute("data-visible")).toBe("true")
  })

  it("is absent without the prop and for audio", () => {
    setup()
    expect(frame().querySelector("[data-slot=player-title]")).toBeNull()
    cleanup()
    setup({ kind: "audio", skin: { titleOverlay: "x" } })
    expect(frame().querySelector("[data-slot=player-title]")).toBeNull()
  })
})

describe("PlayerSkin fullscreen containment", () => {
  const setFullscreenElement = (node: Element | null) => {
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => node })
    act(() => void document.dispatchEvent(new Event("fullscreenchange")))
  }
  afterEach(() => setFullscreenElement(null))
  const barStyle = () => (frame().querySelector("[data-slot=player-bar]") as HTMLElement).style
  const blurred = () => !!(barStyle().backdropFilter || barStyle().getPropertyValue("-webkit-backdrop-filter"))

  it("a fullscreen ancestor (the compare page) counts: no blur, cursor hides, icon stays 'Fullscreen'", () => {
    vi.useFakeTimers()
    const { el } = setup()
    expect(blurred()).toBe(true) // windowed: glass
    const page = document.createElement("div")
    document.body.appendChild(page)
    page.appendChild(frame().parentElement!) // the frame now lives inside the fullscreen "page"
    setFullscreenElement(page)
    expect(blurred()).toBe(false)
    act(() => void el.play())
    act(() => void vi.advanceTimersByTime(PLAYER_HIDE_DELAY_MS + 10))
    expect(frame().className).toContain("cursor-none")
    expect(screen.getByRole("button", { name: "Fullscreen" })).toBeTruthy() // not "Exit fullscreen": the frame itself isn't fullscreen
    page.remove()
  })

  it("the frame being the fullscreen element still shows 'Exit fullscreen' and the solid bar", () => {
    setup()
    setFullscreenElement(frame())
    expect(blurred()).toBe(false)
    expect(screen.getByRole("button", { name: "Exit fullscreen" })).toBeTruthy()
  })

  it("an unrelated fullscreen element does not count", () => {
    setup()
    const other = document.createElement("div")
    document.body.appendChild(other)
    setFullscreenElement(other)
    expect(blurred()).toBe(true)
    other.remove()
  })

  it("under a fullscreen ancestor only moves over this frame wake the bar", () => {
    vi.useFakeTimers()
    const { el } = setup()
    stubRects()
    setFullscreenElement(document.body)
    act(() => void el.play())
    act(() => void vi.advanceTimersByTime(PLAYER_HIDE_DELAY_MS + 10))
    expect(barVisible()).toBe("false")
    fireEvent.mouseMove(document.body, { clientX: 1500, clientY: 200 }) // outside the frame
    expect(barVisible()).toBe("false")
    fireEvent.mouseMove(document.body, { clientX: 400, clientY: 200 }) // over it
    expect(barVisible()).toBe("true")
  })
})

describe("PlayerSkin touch mode", () => {
  const surface = () => frame().querySelector("[data-slot=player-surface]")! as HTMLElement
  let pid = 10
  // One finger tap at (x, y) on the 1000x600 frame: pointerdown + pointerup with pointerType "touch".
  const tap = (x: number, y = 300) => {
    const id = ++pid
    fireEvent.pointerDown(surface(), { pointerType: "touch", pointerId: id, clientX: x, clientY: y })
    fireEvent.pointerUp(surface(), { pointerType: "touch", pointerId: id, clientX: x, clientY: y })
  }
  const settle = () => act(() => void vi.advanceTimersByTime(1500)) // past every tap/skip window
  // Touch mode, playing, controls hidden.
  function touchSetup(props: Parameters<typeof Harness>[0] = {}) {
    vi.useFakeTimers()
    const r = setup(props)
    stubRects()
    tap(500)
    settle()
    act(() => void r.el.play())
    act(() => void vi.advanceTimersByTime(PLAYER_HIDE_DELAY_MS + 10))
    stubRects()
    return r
  }

  it("switches to the touch layout: center play/pause, cog, time and fullscreen; no volume, mute or bar play button", () => {
    touchSetup()
    const bar = frame().querySelector("[data-slot=player-bar]")!
    expect(bar.getAttribute("data-touch")).toBe("true")
    expect(frame().querySelector("[data-slot=player-center-play]")).not.toBeNull()
    expect(screen.getAllByRole("button", { name: "Pause" })).toHaveLength(1) // only the center one
    expect(screen.getByRole("button", { name: /Settings, playback speed/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Fullscreen" })).toBeTruthy()
    expect(screen.getByRole("slider", { name: "Seek" })).toBeTruthy()
    expect(frame().querySelector("[data-slot=player-time]")).not.toBeNull()
    expect(screen.queryByRole("slider", { name: "Volume" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Mute" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Unmute" })).toBeNull()
  })

  it("a tap shows the hidden controls and the next one hides them, never touching playback", () => {
    const { el } = touchSetup()
    expect(barVisible()).toBe("false")
    tap(500)
    expect(barVisible()).toBe("false") // not before the double-tap window passed
    settle()
    expect(barVisible()).toBe("true")
    tap(500)
    settle()
    expect(barVisible()).toBe("false")
    tap(200) // a side tap is a single tap too
    settle()
    expect(barVisible()).toBe("true")
    act(() => void vi.advanceTimersByTime(PLAYER_HIDE_DELAY_MS + 10))
    expect(barVisible()).toBe("false") // auto-hides while playing
    expect(el.play).toHaveBeenCalledTimes(1) // only the setup's own play()
    expect(el.pause).not.toHaveBeenCalled()
  })

  it("the click and focus that follow a tap don't toggle playback or show the controls early", () => {
    const { el } = touchSetup()
    tap(500)
    fireEvent.click(surface())
    fireEvent.doubleClick(surface())
    act(() => frame().focus())
    expect(barVisible()).toBe("false")
    settle()
    expect(el.pause).not.toHaveBeenCalled()
    expect(barVisible()).toBe("true")
  })

  it("a tap hides the controls even while paused", () => {
    const { el } = touchSetup()
    act(() => void el.pause())
    expect(barVisible()).toBe("true")
    tap(500)
    settle()
    expect(barVisible()).toBe("false")
  })

  it("the center button toggles playback and keeps the controls up", () => {
    const { el } = touchSetup()
    tap(500)
    settle()
    const center = frame().querySelector("[data-slot=player-center-play]")! as HTMLElement
    fireEvent.pointerDown(center, { pointerType: "touch", pointerId: 99 })
    fireEvent.click(center)
    expect(el.pause).toHaveBeenCalledTimes(1)
    expect(barVisible()).toBe("true")
    fireEvent.click(center)
    expect(el.play).toHaveBeenCalledTimes(2)
  })

  it("a double tap on the right/left third seeks +/-10 s without toggling the controls", () => {
    const { s } = touchSetup()
    s.currentTime = 50
    tap(900)
    act(() => void vi.advanceTimersByTime(150))
    tap(900)
    expect(s.currentTime).toBe(60)
    expect(frame().querySelector("[data-slot=player-skip]")?.textContent).toBe("+10 s")
    settle()
    expect(barVisible()).toBe("false")
    tap(100)
    act(() => void vi.advanceTimersByTime(150))
    tap(100)
    expect(s.currentTime).toBe(50)
    expect(frame().querySelector("[data-slot=player-skip]")?.textContent).toBe("−10 s")
    settle()
    expect(barVisible()).toBe("false")
    expect(frame().querySelector("[data-slot=player-skip]")).toBeNull()
  })

  it("repeated taps on the same side accumulate, and the skip is clamped", () => {
    const { s } = touchSetup()
    s.currentTime = 50
    tap(900)
    act(() => void vi.advanceTimersByTime(100))
    tap(900)
    act(() => void vi.advanceTimersByTime(400))
    tap(900)
    act(() => void vi.advanceTimersByTime(400))
    tap(900)
    expect(s.currentTime).toBe(80)
    expect(frame().querySelector("[data-slot=player-skip]")?.textContent).toBe("+30 s")
    settle()
    s.currentTime = 95
    tap(900)
    act(() => void vi.advanceTimersByTime(100))
    tap(900)
    expect(s.currentTime).toBe(100)
  })

  it("a double tap in the middle does nothing", () => {
    const { el, s } = touchSetup()
    s.currentTime = 50
    const requestFullscreen = vi.fn(() => Promise.resolve())
    frame().requestFullscreen = requestFullscreen
    tap(500)
    act(() => void vi.advanceTimersByTime(100))
    tap(500)
    settle()
    expect(s.currentTime).toBe(50)
    expect(el.pause).not.toHaveBeenCalled()
    expect(requestFullscreen).not.toHaveBeenCalled()
    expect(barVisible()).toBe("false")
  })

  it("a drag on the video is not a tap", () => {
    touchSetup()
    fireEvent.pointerDown(surface(), { pointerType: "touch", pointerId: 70, clientX: 500, clientY: 300 })
    fireEvent.pointerUp(surface(), { pointerType: "touch", pointerId: 70, clientX: 500, clientY: 200 })
    settle()
    expect(barVisible()).toBe("false")
  })

  it("shows an unmute button only while muted or at volume 0, and it unmutes", () => {
    const { s, el } = touchSetup()
    tap(500)
    settle()
    expect(screen.queryByRole("button", { name: "Unmute" })).toBeNull()
    act(() => void (el.muted = true))
    fireEvent.click(screen.getByRole("button", { name: "Unmute" }))
    expect(s.muted).toBe(false)
    expect(screen.queryByRole("button", { name: "Unmute" })).toBeNull()
    act(() => void (el.volume = 0))
    fireEvent.click(screen.getByRole("button", { name: "Unmute" }))
    expect(s.volume).toBe(1)
    expect(s.muted).toBe(false)
    expect(screen.queryByRole("button", { name: "Unmute" })).toBeNull()
  })

  it("the cog menu sets the rate in touch mode and the label shows only when not 1×", async () => {
    const { s } = touchSetup()
    tap(500)
    settle()
    vi.useRealTimers()
    const cog = screen.getByRole("button", { name: "Settings, playback speed 1×" })
    expect(cog.querySelector("[data-slot=player-speed-label]")).toBeNull()
    fireEvent.pointerDown(cog, { pointerType: "touch", pointerId: 80, button: 0 })
    fireEvent.pointerUp(cog, { pointerType: "touch", pointerId: 80, button: 0 })
    const item = await screen.findByRole("menuitemradio", { name: "2×" })
    expect(frame().contains(item)).toBe(true) // portaled into the frame (reachable in fullscreen)
    fireEvent.click(item)
    expect(s.playbackRate).toBe(2)
    const after = screen.getByRole("button", { name: "Settings, playback speed 2×" })
    expect(after.querySelector("[data-slot=player-speed-label]")?.textContent).toBe("2×")
    expect(frame().querySelector("[data-slot=player-bar]")!.getAttribute("data-touch")).toBe("true")
  })

  it("a paused video whose controls were tapped away shows them again when it plays and pauses", () => {
    const { el } = touchSetup()
    act(() => void el.pause())
    tap(500)
    settle()
    expect(barVisible()).toBe("false")
    act(() => void el.play())
    act(() => void el.pause())
    expect(barVisible()).toBe("true")
  })

  it("a mouse move switches back to the desktop bar, where a click toggles playback again", () => {
    const { el } = touchSetup()
    fireEvent.pointerMove(frame(), { pointerType: "mouse", clientX: 400, clientY: 200 })
    expect(frame().querySelector("[data-slot=player-bar]")!.getAttribute("data-touch")).toBeNull()
    expect(screen.getByRole("slider", { name: "Volume" })).toBeTruthy()
    act(() => void vi.advanceTimersByTime(1100)) // past the touch ghost-click guard
    fireEvent.click(surface())
    act(() => void vi.advanceTimersByTime(300))
    expect(el.pause).toHaveBeenCalledTimes(1)
  })

  it("compact and audio players have no touch mode", () => {
    vi.useFakeTimers()
    const { el } = setup({ variant: "compact" })
    tap(500)
    fireEvent.click(surface())
    act(() => void vi.advanceTimersByTime(300))
    expect(el.play).toHaveBeenCalledTimes(1) // tap = click = play, as before
    expect(frame().querySelector("[data-slot=player-bar]")!.getAttribute("data-touch")).toBeNull()
  })

  describe("fullscreen", () => {
    const proto = HTMLVideoElement.prototype as unknown as { webkitEnterFullscreen?: () => void }
    afterEach(() => {
      delete proto.webkitEnterFullscreen
      Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => undefined })
    })

    it("falls back to the video's native fullscreen when the Fullscreen API is off (iPhone)", () => {
      const enter = vi.fn()
      proto.webkitEnterFullscreen = enter
      Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => false })
      touchSetup()
      tap(500)
      settle()
      fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }))
      expect(enter).toHaveBeenCalledTimes(1)
    })

    it("has no fullscreen button when neither works", () => {
      Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => false })
      touchSetup()
      expect(screen.queryByRole("button", { name: /fullscreen/i })).toBeNull()
    })
  })
})

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeMedia, type FakeMediaState } from "@/components/player/fakeMedia"
import { ComparePlayPage } from "./ComparePlayPage"

const h = vi.hoisted(() => ({ items: [] as unknown[] }))
vi.mock("@/hooks/useLibrary", () => ({ useLibraryItemsByIds: () => ({ items: h.items, isLoading: false }) }))

const item = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Clip ${id}`,
  filename: `clip${id}.mp4`,
  path: `clip${id}.mp4`,
  status: "ready",
  blurred: false,
  ...extra,
})

interface Cell {
  el: HTMLVideoElement
  s: FakeMediaState
}

// Renders the page and gives every mounted <video> controllable state (durations per cell).
function setup(durations: number[], extra: Record<number, Record<string, unknown>> = {}) {
  h.items = durations.map((_, i) => item(i + 1, extra[i + 1]))
  render(
    <MemoryRouter initialEntries={[`/compare/play?items=${durations.map((_, i) => i + 1).join(",")}`]}>
      <ComparePlayPage />
    </MemoryRouter>,
  )
  const videos = Array.from(document.querySelectorAll("video")) as HTMLVideoElement[]
  const cells: Cell[] = videos.map((el, i) => ({ el, s: fakeMedia(el, { duration: durations[i] }) }))
  act(() => cells.forEach((c) => c.el.dispatchEvent(new Event("loadedmetadata"))))
  return cells
}

const globalBar = () => document.querySelector("[data-slot=compare-global-bar]") as HTMLElement
const bar = () => within(globalBar())
const frames = () => screen.getAllByRole("group")
const ready = (cells: Cell[]) => act(() => cells.forEach((c) => c.el.dispatchEvent(new Event("canplaythrough"))))
const rect = (w: number) => ({ left: 0, top: 0, right: w, bottom: 4, width: w, height: 4, x: 0, y: 0, toJSON() {} })

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem("packrat:compare-wait-for-ready", "false")
  localStorage.setItem("packrat:compare-preload", "true")
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe("ComparePlayPage keyboard scopes", () => {
  it("Space with nothing focused toggles all cells", () => {
    const cells = setup([10, 20, 5])
    fireEvent.keyDown(document.body, { key: " " })
    for (const c of cells) expect(c.el.play).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document.body, { key: "k" })
    for (const c of cells) expect(c.el.pause).toHaveBeenCalledTimes(1)
  })

  it("Space with a cell focused toggles that cell alone", () => {
    const cells = setup([10, 20])
    frames()[1].focus()
    fireEvent.keyDown(document.activeElement!, { key: " " })
    expect(cells[1].el.play).toHaveBeenCalledTimes(1)
    expect(cells[0].el.play).not.toHaveBeenCalled()
  })

  it("a cell's other keys stay in the cell: arrows seek only it", () => {
    const cells = setup([60, 60])
    cells[0].s.currentTime = 20
    cells[1].s.currentTime = 20
    frames()[0].focus()
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" })
    expect(cells[0].s.currentTime).toBe(25)
    expect(cells[1].s.currentTime).toBe(20)
  })

  it("with the global bar's button focused the button handles Space, once", async () => {
    const cells = setup([10, 20])
    const user = userEvent.setup()
    bar().getByRole("button", { name: "Play all" }).focus()
    await user.keyboard(" ")
    for (const c of cells) expect(c.el.play).toHaveBeenCalledTimes(1)
  })

  it("never acts while typing, or with Ctrl/Alt/Meta", () => {
    const cells = setup([10])
    const input = document.createElement("input")
    document.body.appendChild(input)
    input.focus()
    fireEvent.keyDown(input, { key: " " })
    fireEvent.keyDown(document.body, { key: " ", ctrlKey: true })
    fireEvent.keyDown(document.body, { key: "m", metaKey: true })
    expect(cells[0].el.play).not.toHaveBeenCalled()
    expect(cells[0].s.muted).toBe(false)
    input.remove()
  })

  it("global arrows seek every cell relative to its own time (Shift: 10 s), keeping offsets and clamping", () => {
    const cells = setup([60, 30])
    cells[0].s.currentTime = 10
    cells[1].s.currentTime = 28
    fireEvent.keyDown(document.body, { key: "ArrowRight" })
    expect([cells[0].s.currentTime, cells[1].s.currentTime]).toEqual([15, 30]) // the shorter clip clamps at its end
    fireEvent.keyDown(document.body, { key: "ArrowLeft", shiftKey: true })
    expect([cells[0].s.currentTime, cells[1].s.currentTime]).toEqual([5, 20])
    expect(screen.getByRole("status").textContent).toBe("−10s")
  })

  it("global up/down, M and </> act on every cell and the bar", () => {
    const cells = setup([10, 10])
    for (const c of cells) c.s.volume = 0.5
    fireEvent.keyDown(document.body, { key: "ArrowDown" }) // master shows 1 -> 0.95
    for (const c of cells) expect(c.s.volume).toBe(0.95)
    fireEvent.keyDown(document.body, { key: "m" })
    for (const c of cells) expect(c.s.muted).toBe(true)
    fireEvent.keyDown(document.body, { key: "m" })
    for (const c of cells) expect(c.s.muted).toBe(false)
    fireEvent.keyDown(document.body, { key: ">" })
    for (const c of cells) expect(c.s.playbackRate).toBe(1.25)
    expect(bar().getByRole("button", { name: /Playback speed, 1.25×/ })).toBeTruthy()
    fireEvent.keyDown(document.body, { key: "<" })
    fireEvent.keyDown(document.body, { key: "<" })
    for (const c of cells) expect(c.s.playbackRate).toBe(0.75)
  })

  it("F toggles page fullscreen on the container", () => {
    setup([10])
    const container = frames()[0].closest("[tabindex='-1']") as HTMLElement
    container.requestFullscreen = vi.fn(() => Promise.resolve())
    fireEvent.keyDown(document.body, { key: "f" })
    expect(container.requestFullscreen).toHaveBeenCalledTimes(1)
  })

  it("ignores a key an inner component already handled (defaultPrevented)", () => {
    const cells = setup([10])
    const el = document.createElement("div")
    document.body.appendChild(el)
    el.addEventListener("keydown", (e) => e.preventDefault())
    fireEvent.keyDown(el, { key: " " })
    expect(cells[0].el.play).not.toHaveBeenCalled()
    el.remove()
  })
})

describe("ComparePlayPage sync mode (time / percent)", () => {
  const SYNC_KEY = "packrat:compare-sync-mode"
  const radio = (name: string) => bar().getByRole("radio", { name })
  const scrub = (clientX: number) => {
    const slider = bar().getByRole("slider", { name: "Seek" })
    ;(slider.firstElementChild as HTMLElement).getBoundingClientRect = () => rect(200)
    fireEvent.pointerDown(slider, { clientX, pointerId: 1 })
    fireEvent.pointerUp(slider, { pointerId: 1 })
  }

  it("has a Time | Percent toggle that defaults to time and stores nothing until used", () => {
    setup([60, 120])
    expect(bar().getByRole("radiogroup", { name: "Seek sync mode" })).toBeTruthy()
    expect(radio("Sync by time").getAttribute("aria-checked")).toBe("true")
    expect(radio("Sync by percent").getAttribute("aria-checked")).toBe("false")
    expect(localStorage.getItem(SYNC_KEY)).toBeNull()
  })

  it("falls back to time for an invalid stored value", () => {
    localStorage.setItem(SYNC_KEY, "bogus")
    setup([60])
    expect(radio("Sync by time").getAttribute("aria-checked")).toBe("true")
  })

  it("persists the choice and restores it after a remount", () => {
    setup([60, 120])
    fireEvent.click(radio("Sync by percent"))
    expect(localStorage.getItem(SYNC_KEY)).toBe("percent")
    expect(radio("Sync by percent").getAttribute("aria-checked")).toBe("true")
    cleanup()
    setup([60, 120])
    expect(radio("Sync by percent").getAttribute("aria-checked")).toBe("true")
    fireEvent.click(radio("Sync by time"))
    expect(localStorage.getItem(SYNC_KEY)).toBe("time")
  })

  it("time mode puts every cell at the same timestamp (clamped) and reads current / duration", () => {
    const cells = setup([60, 120])
    scrub(100) // 50% of the longest (120 s) = 60 s
    expect(cells.map((c) => c.s.currentTime)).toEqual([60, 60])
    expect(bar().getByRole("slider", { name: "Seek" }).getAttribute("aria-valuemax")).toBe("120")
    expect(bar().getByText("1:00 / 2:00")).toBeTruthy()
  })

  it("percent mode puts every cell at the same fraction of its own length and reads a percentage", () => {
    vi.useFakeTimers()
    const cells = setup([60, 120, NaN])
    fireEvent.click(radio("Sync by percent"))
    scrub(100) // 50 %
    expect(cells.map((c) => c.s.currentTime)).toEqual([30, 60, 0]) // the unknown-duration cell is skipped
    expect(bar().getByText("50%")).toBeTruthy()
    const slider = bar().getByRole("slider", { name: "Seek" })
    expect(slider.getAttribute("aria-valuemax")).toBe("100")
    expect(slider.getAttribute("aria-valuetext")).toBe("50%")
    act(() => void vi.advanceTimersByTime(50)) // let the seek throttle's frame pass
    scrub(200) // the far end: never past a cell's end
    expect(cells.map((c) => c.s.currentTime)).toEqual([60, 120, 0])
    expect(bar().getByText("100%")).toBeTruthy()
    vi.useRealTimers()
  })

  it("percent mode shows the reference cell's own fraction, and 0 while its duration is unknown", () => {
    const cells = setup([60, 120])
    fireEvent.click(radio("Sync by percent"))
    cells[0].s.currentTime = 15
    cells[1].s.currentTime = 90
    act(() => void cells[0].el.dispatchEvent(new Event("timeupdate")))
    expect(bar().getByText("25%")).toBeTruthy()
    act(() => void cells[1].el.play()) // the first playing cell becomes the reference
    expect(bar().getByText("75%")).toBeTruthy()
    cleanup()
    const unknown = setup([NaN, 120])
    expect(bar().getByText("0%")).toBeTruthy()
    scrub(100)
    expect(unknown.map((c) => c.s.currentTime)).toEqual([0, 60])
  })

  it("switching modes only changes the mapping: no seek, no pause", () => {
    const cells = setup([60, 120])
    cells[0].s.currentTime = 15
    cells[1].s.currentTime = 90
    act(() => void cells.forEach((c) => c.el.play()))
    const seeks = vi.fn()
    for (const c of cells) c.el.addEventListener("timeupdate", seeks) // fakeMedia fires it on every currentTime write
    fireEvent.click(radio("Sync by percent"))
    expect(bar().getByText("25%")).toBeTruthy()
    fireEvent.click(radio("Sync by time"))
    expect(bar().getByText("0:15 / 2:00")).toBeTruthy()
    expect(seeks).not.toHaveBeenCalled()
    expect(cells.map((c) => c.s.currentTime)).toEqual([15, 90])
    for (const c of cells) {
      expect(c.s.paused).toBe(false)
      expect(c.el.pause).not.toHaveBeenCalled()
    }
  })

  it("arrow keys stay relative to each cell's own time in percent mode", () => {
    const cells = setup([60, 30])
    fireEvent.click(radio("Sync by percent"))
    cells[0].s.currentTime = 10
    cells[1].s.currentTime = 28
    fireEvent.keyDown(document.body, { key: "ArrowRight" })
    expect(cells.map((c) => c.s.currentTime)).toEqual([15, 30])
  })
})

describe("ComparePlayPage global bar", () => {
  it("global seek puts every cell at the same absolute time, clamped per item, skipping unknown durations", () => {
    const cells = setup([10, 20, 5, NaN])
    const slider = bar().getByRole("slider", { name: "Seek" })
    expect(slider.getAttribute("aria-valuemax")).toBe("20") // the longest known duration
    ;(slider.firstElementChild as HTMLElement).getBoundingClientRect = () => rect(200)
    fireEvent.pointerDown(slider, { clientX: 150, pointerId: 1 }) // 75% of 20 s = 15 s
    expect(cells.map((c) => c.s.currentTime)).toEqual([10, 15, 5, 0])
  })

  it("throttles a drag: the first move applies at once, the rest coalesce", () => {
    vi.useFakeTimers()
    const cells = setup([100])
    const slider = bar().getByRole("slider", { name: "Seek" })
    ;(slider.firstElementChild as HTMLElement).getBoundingClientRect = () => rect(200)
    fireEvent.pointerDown(slider, { clientX: 20, pointerId: 1 })
    fireEvent.pointerMove(slider, { clientX: 60, pointerId: 1 })
    fireEvent.pointerMove(slider, { clientX: 100, pointerId: 1 })
    expect(cells[0].s.currentTime).toBe(10)
    act(() => void vi.advanceTimersByTime(50))
    expect(cells[0].s.currentTime).toBe(50)
    vi.useRealTimers()
  })

  it("shows the reference position (first playing cell, else the first) over the longest duration", () => {
    const cells = setup([60, 120])
    cells[0].s.currentTime = 5
    cells[1].s.currentTime = 70
    act(() => void cells[0].el.dispatchEvent(new Event("timeupdate")))
    expect(bar().getByText("0:05 / 2:00")).toBeTruthy()
    act(() => void cells[1].el.play())
    expect(bar().getByText("1:10 / 2:00")).toBeTruthy()
  })

  it("the speed menu sets every cell", async () => {
    const cells = setup([10, 10])
    const user = userEvent.setup()
    await user.click(bar().getByRole("button", { name: /Playback speed, 1×/ }))
    await user.click(await screen.findByRole("menuitemradio", { name: "1.5×" }))
    for (const c of cells) expect(c.s.playbackRate).toBe(1.5)
    expect(bar().getByRole("button", { name: /Playback speed, 1.5×/ })).toBeTruthy()
  })

  it("the master volume sets every cell's volume and unmutes it", () => {
    const cells = setup([10, 10])
    cells[0].s.muted = true
    fireEvent.change(bar().getByRole("slider", { name: "Volume" }), { target: { value: "0.3" } })
    for (const c of cells) expect(c.s.volume).toBe(0.3)
    expect(cells[0].s.muted).toBe(false)
  })

  it("the Play/Pause-all label follows the cells' real state", () => {
    const cells = setup([10, 10])
    expect(bar().getByRole("button", { name: "Play all" })).toBeTruthy()
    fireEvent.click(bar().getByRole("button", { name: "Play all" }))
    expect(bar().getByRole("button", { name: "Pause all" })).toBeTruthy()
    act(() => void cells[0].el.pause()) // one paused by hand: another still plays
    expect(bar().getByRole("button", { name: "Pause all" })).toBeTruthy()
    act(() => void cells[1].el.pause())
    expect(bar().getByRole("button", { name: "Play all" })).toBeTruthy()
    act(() => void cells[0].el.play())
    expect(bar().getByRole("button", { name: "Pause all" })).toBeTruthy()
  })

  it("Wait for ready blocks the button and Space until every cell can play through, but never blocks pausing", () => {
    localStorage.setItem("packrat:compare-wait-for-ready", "true")
    const cells = setup([10, 10])
    fireEvent.click(bar().getByRole("button", { name: "Play all" }))
    fireEvent.keyDown(document.body, { key: " " })
    for (const c of cells) expect(c.el.play).not.toHaveBeenCalled()
    expect(bar().getByRole("button", { name: "Play all" }).getAttribute("aria-disabled")).toBe("true")
    ready([cells[0]])
    fireEvent.keyDown(document.body, { key: " " })
    for (const c of cells) expect(c.el.play).not.toHaveBeenCalled()
    ready([cells[1]])
    expect(bar().getByRole("button", { name: "Play all" }).getAttribute("aria-disabled")).toBeNull()
    fireEvent.keyDown(document.body, { key: " " })
    for (const c of cells) expect(c.el.play).toHaveBeenCalledTimes(1)
    act(() => void cells[0].el.dispatchEvent(new Event("waiting"))) // one stalls: pausing still works
    fireEvent.keyDown(document.body, { key: " " })
    for (const c of cells) expect(c.el.pause).toHaveBeenCalledTimes(1)
  })

  it("keeps the Preload and Wait for ready switches and their storage keys", async () => {
    setup([10])
    const user = userEvent.setup()
    const wait = bar().getByRole("switch", { name: "Wait for ready" })
    expect(wait.getAttribute("aria-checked")).toBe("false")
    await user.click(wait)
    expect(localStorage.getItem("packrat:compare-wait-for-ready")).toBe("true")
    await user.click(bar().getByRole("switch", { name: "Preload" }))
    expect(localStorage.getItem("packrat:compare-preload")).toBe("false")
  })

  it("skips private (locked) cells in every global control and counts them ready", () => {
    localStorage.setItem("packrat:compare-wait-for-ready", "true")
    h.items = []
    const cells = setup([10, 10, 10], { 2: { blurred: true } })
    expect(cells).toHaveLength(2) // the locked cell mounts no element
    expect(screen.getByText("This item is private")).toBeTruthy()
    ready(cells)
    fireEvent.keyDown(document.body, { key: " " })
    for (const c of cells) expect(c.el.play).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document.body, { key: "ArrowRight" })
    for (const c of cells) expect(c.s.currentTime).toBe(5)
  })

  it("a private cell revealed later adopts the global speed, and the master volume only once it was moved", async () => {
    const cells = setup([10, 10], { 2: { blurred: true } })
    expect(cells).toHaveLength(1)
    const user = userEvent.setup()
    await user.click(bar().getByRole("button", { name: /Playback speed, 1×/ }))
    await user.click(await screen.findByRole("menuitemradio", { name: "0.5×" }))
    fireEvent.change(bar().getByRole("slider", { name: "Volume" }), { target: { value: "0.4" } })
    await user.click(screen.getByText("This item is private"))
    const videos = Array.from(document.querySelectorAll("video"))
    expect(videos).toHaveLength(2)
    expect(videos[1].playbackRate).toBe(0.5)
    expect(videos[1].volume).toBe(0.4)
  })
})

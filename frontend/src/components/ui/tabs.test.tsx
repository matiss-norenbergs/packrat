import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Tabs, TabsList, TabsTrigger } from "./tabs"

function setLayout(el: HTMLElement, { scrollWidth, clientWidth, scrollLeft }: Record<string, number>) {
  Object.defineProperty(el, "scrollWidth", { value: scrollWidth, configurable: true })
  Object.defineProperty(el, "clientWidth", { value: clientWidth, configurable: true })
  Object.defineProperty(el, "scrollLeft", { value: scrollLeft, configurable: true, writable: true })
}

// The tab triggers are buttons too; the scroll buttons are the aria-hidden ones.
const scrollButtons = () => Array.from(document.querySelectorAll("button[aria-hidden=true]"))

function renderTabs() {
  render(
    <Tabs defaultValue="a">
      <TabsList>
        <TabsTrigger value="a">A</TabsTrigger>
        <TabsTrigger value="b">B</TabsTrigger>
      </TabsList>
    </Tabs>,
  )
  return screen.getByRole("tablist")
}

// Lay the row out, then fire a scroll and flush the rAF throttle.
function applyLayout(list: HTMLElement, layout: Record<string, number>) {
  setLayout(list, layout)
  act(() => {
    fireEvent.scroll(list)
    vi.runAllTimers()
  })
}

describe("TabsList scroll buttons", () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout"] })
    Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo
    Element.prototype.scrollBy = vi.fn() as unknown as typeof Element.prototype.scrollBy
  })

  it("renders no buttons when every tab fits", () => {
    const list = renderTabs()
    applyLayout(list, { scrollWidth: 300, clientWidth: 300, scrollLeft: 0 })
    expect(scrollButtons()).toHaveLength(0)
  })

  it("shows only the right button at the start", () => {
    const list = renderTabs()
    applyLayout(list, { scrollWidth: 800, clientWidth: 300, scrollLeft: 0 })
    expect(scrollButtons()).toHaveLength(1)
    expect(document.querySelector("svg.lucide-chevron-right")).not.toBeNull()
  })

  it("shows both buttons in the middle", () => {
    const list = renderTabs()
    applyLayout(list, { scrollWidth: 800, clientWidth: 300, scrollLeft: 200 })
    expect(scrollButtons()).toHaveLength(2)
  })

  it("shows only the left button at the end", () => {
    const list = renderTabs()
    applyLayout(list, { scrollWidth: 800, clientWidth: 300, scrollLeft: 500 })
    expect(scrollButtons()).toHaveLength(1)
    expect(document.querySelector("svg.lucide-chevron-left")).not.toBeNull()
  })

  it("keeps the buttons out of keyboard and screen reader flow", () => {
    const list = renderTabs()
    applyLayout(list, { scrollWidth: 800, clientWidth: 300, scrollLeft: 200 })
    for (const b of scrollButtons()) {
      expect(b).toHaveAttribute("tabindex", "-1")
      expect(b).toHaveAttribute("aria-hidden", "true")
    }
  })

  it("scrolls about 70% of the visible width in the clicked direction", () => {
    const list = renderTabs()
    applyLayout(list, { scrollWidth: 800, clientWidth: 300, scrollLeft: 200 })
    const [left, right] = scrollButtons()
    fireEvent.click(right)
    expect(list.scrollBy).toHaveBeenLastCalledWith({ left: 210, behavior: expect.any(String) })
    fireEvent.click(left)
    expect(list.scrollBy).toHaveBeenLastCalledWith({ left: -210, behavior: expect.any(String) })
  })

  it("turns a vertical wheel into horizontal scroll only while the row can move", () => {
    const list = renderTabs()
    setLayout(list, { scrollWidth: 800, clientWidth: 300, scrollLeft: 100 })
    const mid = new WheelEvent("wheel", { deltaY: 40, cancelable: true })
    list.dispatchEvent(mid)
    expect(mid.defaultPrevented).toBe(true)
    expect(list.scrollLeft).toBe(140)

    // Line and page deltas are converted to pixels (16px per line, a page is the row's width).
    setLayout(list, { scrollWidth: 800, clientWidth: 300, scrollLeft: 100 })
    const lines = new WheelEvent("wheel", { deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE, cancelable: true })
    list.dispatchEvent(lines)
    expect(lines.defaultPrevented).toBe(true)
    expect(list.scrollLeft).toBe(148)

    setLayout(list, { scrollWidth: 800, clientWidth: 300, scrollLeft: 100 })
    const pages = new WheelEvent("wheel", { deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_PAGE, cancelable: true })
    list.dispatchEvent(pages)
    expect(list.scrollLeft).toBe(400)

    // Edge checks depend only on the sign, whatever the unit.
    setLayout(list, { scrollWidth: 800, clientWidth: 300, scrollLeft: 500 })
    const atEndLines = new WheelEvent("wheel", { deltaY: 3, deltaMode: WheelEvent.DOM_DELTA_LINE, cancelable: true })
    list.dispatchEvent(atEndLines)
    expect(atEndLines.defaultPrevented).toBe(false)

    const atEnd = new WheelEvent("wheel", { deltaY: 40, cancelable: true })
    list.dispatchEvent(atEnd)
    expect(atEnd.defaultPrevented).toBe(false)

    setLayout(list, { scrollWidth: 300, clientWidth: 300, scrollLeft: 0 })
    const fits = new WheelEvent("wheel", { deltaY: 40, cancelable: true })
    list.dispatchEvent(fits)
    expect(fits.defaultPrevented).toBe(false)
  })
})

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CollapsiblePanel } from "@/components/CollapsiblePanel"

// jsdom has no layout, so getBoundingClientRect and ResizeObserver are mocked:
// the flex row is ROW_WIDTH wide (so the 50% max is ROW_WIDTH / 2), and the
// panel wrapper's right edge is at PANEL_RIGHT.
const KEY = "test:panel-width"
const ROW_WIDTH = 1000
const PANEL_RIGHT = 1000

let rowWidth = ROW_WIDTH
let observers: Array<() => void> = []

beforeEach(() => {
  localStorage.clear()
  rowWidth = ROW_WIDTH
  observers = []
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const isRow = this.dataset.testid === "row"
    const isPanel = this.className.includes("overflow-hidden")
    const width = isRow ? rowWidth : 0
    const right = isPanel ? PANEL_RIGHT : width
    return { x: 0, y: 0, top: 0, left: right - width, bottom: 0, right, width, height: 0, toJSON: () => ({}) }
  })
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        observers.push(cb)
      }
      observe() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function panel(key = KEY, open = true, label = "artist images panel") {
  return (
    <CollapsiblePanel open={open} onOpenChange={() => {}} label={label} widthStorageKey={key}>
      <p>content</p>
    </CollapsiblePanel>
  )
}
const renderPanel = (key = KEY, open = true) => render(<div data-testid="row">{panel(key, open)}</div>)
const outer = (c: HTMLElement) => c.querySelector<HTMLElement>(".relative.shrink-0")!
const widthVar = (c: HTMLElement) => outer(c).style.getPropertyValue("--panel-w")
const handle = () => screen.getByRole("separator", { name: "Resize artist images panel" })
// Pointer events: jsdom lacks PointerEvent (clientX would be lost), so the
// events are dispatched as mouse events carrying the pointer event name.
const pointer = (el: Element, type: string, clientX: number) =>
  fireEvent(el, new MouseEvent(type, { bubbles: true, clientX, button: 0 }))

describe("CollapsiblePanel", () => {
  it("renders the resize handle only when open", () => {
    const { rerender } = renderPanel()
    expect(screen.queryByRole("separator")).toBeInTheDocument()
    rerender(<div data-testid="row">{panel(KEY, false)}</div>)
    expect(screen.queryByRole("separator")).not.toBeInTheDocument()
  })

  it("hides the handle and keeps the fixed w-80 below md (via classes)", () => {
    const { container } = renderPanel()
    expect(handle().className).toContain("hidden")
    expect(handle().className).toContain("md:block")
    expect(container.querySelector(".overflow-hidden")!.className).toContain("w-80 md:w-(--panel-w)")
  })

  it("defaults to 320px", () => {
    const { container } = renderPanel()
    expect(widthVar(container)).toBe("320px")
  })

  it("renders a stored 400px width", () => {
    localStorage.setItem(KEY, "400")
    const { container } = renderPanel()
    expect(widthVar(container)).toBe("400px")
    expect(handle()).toHaveAttribute("aria-valuenow", "400")
    expect(handle()).toHaveAttribute("aria-valuemin", "280")
    expect(handle()).toHaveAttribute("aria-valuemax", "500")
  })

  it("clamps above 50% of the row without touching the stored value, and restores on regrow", () => {
    localStorage.setItem(KEY, "700")
    const { container } = renderPanel()
    expect(widthVar(container)).toBe("500px")
    expect(localStorage.getItem(KEY)).toBe("700")
    rowWidth = 1600
    observers.forEach((cb) => cb())
    // ResizeObserver callbacks trigger a state update outside act in this stub
    return vi.waitFor(() => expect(widthVar(container)).toBe("700px")).then(() => {
      expect(localStorage.getItem(KEY)).toBe("700")
    })
  })

  it("lets the 280px minimum win when 50% of the row is smaller", () => {
    rowWidth = 400
    localStorage.setItem(KEY, "350")
    const { container } = renderPanel()
    expect(widthVar(container)).toBe("280px")
  })

  it("renders stored values below the minimum at 280", () => {
    localStorage.setItem(KEY, "100")
    const { container } = renderPanel()
    expect(widthVar(container)).toBe("280px")
  })

  it("collapses to width 0 when closed", () => {
    const { container } = renderPanel(KEY, false)
    const wrapper = container.querySelector(".overflow-hidden")!
    expect(wrapper.className).toContain("w-0")
    expect(wrapper.className).not.toContain("md:w-(--panel-w)")
  })

  it("resets to 320 and stores it on double-click", () => {
    localStorage.setItem(KEY, "450")
    const { container } = renderPanel()
    fireEvent.doubleClick(handle())
    expect(widthVar(container)).toBe("320px")
    expect(localStorage.getItem(KEY)).toBe("320")
  })

  it("handles keyboard resizing and persists each change", () => {
    const { container } = renderPanel()
    fireEvent.keyDown(handle(), { key: "ArrowLeft" })
    expect(widthVar(container)).toBe("336px")
    fireEvent.keyDown(handle(), { key: "ArrowLeft", shiftKey: true })
    expect(widthVar(container)).toBe("400px")
    fireEvent.keyDown(handle(), { key: "ArrowRight" })
    expect(widthVar(container)).toBe("384px")
    expect(localStorage.getItem(KEY)).toBe("384")
    fireEvent.keyDown(handle(), { key: "ArrowRight", shiftKey: true })
    expect(widthVar(container)).toBe("320px")
    fireEvent.keyDown(handle(), { key: "Home" })
    expect(widthVar(container)).toBe("280px")
    expect(localStorage.getItem(KEY)).toBe("280")
    fireEvent.keyDown(handle(), { key: "End" })
    expect(widthVar(container)).toBe("500px")
    expect(localStorage.getItem(KEY)).toBe("500")
    fireEvent.keyDown(handle(), { key: "Enter" })
    expect(widthVar(container)).toBe("320px")
    expect(localStorage.getItem(KEY)).toBe("320")
  })

  it("clamps keyboard steps at the limits", () => {
    const { container } = renderPanel()
    fireEvent.keyDown(handle(), { key: "Home" })
    fireEvent.keyDown(handle(), { key: "ArrowRight", shiftKey: true })
    expect(widthVar(container)).toBe("280px")
    fireEvent.keyDown(handle(), { key: "End" })
    fireEvent.keyDown(handle(), { key: "ArrowLeft", shiftKey: true })
    expect(widthVar(container)).toBe("500px")
  })

  it("follows a pointer drag live and persists only on release", () => {
    const { container } = renderPanel()
    pointer(handle(), "pointerdown", 680)
    expect(widthVar(container)).toBe("320px")
    pointer(handle(), "pointermove", 600)
    expect(widthVar(container)).toBe("400px")
    expect(container.querySelector(".overflow-hidden")!.className).toContain("transition-none")
    expect(document.body.style.userSelect).toBe("none")
    expect(localStorage.getItem(KEY)).toBeNull()
    pointer(handle(), "pointermove", 100) // beyond max
    expect(widthVar(container)).toBe("500px")
    pointer(handle(), "pointermove", 900) // beyond min
    expect(widthVar(container)).toBe("280px")
    pointer(handle(), "pointermove", 550)
    pointer(handle(), "pointerup", 550)
    expect(widthVar(container)).toBe("450px")
    expect(localStorage.getItem(KEY)).toBe("450")
    expect(container.querySelector(".overflow-hidden")!.className).not.toContain("transition-none")
    expect(document.body.style.userSelect).toBe("")
  })

  it("keeps independent widths for panels with different keys", () => {
    localStorage.setItem("test:a", "300")
    localStorage.setItem("test:b", "450")
    const a = render(<div data-testid="row">{panel("test:a")}</div>)
    const b = render(<div data-testid="row">{panel("test:b")}</div>)
    expect(widthVar(a.container)).toBe("300px")
    expect(widthVar(b.container)).toBe("450px")
    fireEvent.keyDown(screen.getAllByRole("separator")[0], { key: "Home" })
    expect(localStorage.getItem("test:a")).toBe("280")
    expect(localStorage.getItem("test:b")).toBe("450")
  })
})

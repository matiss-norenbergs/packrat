import type { ComponentProps } from "react"
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
    // The panel wrapper's width follows the rendered --panel-w, as in a real layout.
    const panelWidth = isPanel ? parseFloat(this.parentElement!.style.getPropertyValue("--panel-w")) : width
    const right = isPanel ? PANEL_RIGHT : width
    return { x: 0, y: 0, top: 0, left: right - panelWidth, bottom: 0, right, width, height: 0, toJSON: () => ({}) }
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

function panel(key = KEY, open = true, label = "artist images panel", props: SizingProps = {}) {
  return (
    <CollapsiblePanel open={open} onOpenChange={() => {}} label={label} widthStorageKey={key} {...props}>
      <p>content</p>
    </CollapsiblePanel>
  )
}
type SizingProps = Pick<ComponentProps<typeof CollapsiblePanel>, "minWidth" | "maxRatio" | "defaultWidth">
const renderPanel = (key = KEY, open = true, props: SizingProps = {}) =>
  render(<div data-testid="row">{panel(key, open, undefined, props)}</div>)
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

  it("defaults to 500px", () => {
    const { container } = renderPanel()
    expect(widthVar(container)).toBe("500px")
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

  it("resets to the default and removes the stored key on double-click", () => {
    localStorage.setItem(KEY, "450")
    const { container } = renderPanel()
    expect(widthVar(container)).toBe("450px")
    fireEvent.doubleClick(handle())
    expect(widthVar(container)).toBe("500px")
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it("handles keyboard resizing and persists each change", () => {
    const { container } = renderPanel()
    fireEvent.keyDown(handle(), { key: "ArrowRight" })
    expect(widthVar(container)).toBe("484px")
    fireEvent.keyDown(handle(), { key: "ArrowRight", shiftKey: true })
    expect(widthVar(container)).toBe("420px")
    fireEvent.keyDown(handle(), { key: "ArrowLeft" })
    expect(widthVar(container)).toBe("436px")
    expect(localStorage.getItem(KEY)).toBe("436")
    fireEvent.keyDown(handle(), { key: "ArrowLeft", shiftKey: true })
    expect(widthVar(container)).toBe("500px")
    fireEvent.keyDown(handle(), { key: "Home" })
    expect(widthVar(container)).toBe("280px")
    expect(localStorage.getItem(KEY)).toBe("280")
    fireEvent.keyDown(handle(), { key: "End" })
    expect(widthVar(container)).toBe("500px")
    expect(localStorage.getItem(KEY)).toBe("500")
    fireEvent.keyDown(handle(), { key: "Home" })
    fireEvent.keyDown(handle(), { key: "Enter" })
    expect(widthVar(container)).toBe("500px")
    expect(localStorage.getItem(KEY)).toBeNull()
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
    pointer(handle(), "pointerdown", 500)
    expect(widthVar(container)).toBe("500px")
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

  it("does not nudge the width on a press-and-release inside the handle", () => {
    localStorage.setItem(KEY, "400")
    const { container } = renderPanel()
    pointer(handle(), "pointerdown", 605) // 5px right of the panel's left edge (600)
    expect(widthVar(container)).toBe("400px")
    pointer(handle(), "pointerup", 605)
    expect(widthVar(container)).toBe("400px")
    expect(localStorage.getItem(KEY)).toBe("400")
  })

  it("does not overwrite a clamped stored width on a plain click", () => {
    localStorage.setItem(KEY, "700") // rendered clamped to 500
    renderPanel()
    pointer(handle(), "pointerdown", 505)
    pointer(handle(), "pointerup", 505)
    expect(localStorage.getItem(KEY)).toBe("700")
  })

  it("resizes by exactly the pointer travel when grabbed at an offset", () => {
    localStorage.setItem(KEY, "320")
    const { container } = renderPanel()
    pointer(handle(), "pointerdown", 685) // 5px inside the left edge (680)
    pointer(handle(), "pointermove", 645) // 40px left
    expect(widthVar(container)).toBe("360px")
    pointer(handle(), "pointermove", 725) // 40px right of the grab point
    expect(widthVar(container)).toBe("280px")
    pointer(handle(), "pointermove", 645)
    pointer(handle(), "pointerup", 645)
    expect(widthVar(container)).toBe("360px")
    expect(localStorage.getItem(KEY)).toBe("360")
  })

  it("still clamps at the limits with a grab offset", () => {
    localStorage.setItem(KEY, "320")
    const { container } = renderPanel()
    pointer(handle(), "pointerdown", 685)
    pointer(handle(), "pointermove", 0)
    expect(widthVar(container)).toBe("500px")
    pointer(handle(), "pointermove", 990)
    expect(widthVar(container)).toBe("280px")
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

  it("does not write storage on a press-and-release at the default width", () => {
    renderPanel()
    pointer(handle(), "pointerdown", 505)
    pointer(handle(), "pointerup", 505)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  describe("sizing props", () => {
    const props = { minWidth: 200, maxRatio: 0.6, defaultWidth: 350 }

    it("uses defaultWidth when nothing is stored, and reports aria values", () => {
      const { container } = renderPanel(KEY, true, props)
      expect(widthVar(container)).toBe("350px")
      expect(handle()).toHaveAttribute("aria-valuenow", "350")
      expect(handle()).toHaveAttribute("aria-valuemin", "200")
      expect(handle()).toHaveAttribute("aria-valuemax", "600")
    })

    it("clamps drags to the custom min and max", () => {
      const { container } = renderPanel(KEY, true, props)
      pointer(handle(), "pointerdown", 650)
      pointer(handle(), "pointermove", 0)
      expect(widthVar(container)).toBe("600px")
      pointer(handle(), "pointermove", 990)
      expect(widthVar(container)).toBe("200px")
    })

    it("maps Home/End to the custom min/max", () => {
      const { container } = renderPanel(KEY, true, props)
      fireEvent.keyDown(handle(), { key: "Home" })
      expect(widthVar(container)).toBe("200px")
      expect(localStorage.getItem(KEY)).toBe("200")
      fireEvent.keyDown(handle(), { key: "End" })
      expect(widthVar(container)).toBe("600px")
      expect(localStorage.getItem(KEY)).toBe("600")
    })

    it("clamps defaultWidth into [min, max] at render", () => {
      const high = renderPanel(KEY, true, { defaultWidth: 900 })
      expect(widthVar(high.container)).toBe("500px")
      high.unmount()
      const low = renderPanel(KEY, true, { defaultWidth: 100 })
      expect(widthVar(low.container)).toBe("280px")
    })

    it("raises the max to the min when minWidth exceeds the row share", () => {
      const { container } = renderPanel(KEY, true, { minWidth: 700, maxRatio: 0.5 })
      expect(widthVar(container)).toBe("700px")
      expect(handle()).toHaveAttribute("aria-valuemax", "700")
    })

    it("lets a stored custom width win over the default", () => {
      localStorage.setItem(KEY, "420")
      const { container } = renderPanel(KEY, true, props)
      expect(widthVar(container)).toBe("420px")
    })

    it("resets a custom width to the prop default and removes the key", () => {
      localStorage.setItem(KEY, "420")
      const { container } = renderPanel(KEY, true, props)
      fireEvent.doubleClick(handle())
      expect(widthVar(container)).toBe("350px")
      expect(localStorage.getItem(KEY)).toBeNull()
      fireEvent.keyDown(handle(), { key: "End" })
      fireEvent.keyDown(handle(), { key: "Enter" })
      expect(widthVar(container)).toBe("350px")
      expect(localStorage.getItem(KEY)).toBeNull()
    })
  })
})

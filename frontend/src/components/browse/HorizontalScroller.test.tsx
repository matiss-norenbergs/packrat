import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { HorizontalScroller } from "./HorizontalScroller"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("HorizontalScroller scroll behavior", () => {
  function setup(reduce: boolean) {
    vi.stubGlobal("matchMedia", () => ({ matches: reduce, addEventListener() {}, removeEventListener() {} }))
    const calls: ScrollToOptions[] = []
    Element.prototype.scrollTo = function (o?: ScrollToOptions | number) {
      if (typeof o === "object") calls.push(o)
    } as typeof Element.prototype.scrollTo
    return calls
  }

  it("uses behavior auto under reduced motion and smooth otherwise, and the list opts out of CSS smoothing", () => {
    for (const [reduce, expected] of [[true, "auto"], [false, "smooth"]] as const) {
      const calls = setup(reduce)
      // Pretend every box overflows so the arrows exist (read in the layout effect).
      Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => 3000 })
      Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 500 })
      const { container } = render(
        <HorizontalScroller>
          {[1, 2, 3].map((n) => (
            <div key={n}>{n}</div>
          ))}
        </HorizontalScroller>,
      )
      const list = container.querySelector(".overflow-x-auto")!
      expect(list).toHaveClass("scroll-smooth", "motion-reduce:scroll-auto")
      const right = screen.getByRole("button", { name: "Scroll right" })
      fireEvent.click(right)
      expect(calls.length).toBeGreaterThan(0)
      expect(calls.every((c) => c.behavior === expected)).toBe(true)
      cleanup()
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollWidth
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
    }
  })
})

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { BlurredThumbnail } from "./BlurredThumbnail"

vi.mock("@/hooks/useSettings", () => ({ useSettings: () => ({ data: { privacyBlurStrength: "default" } }) }))

afterEach(cleanup)

function renderThumb(props: Partial<React.ComponentProps<typeof BlurredThumbnail>> = {}) {
  render(
    <TooltipProvider>
      <BlurredThumbnail src="/t.jpg" alt="thumb" blurred={false} revealed={false} onToggleReveal={() => {}} {...props} />
    </TooltipProvider>,
  )
  return screen.getByAltText("thumb")
}

describe("BlurredThumbnail muted", () => {
  it("is grayscale until hovered when muted", () => {
    const img = renderThumb({ muted: true })
    expect(img).toHaveClass("grayscale", "transition-[filter]", "duration-150", "hover:grayscale-0")
    expect(img).not.toHaveClass("blur-md")
  })

  it("has no grayscale when not muted", () => {
    const img = renderThumb()
    expect(img).not.toHaveClass("grayscale")
    expect(img).not.toHaveClass("hover:grayscale-0")
  })

  it("keeps the blurred behavior when blurred and unrevealed", () => {
    const img = renderThumb({ muted: true, blurred: true })
    expect(img).toHaveClass("blur-md", "grayscale", "hover:grayscale-0")
  })

  it("does not un-grey a blurred thumbnail on hover when not interactive", () => {
    const img = renderThumb({ muted: true, blurred: true, interactive: false })
    expect(img).toHaveClass("blur-md", "grayscale")
    expect(img).not.toHaveClass("hover:grayscale-0")
  })

  it("is grayscale with hover clearing once revealed", () => {
    const img = renderThumb({ muted: true, blurred: true, revealed: true })
    expect(img).toHaveClass("grayscale", "hover:grayscale-0")
    expect(img).not.toHaveClass("blur-md")
  })
})

// jsdom can't run CSS transitions, so these only pin the DOM-identity
// contract that prevents the flash; the actual filter timeline was measured
// in a real browser (see CHANGELOG).
describe("BlurredThumbnail element identity", () => {
  function ui(props: Partial<React.ComponentProps<typeof BlurredThumbnail>>) {
    return (
      <TooltipProvider>
        <BlurredThumbnail src="/a.jpg" alt="thumb" blurred revealed={false} onToggleReveal={() => {}} {...props} />
      </TooltipProvider>
    )
  }

  it("mounts a new <img> when src changes, blurred on its first render", () => {
    const { rerender } = render(ui({ src: "/a.jpg", revealed: true }))
    const first = screen.getByAltText("thumb")
    expect(first).not.toHaveClass("blur-md")

    rerender(ui({ src: "/b.jpg", revealed: false }))
    const second = screen.getByAltText("thumb")
    expect(second).not.toBe(first)
    expect(first.isConnected).toBe(false)
    expect(second).toHaveAttribute("src", "/b.jpg")
    expect(second).toHaveClass("blur-md", "grayscale")
  })

  it("keeps the same <img> and flips the blur classes when only revealed changes", () => {
    const { rerender } = render(ui({ revealed: false }))
    const img = screen.getByAltText("thumb")
    expect(img).toHaveClass("blur-md")

    rerender(ui({ revealed: true }))
    expect(screen.getByAltText("thumb")).toBe(img)
    expect(img).not.toHaveClass("blur-md")

    rerender(ui({ revealed: false }))
    expect(screen.getByAltText("thumb")).toBe(img)
    expect(img).toHaveClass("blur-md")
  })

  it("still toggles on click after the src changed", () => {
    const onToggle = vi.fn()
    const { rerender } = render(ui({ src: "/a.jpg", onToggleReveal: onToggle }))
    rerender(ui({ src: "/b.jpg", onToggleReveal: onToggle }))
    fireEvent.click(screen.getByAltText("thumb"))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})

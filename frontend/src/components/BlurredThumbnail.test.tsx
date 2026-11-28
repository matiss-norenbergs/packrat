import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { BlurredThumbnail } from "./BlurredThumbnail"

vi.mock("@/hooks/useSettings", () => ({ useSettings: () => ({ data: { privacyBlurStrength: "default" } }) }))


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

// The private-item reveal is keyboard-operable: the <img> itself is the button, so its box and blur are untouched.
describe("BlurredThumbnail reveal toggle (accessibility)", () => {
  function ui(props: Partial<React.ComponentProps<typeof BlurredThumbnail>>) {
    return (
      <TooltipProvider>
        <BlurredThumbnail src="/a.jpg" blurred revealed={false} onToggleReveal={() => {}} {...props} />
      </TooltipProvider>
    )
  }

  it("is a button named 'Reveal image', not pressed, while blurred and hidden", () => {
    render(ui({}))
    const button = screen.getByRole("button", { name: "Reveal image" })
    expect(button).toHaveAttribute("aria-pressed", "false")
    expect(button).toHaveAttribute("tabindex", "0")
    expect(button.tagName).toBe("IMG")
  })

  it("follows the state: 'Hide image' and pressed once revealed", () => {
    render(ui({ revealed: true }))
    expect(screen.getByRole("button", { name: "Hide image" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.queryByRole("button", { name: "Reveal image" })).toBeNull()
  })

  it("toggles with a click, Enter and Space, and Space does not scroll the page", () => {
    const onToggle = vi.fn()
    render(ui({ onToggleReveal: onToggle }))
    const button = screen.getByRole("button", { name: "Reveal image" })
    fireEvent.click(button)
    fireEvent.keyDown(button, { key: "Enter" })
    const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })
    button.dispatchEvent(space)
    expect(onToggle).toHaveBeenCalledTimes(3)
    expect(space.defaultPrevented).toBe(true)
  })

  it("ignores other keys", () => {
    const onToggle = vi.fn()
    render(ui({ onToggleReveal: onToggle }))
    fireEvent.keyDown(screen.getByRole("button", { name: "Reveal image" }), { key: "a" })
    fireEvent.keyDown(screen.getByRole("button", { name: "Reveal image" }), { key: "Tab" })
    expect(onToggle).not.toHaveBeenCalled()
  })

  it("is no button when not blurred", () => {
    render(ui({ blurred: false, alt: "thumb" }))
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.getByAltText("thumb")).not.toHaveAttribute("tabindex")
  })

  it("is no button when not interactive (a selection is active)", () => {
    render(ui({ interactive: false, alt: "thumb" }))
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.getByAltText("thumb")).not.toHaveAttribute("tabindex")
  })

  it("keeps the layout classes and the blur untouched", () => {
    render(ui({ className: "absolute inset-0 h-full w-full object-cover" }))
    const img = screen.getByRole("button", { name: "Reveal image" })
    expect(img).toHaveClass("absolute", "inset-0", "h-full", "w-full", "object-cover", "blur-md", "cursor-pointer")
  })

  it("marks the parent for the keyboard focus ring only for keyboard focus, and clears it on blur", () => {
    render(<div data-testid="frame">{ui({})}</div>)
    const img = screen.getByRole("button", { name: "Reveal image" })
    const frame = screen.getByTestId("frame")
    // jsdom has no :focus-visible; stand in for the browser's answer.
    const matches = vi.spyOn(img, "matches").mockReturnValue(true)
    fireEvent.focus(img)
    expect(frame).toHaveAttribute("data-reveal-focus")
    fireEvent.blur(img)
    expect(frame).not.toHaveAttribute("data-reveal-focus")
    matches.mockReturnValue(false) // a mouse click focuses the image too, but draws no ring
    fireEvent.focus(img)
    expect(frame).not.toHaveAttribute("data-reveal-focus")
  })
})

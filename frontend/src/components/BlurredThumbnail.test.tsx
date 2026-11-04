import { cleanup, render, screen } from "@testing-library/react"
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

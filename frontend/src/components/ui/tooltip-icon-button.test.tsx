import { createRef } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button"

afterEach(cleanup)

const renderButton = (ui: React.ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>)

describe("TooltipIconButton", () => {
  it("names the button from the label, with no tooltip needed", () => {
    renderButton(
      <TooltipIconButton label="Search" size="icon">
        <svg aria-hidden />
      </TooltipIconButton>,
    )
    expect(screen.getByRole("button", { name: "Search" })).toBeTruthy()
  })

  it("shows the label as the tooltip on hover (a separate tooltip text is allowed, the name stays the label)", async () => {
    renderButton(
      <TooltipIconButton label="Remove X" tooltip="Remove from list">
        <svg aria-hidden />
      </TooltipIconButton>,
    )
    await userEvent.hover(screen.getByRole("button", { name: "Remove X" }))
    expect((await screen.findAllByText("Remove from list")).length).toBeGreaterThan(0)
  })

  it("forwards Button props, the ref and the click, and renders no extra element around the button", async () => {
    const onClick = vi.fn()
    const ref = createRef<HTMLButtonElement>()
    const { container } = renderButton(
      <TooltipIconButton ref={ref} label="Go" variant="ghost" size="icon-xs" className="custom" aria-pressed={true} onClick={onClick}>
        <svg aria-hidden />
      </TooltipIconButton>,
    )
    const button = screen.getByRole("button", { name: "Go" })
    expect(container.firstElementChild).toBe(button)
    expect(ref.current).toBe(button)
    expect(button).toHaveClass("custom")
    expect(button).toHaveAttribute("data-variant", "ghost")
    expect(button).toHaveAttribute("data-size", "icon-xs")
    expect(button).toHaveAttribute("aria-pressed", "true")
    await userEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("keeps a disabled button disabled but named", () => {
    renderButton(
      <TooltipIconButton label="Move up" disabled>
        <svg aria-hidden />
      </TooltipIconButton>,
    )
    expect(screen.getByRole("button", { name: "Move up" })).toBeDisabled()
  })

  it("names a link styled as a button (asChild)", () => {
    renderButton(
      <TooltipIconButton label="Manage" asChild>
        <a href="/">
          <svg aria-hidden />
        </a>
      </TooltipIconButton>,
    )
    expect(screen.getByRole("link", { name: "Manage" })).toHaveAttribute("href", "/")
  })
})

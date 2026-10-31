import { useState } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Eye, Star } from "lucide-react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { FloatingAction, FloatingActionDock } from "@/components/FloatingActionDock"

afterEach(cleanup)

const dockEl = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-slot="floating-action-dock"]')!

describe("FloatingActionDock", () => {
  it("renders an action's button inside the dock", () => {
    const { container } = render(
      <FloatingActionDock>
        <FloatingAction icon={Eye} label="Reveal" onClick={() => {}} />
      </FloatingActionDock>,
    )
    expect(dockEl(container)).toContainElement(screen.getByRole("button", { name: "Reveal" }))
  })

  it("is empty (hidden via empty:) when no action is mounted", () => {
    const { container } = render(<FloatingActionDock>content</FloatingActionDock>)
    expect(dockEl(container)).toBeEmptyDOMElement()
    expect(dockEl(container).className).toContain("empty:hidden")
  })

  // The page footers' `dock-occupied` variant (styles/globals.css) is `:not(:empty)` on the dock, so it only
  // works while the dock has no children (not even whitespace text) without a button and some with one.
  it("matches :empty with no button and not with one", () => {
    const empty = render(<FloatingActionDock>content</FloatingActionDock>)
    expect(dockEl(empty.container).matches(":empty")).toBe(true)
    cleanup()

    const busy = render(
      <FloatingActionDock>
        <FloatingAction icon={Eye} label="Reveal" onClick={() => {}} />
      </FloatingActionDock>,
    )
    expect(dockEl(busy.container).matches(":empty")).toBe(false)
  })

  it("keeps the dock itself click-through but the buttons interactive", () => {
    const { container } = render(
      <FloatingActionDock>
        <FloatingAction icon={Eye} label="Reveal" onClick={() => {}} />
      </FloatingActionDock>,
    )
    expect(dockEl(container).className).toContain("pointer-events-none")
    expect(screen.getByRole("button", { name: "Reveal" }).parentElement!.className).toContain("pointer-events-auto")
  })

  it("stacks multiple actions by order", () => {
    const { container } = render(
      <FloatingActionDock>
        <FloatingAction icon={Star} label="Second" order={2} onClick={() => {}} />
        <FloatingAction icon={Eye} label="First" order={1} onClick={() => {}} />
      </FloatingActionDock>,
    )
    const wrappers = Array.from(dockEl(container).children) as HTMLElement[]
    expect(wrappers).toHaveLength(2)
    const orderOf = (name: string) => Number(screen.getByRole("button", { name }).parentElement!.style.order)
    expect(orderOf("First")).toBeLessThan(orderOf("Second"))
  })

  it("removes the button when the action unmounts", async () => {
    function Page() {
      const [on, setOn] = useState(true)
      return (
        <FloatingActionDock>
          <button onClick={() => setOn(false)}>remove</button>
          {on && <FloatingAction icon={Eye} label="Reveal" onClick={() => {}} />}
        </FloatingActionDock>
      )
    }
    render(<Page />)
    expect(screen.getByRole("button", { name: "Reveal" })).toBeInTheDocument()
    await userEvent.click(screen.getByText("remove"))
    expect(screen.queryByRole("button", { name: "Reveal" })).not.toBeInTheDocument()
  })

  it("uses label as aria-label and switches variant with active", () => {
    const { rerender } = render(
      <FloatingActionDock>
        <FloatingAction icon={Eye} label="Reveal" onClick={() => {}} />
      </FloatingActionDock>,
    )
    expect(screen.getByRole("button", { name: "Reveal" })).toHaveAttribute("data-variant", "outline")
    rerender(
      <FloatingActionDock>
        <FloatingAction icon={Eye} label="Reveal" active onClick={() => {}} />
      </FloatingActionDock>,
    )
    expect(screen.getByRole("button", { name: "Reveal" })).toHaveAttribute("data-variant", "default")
  })

  it("shows the label as a tooltip and calls onClick", async () => {
    const onClick = vi.fn()
    render(
      <FloatingActionDock>
        <FloatingAction icon={Eye} label="Reveal" onClick={onClick} />
      </FloatingActionDock>,
    )
    const btn = screen.getByRole("button", { name: "Reveal" })
    await userEvent.hover(btn)
    expect((await screen.findAllByText("Reveal")).length).toBeGreaterThan(0)
    await userEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("renders nothing and does not throw without a dock", () => {
    const { container } = render(<FloatingAction icon={Eye} label="Reveal" onClick={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})

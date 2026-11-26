import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import { InfoPopover } from "@/components/ui/info-popover"

afterEach(cleanup)

const trigger = () => screen.getByRole("button", { name: "More info" })
const content = () => screen.queryByText("Help text")
const renderIt = () => render(<InfoPopover>Help text</InfoPopover>)

// A tap = touch pointerdown + pointerup on the element (user-event also dispatches the compatibility mouse events and click).
const tap = (el: Element) => userEvent.pointer([{ keys: "[TouchA>]", target: el }, { keys: "[/TouchA]", target: el }])

describe("InfoPopover", () => {
  it("opens on a touch tap and stays open (the compatibility mouseenter must not toggle it shut)", async () => {
    renderIt()
    await tap(trigger())
    await waitFor(() => expect(content()).toBeTruthy())
    expect(trigger()).toHaveAttribute("aria-expanded", "true")
  })

  it("a second tap closes it", async () => {
    renderIt()
    await tap(trigger())
    await waitFor(() => expect(content()).toBeTruthy())
    await tap(trigger())
    await waitFor(() => expect(content()).toBeNull())
  })

  it("opens on a mouse hover and closes when the pointer leaves", async () => {
    renderIt()
    await userEvent.hover(trigger())
    await waitFor(() => expect(content()).toBeTruthy())
    await userEvent.unhover(trigger())
    await waitFor(() => expect(content()).toBeNull())
  })

  it("stays open while the mouse moves from the trigger onto the content", async () => {
    renderIt()
    await userEvent.hover(trigger())
    const c = await screen.findByText("Help text")
    await userEvent.hover(c)
    expect(content()).toBeTruthy()
    await userEvent.unhover(c)
    await waitFor(() => expect(content()).toBeNull())
  })

  it("a touch pointer entering does not open it (only a mouse hovers)", async () => {
    renderIt()
    fireEvent.pointerEnter(trigger(), { pointerType: "touch" })
    fireEvent.mouseEnter(trigger()) // the compatibility event a browser fires after a touch
    expect(content()).toBeNull()
    fireEvent.pointerEnter(trigger(), { pointerType: "pen" })
    expect(content()).toBeNull()
    fireEvent.pointerEnter(trigger(), { pointerType: "mouse" }) // control: the same synthetic event does open it for a mouse
    expect(content()).toBeTruthy()
  })

  it("toggles on a mouse click after hover", async () => {
    renderIt()
    const user = userEvent.setup() // one instance, so the pointer stays over the trigger between clicks
    await user.click(trigger()) // hover opens, the click toggles it shut
    await waitFor(() => expect(content()).toBeNull())
    await user.click(trigger())
    await waitFor(() => expect(content()).toBeTruthy())
  })

  it("works from the keyboard: Enter opens, Escape closes", async () => {
    renderIt()
    await userEvent.tab()
    expect(trigger()).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(content()).toBeTruthy())
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(content()).toBeNull())
    await userEvent.keyboard(" ")
    await waitFor(() => expect(content()).toBeTruthy())
  })

  it("grows the tap area to 44 px on coarse pointers without resizing the icon", () => {
    renderIt()
    const cls = trigger().className
    expect(cls).toContain("pointer-coarse:after:-inset-[15px]")
    expect(cls).toContain("pointer-coarse:after:absolute")
    expect(cls).toContain("pointer-coarse:relative")
    expect(trigger().querySelector("svg")).toHaveClass("h-3.5", "w-3.5")
  })
})

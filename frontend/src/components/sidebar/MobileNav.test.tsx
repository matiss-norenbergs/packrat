import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Route, Routes, useLocation } from "react-router-dom"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { mockFetch, renderWithProviders } from "@/test/mockApi"

vi.mock("@/components/ServerSwitcher", () => ({ SidebarServerSwitcher: () => null }))
vi.mock("@/components/sidebar/HostActionsMenu", () => ({ HostActionsMenu: () => null }))

import { MobileNav } from "./MobileNav"

beforeEach(() => mockFetch(() => ({ status: 200, body: {} })))

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>
}

function setup() {
  renderWithProviders(
    <TooltipProvider>
      <MobileNav />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </TooltipProvider>,
  )
  return userEvent.setup()
}

const toggle = () => screen.getByRole("button", { name: "Open menu" })

describe("MobileNav drawer", () => {
  it("is a modal dialog; the toggle reports aria-expanded", async () => {
    const user = setup()
    expect(toggle()).toHaveAttribute("aria-expanded", "false")
    await user.click(toggle())
    const dialog = await screen.findByRole("dialog", { name: "Navigation menu" })
    expect(dialog).toBeInTheDocument()
    expect(document.querySelector("[data-slot=sheet-trigger]")).toHaveAttribute("aria-expanded", "true")
  })

  it("moves focus in on open, keeps Tab inside, and Escape closes and returns focus to the toggle", async () => {
    const user = setup()
    await user.click(toggle())
    const dialog = await screen.findByRole("dialog")
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    for (let i = 0; i < 30; i++) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(toggle()).toHaveFocus()
    expect(toggle()).toHaveAttribute("aria-expanded", "false")
  })

  it("the Close menu button closes it and returns focus to the toggle", async () => {
    const user = setup()
    await user.click(toggle())
    await user.click(await screen.findByRole("button", { name: "Close menu" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(toggle()).toHaveFocus()
  })

  it("choosing a link navigates and closes the drawer", async () => {
    const user = setup()
    await user.click(toggle())
    const dialog = await screen.findByRole("dialog")
    const link = Array.from(dialog.querySelectorAll("a[href]")).find((a) => a.getAttribute("href") !== "/")!
    const href = link.getAttribute("href")!
    await user.click(link)
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.getByTestId("where")).toHaveTextContent(href)
  })
})

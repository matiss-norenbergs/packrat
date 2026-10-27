import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ThemeProvider } from "next-themes"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppearanceTab } from "@/components/settings/tabs/AppearanceTab"
import { bodyOf, callsTo, mockFetch, renderWithProviders } from "@/test/mockApi"

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }))
  // Radix Select needs these in jsdom.
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.scrollIntoView ??= () => {}
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("AppearanceTab", () => {
  it("has no Save button and PATCHes the changed key on change", async () => {
    const fetchMock = mockFetch(() => ({ status: 200, body: { theme: "dark", accent: "default" } }))
    renderWithProviders(
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <AppearanceTab />
      </ThemeProvider>,
    )
    const user = userEvent.setup()
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument()
    expect(screen.getByText("Saved to your account and applied instantly.")).toBeInTheDocument()

    const [themeSelect] = screen.getAllByRole("combobox")
    await user.click(themeSelect)
    await user.click(await screen.findByRole("option", { name: "Dark" }))

    await waitFor(() => expect(callsTo(fetchMock, "/auth/preferences")).toHaveLength(1))
    expect(bodyOf(callsTo(fetchMock, "/auth/preferences")[0])).toEqual({ theme: "dark" })
  })
})

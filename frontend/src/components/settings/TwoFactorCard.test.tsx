import { cleanup, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TwoFactorCard } from "@/components/settings/TwoFactorCard"
import { bodyOf, callsTo, mockFetch, renderWithProviders } from "@/test/mockApi"

const toastError = vi.fn()
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m), success: vi.fn() } }))

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
const URL = `otpauth://totp/Packrat:admin?secret=${SECRET}&issuer=Packrat`
const CODES = ["AAAA-2222", "BBBB-3333", "CCCC-4444", "DDDD-5555", "EEEE-6666", "FFFF-7777", "GGGG-8888", "HHHH-9999", "JJJJ-2345", "KKKK-6789"]

beforeEach(() => toastError.mockReset())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// A tiny stateful fake of the 2FA endpoints.
function fakeServer(initial: { enabled: boolean; remaining: number }) {
  const state = { ...initial }
  const fn = mockFetch((url, init) => {
    if (url.endsWith("/auth/2fa") && init.method !== "POST") {
      return { status: 200, body: { enabled: state.enabled, recoveryCodesRemaining: state.remaining } }
    }
    if (url.endsWith("/auth/2fa/setup")) return { status: 200, body: { secret: SECRET, otpauthUrl: URL } }
    if (url.endsWith("/auth/2fa/enable")) {
      const { code } = JSON.parse(init.body as string)
      if (code !== "123456") return { status: 401, body: { error: "invalid code" } }
      state.enabled = true
      state.remaining = 10
      return { status: 200, body: { recoveryCodes: CODES } }
    }
    if (url.endsWith("/auth/2fa/disable")) {
      state.enabled = false
      state.remaining = 0
      return { status: 204 }
    }
    if (url.endsWith("/auth/2fa/recovery-codes")) {
      state.remaining = 10
      return { status: 200, body: { recoveryCodes: CODES } }
    }
    return { status: 404 }
  })
  return fn
}

describe("TwoFactorCard", () => {
  it("walks the three enable steps", async () => {
    const fetchMock = fakeServer({ enabled: false, remaining: 0 })
    renderWithProviders(<TwoFactorCard />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole("button", { name: /Enable/ }))

    // Step 1: QR on a white tile + the key in groups of four.
    const tile = await screen.findByTestId("qr-tile")
    expect(tile).toHaveClass("bg-white")
    expect(tile.querySelector("svg")).not.toBeNull()
    expect(screen.getByTestId("secret-text")).toHaveTextContent("JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP")
    expect(callsTo(fetchMock, "/auth/2fa/setup")).toHaveLength(1)
    await user.click(screen.getByRole("button", { name: "Next" }))

    // Step 2: a wrong code is rejected and keeps you here...
    const input = await screen.findByLabelText("Authentication code")
    expect(input).toHaveAttribute("autocomplete", "one-time-code")
    await user.type(input, "000000")
    await user.click(screen.getByRole("button", { name: "Verify and enable" }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("invalid code"))
    expect(screen.queryByTestId("recovery-codes")).not.toBeInTheDocument()

    // ...the right one shows the recovery codes.
    await user.type(await screen.findByLabelText("Authentication code"), "123456")
    await user.click(screen.getByRole("button", { name: "Verify and enable" }))
    const grid = await screen.findByTestId("recovery-codes")
    for (const c of CODES) expect(within(grid).getByText(c)).toBeInTheDocument()
    expect(bodyOf(callsTo(fetchMock, "/auth/2fa/enable").at(-1)!)).toEqual({ code: "123456" })

    // Step 3: can't be closed until the codes are confirmed saved.
    const done = screen.getByRole("button", { name: "Done" })
    expect(done).toBeDisabled()
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument()
    await user.keyboard("{Escape}")
    expect(screen.getByTestId("recovery-codes")).toBeInTheDocument()
    await user.click(screen.getByLabelText("I've saved these codes"))
    expect(done).toBeEnabled()
    await user.click(done)
    await waitFor(() => expect(screen.queryByTestId("recovery-codes")).not.toBeInTheDocument())
    expect(await screen.findByText("Enabled")).toBeInTheDocument()
  })

  it("shows the remaining recovery codes and warns when two or fewer are left", async () => {
    fakeServer({ enabled: true, remaining: 7 })
    renderWithProviders(<TwoFactorCard />)
    expect(await screen.findByText("Recovery codes left:")).toBeInTheDocument()
    expect(screen.getByText("7")).toBeInTheDocument()
    expect(screen.queryByText(/running low/)).not.toBeInTheDocument()
    cleanup()

    fakeServer({ enabled: true, remaining: 2 })
    renderWithProviders(<TwoFactorCard />)
    expect(await screen.findByText(/running low/)).toBeInTheDocument()
  })

  it("disables with password + code", async () => {
    const fetchMock = fakeServer({ enabled: true, remaining: 5 })
    renderWithProviders(<TwoFactorCard />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: "Disable" }))
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("Password"), "hunter2-hunter2")
    await user.type(within(dialog).getByLabelText("Authentication code"), "123456")
    await user.click(within(dialog).getByRole("button", { name: "Disable" }))
    await waitFor(() => expect(callsTo(fetchMock, "/auth/2fa/disable")).toHaveLength(1))
    expect(bodyOf(callsTo(fetchMock, "/auth/2fa/disable")[0])).toEqual({ password: "hunter2-hunter2", code: "123456" })
    expect(await screen.findByRole("button", { name: /Enable/ })).toBeInTheDocument()
  })

  it("regenerates recovery codes and shows them once", async () => {
    const fetchMock = fakeServer({ enabled: true, remaining: 1 })
    renderWithProviders(<TwoFactorCard />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole("button", { name: "Regenerate recovery codes" }))
    const dialog = await screen.findByRole("dialog")
    await user.type(within(dialog).getByLabelText("Password"), "hunter2-hunter2")
    await user.type(within(dialog).getByLabelText("Authentication code"), "123456")
    await user.click(within(dialog).getByRole("button", { name: "Generate new codes" }))
    expect(await screen.findByTestId("recovery-codes")).toBeInTheDocument()
    expect(bodyOf(callsTo(fetchMock, "/auth/2fa/recovery-codes")[0])).toEqual({ password: "hunter2-hunter2", code: "123456" })
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled()
  })
})

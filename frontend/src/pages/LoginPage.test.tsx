import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { LoginPage } from "@/pages/LoginPage"
import { getToken, setServerUrl } from "@/lib/server"
import { bodyOf, callsTo, mockFetch, renderWithProviders } from "@/test/mockApi"

const toastError = vi.fn()
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m), success: vi.fn() }, Toaster: () => null }))

const CHALLENGE = { twoFactorRequired: true, challengeToken: "chal-1", expiresInSeconds: 300 }
const LOGGED_OUT = { setupRequired: false, authenticated: false }

function page() {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<div>home</div>} />
    </Routes>,
    "/login",
  )
}

async function enterPassword() {
  const user = userEvent.setup()
  await user.type(await screen.findByLabelText("Username"), "admin")
  await user.type(screen.getByLabelText("Password"), "hunter2-hunter2")
  await user.click(screen.getByRole("button", { name: "Log in" }))
  return user
}

beforeEach(() => {
  window.localStorage.clear()
  toastError.mockReset()
})
afterEach(() => {
  cleanup()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).__TAURI_INTERNALS__
  vi.unstubAllGlobals()
})

describe("LoginPage without 2FA", () => {
  it("still logs in with one step", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.endsWith("/auth/status")) return { status: 200, body: LOGGED_OUT }
      return { status: 204 }
    })
    page()
    await enterPassword()
    expect(await screen.findByText("home")).toBeInTheDocument()
    expect(callsTo(fetchMock, "/auth/login/2fa")).toHaveLength(0)
  })
})

describe("LoginPage with 2FA (web, cookies)", () => {
  function twoFactorServer(second: () => { status: number; body?: unknown }) {
    return mockFetch((url) => {
      if (url.endsWith("/auth/status")) return { status: 200, body: LOGGED_OUT }
      if (url.endsWith("/auth/login")) return { status: 200, body: CHALLENGE }
      if (url.endsWith("/auth/login/2fa")) return second()
      return { status: 404 }
    })
  }

  it("asks for the code, then signs in", async () => {
    const fetchMock = twoFactorServer(() => ({ status: 204 }))
    page()
    const user = await enterPassword()

    const input = await screen.findByLabelText("Authentication code")
    expect(input).toHaveAttribute("inputmode", "numeric")
    expect(input).toHaveAttribute("autocomplete", "one-time-code")
    expect(input).toHaveFocus()
    expect(screen.queryByText("home")).not.toBeInTheDocument()

    expect(screen.getByRole("button", { name: "Verify" })).toBeDisabled()
    // Non-digits are ignored, and the sixth digit submits without pressing Verify.
    await user.keyboard("12a345 6")
    expect(await screen.findByText("home")).toBeInTheDocument()
    expect(bodyOf(callsTo(fetchMock, "/auth/login/2fa")[0])).toEqual({ challengeToken: "chal-1", code: "123456" })
    expect(getToken()).toBeNull()
  })

  it("accepts the whole code pasted at once", async () => {
    const fetchMock = twoFactorServer(() => ({ status: 204 }))
    page()
    const user = await enterPassword()
    await screen.findByLabelText("Authentication code")
    await user.paste("246810")
    expect(await screen.findByText("home")).toBeInTheDocument()
    expect(bodyOf(callsTo(fetchMock, "/auth/login/2fa")[0])).toEqual({ challengeToken: "chal-1", code: "246810" })
  })

  it("does not submit a partial code", async () => {
    const fetchMock = twoFactorServer(() => ({ status: 204 }))
    page()
    const user = await enterPassword()
    await screen.findByLabelText("Authentication code")
    await user.keyboard("12345{Enter}")
    expect(callsTo(fetchMock, "/auth/login/2fa")).toHaveLength(0)
    expect(screen.getByRole("button", { name: "Verify" })).toBeDisabled()
  })

  it("can use a recovery code instead", async () => {
    const fetchMock = twoFactorServer(() => ({ status: 204 }))
    page()
    const user = await enterPassword()

    await user.click(await screen.findByRole("button", { name: "Use a recovery code" }))
    await user.type(screen.getByLabelText("Recovery code"), "k7f2-9qxm")
    await user.click(screen.getByRole("button", { name: "Verify" }))
    expect(await screen.findByText("home")).toBeInTheDocument()
    expect(bodyOf(callsTo(fetchMock, "/auth/login/2fa")[0])).toEqual({ challengeToken: "chal-1", recoveryCode: "k7f2-9qxm" })
  })

  it("a wrong recovery code gets its own friendly message", async () => {
    twoFactorServer(() => ({ status: 401, body: { error: "invalid code" } }))
    page()
    const user = await enterPassword()
    await user.click(await screen.findByRole("button", { name: "Use a recovery code" }))
    await user.type(screen.getByLabelText("Recovery code"), "k7f2-9qxm")
    await user.click(screen.getByRole("button", { name: "Verify" }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("That recovery code isn't valid or was already used."))
  })

  it("Back returns to the password step", async () => {
    twoFactorServer(() => ({ status: 204 }))
    page()
    const user = await enterPassword()
    await user.click(await screen.findByRole("button", { name: "Back" }))
    expect(await screen.findByRole("button", { name: "Log in" })).toBeInTheDocument()
  })

  it("a dead challenge sends you back to the password step with a message", async () => {
    twoFactorServer(() => ({ status: 401, body: { error: "this login expired - enter your password again", challengeExpired: true } }))
    page()
    const user = await enterPassword()
    await screen.findByLabelText("Authentication code")
    await user.keyboard("000000")
    expect(await screen.findByRole("alert")).toHaveTextContent("enter your password again")
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument()
  })

  it("a wrong code stays on the step and clears the field", async () => {
    twoFactorServer(() => ({ status: 401, body: { error: "invalid code" } }))
    page()
    const user = await enterPassword()
    const input = await screen.findByLabelText("Authentication code")
    await user.keyboard("000000")
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("That code didn't work. Check that your phone's clock is correct and try again."),
    )
    expect(input).toHaveValue("")
    expect(screen.getByRole("button", { name: "Verify" })).toBeInTheDocument()
  })

  it("shows rate limiting in minutes, from retryAfterSeconds or the Retry-After header", async () => {
    mockFetch((url) => {
      if (url.endsWith("/auth/status")) return { status: 200, body: LOGGED_OUT }
      return { status: 429, body: { error: "too many attempts, try again later", retryAfterSeconds: 840 } }
    })
    page()
    await enterPassword()
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Too many attempts — try again in 14 minutes"))

    cleanup()
    toastError.mockReset()
    mockFetch((url) => {
      if (url.endsWith("/auth/status")) return { status: 200, body: LOGGED_OUT }
      return { status: 429, body: {}, headers: { "Retry-After": "60" } }
    })
    page()
    await enterPassword()
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Too many attempts — try again in 1 minute"))
  })
})

describe("LoginPage with 2FA (desktop, bearer token)", () => {
  it("stores the token only after the second step", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true })
    setServerUrl("http://nas:50505")
    const fetchMock = mockFetch((url, init) => {
      if (url.endsWith("/auth/status")) return { status: 200, body: LOGGED_OUT }
      if (url.endsWith("/auth/login")) return { status: 200, body: CHALLENGE }
      if (url.endsWith("/auth/login/2fa")) {
        expect(init.headers["X-Client"]).toBe("desktop")
        return { status: 200, body: { token: "session-tok" } }
      }
      return { status: 404 }
    })
    page()
    const user = await enterPassword()
    const input = await screen.findByLabelText("Authentication code")
    expect(getToken()).toBeNull() // the password step alone gives nothing
    expect(input).toHaveFocus()
    await user.keyboard("654321")
    expect(await screen.findByText("home")).toBeInTheDocument()
    expect(getToken()).toBe("session-tok")
    expect(bodyOf(callsTo(fetchMock, "/auth/login/2fa")[0])).toEqual({ challengeToken: "chal-1", code: "654321" })
  })
})

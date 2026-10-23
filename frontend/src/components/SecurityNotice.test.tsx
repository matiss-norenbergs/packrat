import { cleanup, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SecurityNotice } from "@/components/SecurityNotice"
import { callsTo, mockFetch, renderWithProviders } from "@/test/mockApi"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("SecurityNotice", () => {
  it("reports failed attempts and acknowledges on dismiss", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.endsWith("/auth/security-notice/ack")) return { status: 204 }
      return { status: 200, body: { failedAttempts: 3, since: "2026-10-20T10:00:00Z", lastAttemptAt: "2026-10-22T08:30:00Z" } }
    })
    renderWithProviders(<SecurityNotice />)
    const notice = await screen.findByRole("status")
    expect(notice).toHaveTextContent("3 failed login attempts since your last login")
    expect(notice).toHaveTextContent("latest:")

    await userEvent.setup().click(screen.getByRole("button", { name: "Dismiss" }))
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument())
    await waitFor(() => expect(callsTo(fetchMock, "/auth/security-notice/ack")).toHaveLength(1))
  })

  it("uses the singular and shows nothing when there were no failures", async () => {
    mockFetch(() => ({ status: 200, body: { failedAttempts: 1, since: "2026-10-20T10:00:00Z", lastAttemptAt: "2026-10-22T08:30:00Z" } }))
    renderWithProviders(<SecurityNotice />)
    expect(await screen.findByRole("status")).toHaveTextContent("1 failed login attempt since")
    cleanup()

    mockFetch(() => ({ status: 200, body: { failedAttempts: 0, since: "2026-10-20T10:00:00Z", lastAttemptAt: null } }))
    const { container } = renderWithProviders(<SecurityNotice />)
    await new Promise((r) => setTimeout(r, 50))
    expect(container).toBeEmptyDOMElement()
  })
})

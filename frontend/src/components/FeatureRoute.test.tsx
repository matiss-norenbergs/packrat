import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { FeatureRoute } from "./FeatureRoute"
import type { Settings } from "@/types/api"

const useSettings = vi.fn()
vi.mock("@/hooks/useSettings", () => ({ useSettings: () => useSettings() }))

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={["/subscriptions"]}>
      <Routes>
        <Route element={<FeatureRoute feature="featureSubscriptionsEnabled" name="Subscriptions" />}>
          <Route path="/subscriptions" element={<div>the page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

const settingsWith = (on: boolean) => ({ data: { featureSubscriptionsEnabled: on } as Settings, isLoading: false })

describe("FeatureRoute", () => {
  afterEach(() => {
    cleanup()
    useSettings.mockReset()
  })

  it("renders the page while the feature is on", () => {
    useSettings.mockReturnValue(settingsWith(true))
    renderRoute()
    expect(screen.getByText("the page")).toBeInTheDocument()
  })

  it("shows the turned-off notice instead of the page when the feature is off", () => {
    useSettings.mockReturnValue(settingsWith(false))
    renderRoute()
    expect(screen.queryByText("the page")).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Settings → Features/ })).toHaveAttribute("href", "/settings?tab=features")
  })

  it("renders nothing while settings are loading, so a disabled page never mounts", () => {
    useSettings.mockReturnValue({ data: undefined, isLoading: true })
    renderRoute()
    expect(screen.queryByText("the page")).not.toBeInTheDocument()
  })

  it("renders the page if settings failed to load (features default to on)", () => {
    useSettings.mockReturnValue({ data: undefined, isLoading: false })
    renderRoute()
    expect(screen.getByText("the page")).toBeInTheDocument()
  })
})

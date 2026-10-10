import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DashboardSettingsPopover } from "./DashboardSettingsPopover"
import { DASHBOARD_WIDGETS } from "@/lib/dashboardWidgets"

async function openPopover() {
  await userEvent.click(screen.getByRole("button", { name: "Dashboard settings" }))
}

describe("DashboardSettingsPopover", () => {
  afterEach(cleanup)

  it("lists every widget, checked unless hidden", async () => {
    render(<DashboardSettingsPopover hiddenWidgets={["storage"]} onSave={() => {}} />)
    await openPopover()

    expect(screen.getAllByRole("switch")).toHaveLength(DASHBOARD_WIDGETS.length)
    expect(screen.getByRole("switch", { name: "Storage" })).not.toBeChecked()
    expect(screen.getByRole("switch", { name: "Top Tags" })).toBeChecked()
  })

  it("saves the toggled set of hidden widgets", async () => {
    const onSave = vi.fn()
    render(<DashboardSettingsPopover hiddenWidgets={["storage"]} onSave={onSave} />)
    await openPopover()

    await userEvent.click(screen.getByRole("switch", { name: "Top Tags" }))
    await userEvent.click(screen.getByRole("switch", { name: "Storage" }))
    await userEvent.click(screen.getByRole("button", { name: "Save" }))

    expect(onSave).toHaveBeenCalledWith(["topTags"])
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"
import { toast } from "sonner"
import { adjustmentLines, notifySettingsAdjusted } from "./backupAdjustments"

vi.mock("sonner", () => ({ toast: { info: vi.fn(), warning: vi.fn(), success: vi.fn(), error: vi.fn() } }))

beforeEach(() => vi.clearAllMocks())

describe("notifySettingsAdjusted", () => {
  it("shows nothing when nothing was adjusted, or for an older server", () => {
    notifySettingsAdjusted([])
    notifySettingsAdjusted(undefined)
    notifySettingsAdjusted(null)
    expect(toast.info).not.toHaveBeenCalled()
  })

  it("lists clamped values with their limits", () => {
    notifySettingsAdjusted([
      { key: "max_concurrent_downloads", action: "clamped", from: 5000, to: 16 },
      { key: "thumbnail_frame_count", action: "clamped", from: 500, to: 100 },
    ])
    expect(toast.info).toHaveBeenCalledWith("2 values were adjusted to their limits", {
      description: "max_concurrent_downloads 5000 → 16; thumbnail_frame_count 500 → 100",
      duration: 20000,
    })
  })

  it("uses the singular and does not claim limits for skipped values", () => {
    notifySettingsAdjusted([{ key: "default_quality", action: "skipped" }])
    expect(toast.info).toHaveBeenCalledWith("1 value was adjusted", expect.objectContaining({ description: "default_quality skipped" }))
  })

  it("formats mixed actions", () => {
    expect(
      adjustmentLines([
        { key: "a", action: "clamped", from: 1, to: 0 },
        { key: "b", action: "dropped" },
      ]),
    ).toEqual(["a 1 → 0", "b dropped"])
  })
})

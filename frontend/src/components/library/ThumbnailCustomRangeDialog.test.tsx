import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MAX_CUSTOM_FRAME_COUNT, ThumbnailCustomRangeDialog } from "@/components/library/ThumbnailCustomRangeDialog"

vi.mock("@/hooks/useSettings", () => ({ useSettings: () => ({ data: { thumbnailFrameCount: 4, thumbnailFrameRangeLow: 5, thumbnailFrameRangeHigh: 100 } }) }))
vi.mock("@/components/ThumbnailFrameRangeSlider", () => ({ ThumbnailFrameRangeSlider: () => <div /> }))

afterEach(cleanup)

async function typeCount(value: string) {
  const onConfirm = vi.fn()
  render(<ThumbnailCustomRangeDialog open onOpenChange={() => {}} onConfirm={onConfirm} durationSeconds={60} />)
  const input = screen.getByLabelText("Frame count")
  await userEvent.clear(input)
  await userEvent.type(input, value)
  return { onConfirm, button: screen.getByRole("button", { name: /Extract frames/ }) }
}

describe("ThumbnailCustomRangeDialog frame count limit", () => {
  it("is 100 (the server's candidate-frame limit)", () => {
    expect(MAX_CUSTOM_FRAME_COUNT).toBe(100)
  })

  it("accepts the limit and refuses one above it", async () => {
    const ok = await typeCount(String(MAX_CUSTOM_FRAME_COUNT))
    expect(ok.button).toBeEnabled()
    await userEvent.click(ok.button)
    expect(ok.onConfirm).toHaveBeenCalledWith({ count: 100, low: 5, high: 100 })
    cleanup()

    const bad = await typeCount(String(MAX_CUSTOM_FRAME_COUNT + 1))
    expect(bad.button).toBeDisabled()
    expect(screen.getByText("1–100 frames")).toHaveClass("text-destructive")
  })
})

import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TrimFramePickerDialog } from "@/components/library/TrimFramePickerDialog"
import type { LibraryItem, TrimFramesResponse } from "@/types/api"

const state = vi.hoisted(() => ({ data: undefined as unknown, mutate: vi.fn() }))
vi.mock("@/hooks/useLibrary", () => ({
  useLibraryItemTrimFrames: () => ({
    mutate: state.mutate,
    isPending: false,
    isIdle: false,
    isError: false,
    data: state.data,
  }),
}))

const frame = (t: number) => ({ timestampSeconds: t, imageBase64: "AAAA" })

function renderDialog(data: TrimFramesResponse) {
  state.data = data
  const onPick = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <TrimFramePickerDialog
      item={{ id: 7 } as LibraryItem}
      open
      onOpenChange={onOpenChange}
      windowStart={1}
      windowEnd={2}
      onPick={onPick}
    />,
  )
  return { onPick, onOpenChange }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("TrimFramePickerDialog", () => {
  it("shows the truncation note only when truncated", () => {
    renderDialog({ frames: [frame(1), frame(1.1)], truncated: true, totalFrames: 1200 })
    expect(screen.getByText("Showing the first 2 of 1200 frames")).toBeTruthy()
    cleanup()
    renderDialog({ frames: [frame(1), frame(1.1)], truncated: false, totalFrames: 2 })
    expect(screen.queryByText(/Showing the first/)).toBeNull()
  })

  it("renders frames and picks one by timestamp", async () => {
    const { onPick, onOpenChange } = renderDialog({ frames: [frame(1), frame(1.5)], truncated: false, totalFrames: 2 })
    expect(screen.getAllByRole("img")).toHaveLength(2)
    await userEvent.click(screen.getAllByRole("button", { name: /Frame at/ })[1])
    expect(onPick).toHaveBeenCalledWith(1.5)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

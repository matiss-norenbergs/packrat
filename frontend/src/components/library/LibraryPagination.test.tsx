import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LibraryPagination } from "./LibraryPagination"

afterEach(cleanup)

describe("LibraryPagination", () => {
  it("shows the item count on the left and the numbered pager", () => {
    render(<LibraryPagination page={2} pageSize={24} total={60} onPageChange={() => {}} />)
    expect(screen.getByText("60 items")).toBeInTheDocument()
    expect(screen.queryByText(/page \d+ of/i)).not.toBeInTheDocument()
    for (const n of ["1", "2", "3"]) expect(screen.getByRole("button", { name: n })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "2" })).toHaveAttribute("aria-current", "page")
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled()
  })

  it("shows no selection text", () => {
    render(<LibraryPagination page={1} pageSize={24} total={60} onPageChange={() => {}} />)
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument()
  })

  it("is still shown for a single page, with the pager disabled", () => {
    render(<LibraryPagination page={1} pageSize={24} total={12} onPageChange={() => {}} />)
    expect(screen.getByText("12 items")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()
  })

  it("uses the singular for one item", () => {
    render(<LibraryPagination page={1} pageSize={24} total={1} onPageChange={() => {}} />)
    expect(screen.getByText("1 item")).toBeInTheDocument()
  })

  it("calls onPageChange for a page number, Previous and Next", async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    render(<LibraryPagination page={2} pageSize={24} total={72} onPageChange={onPageChange} />)
    await user.click(screen.getByRole("button", { name: "3" }))
    expect(onPageChange).toHaveBeenLastCalledWith(3)
    await user.click(screen.getByRole("button", { name: "Previous" }))
    expect(onPageChange).toHaveBeenLastCalledWith(1)
    await user.click(screen.getByRole("button", { name: "Next" }))
    expect(onPageChange).toHaveBeenLastCalledWith(3)
  })

  it("snaps back to the last page when the total shrinks under the current page", () => {
    const onPageChange = vi.fn()
    const { rerender } = render(<LibraryPagination page={3} pageSize={24} total={60} onPageChange={onPageChange} />)
    expect(onPageChange).not.toHaveBeenCalled()
    rerender(<LibraryPagination page={3} pageSize={24} total={30} onPageChange={onPageChange} />)
    expect(onPageChange).toHaveBeenCalledTimes(1)
    expect(onPageChange).toHaveBeenCalledWith(2)
  })
})

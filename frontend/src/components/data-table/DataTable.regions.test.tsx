import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DataTable } from "./DataTable"
import type { DataTableProps } from "./DataTable"

afterEach(cleanup)

interface Row {
  id: number
  name: string
}
const ROWS: Row[] = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `Item ${i + 1}` }))
const COLUMNS = [{ key: "n", header: "Name", cell: (r: Row) => r.name }]
const LABEL = { singular: "item", plural: "items" }

function setup(props: Partial<DataTableProps<Row, number>> = {}) {
  return render(<DataTable rows={ROWS} getRowId={(r) => r.id} columns={COLUMNS} {...props} />)
}
const region = (container: HTMLElement) => container.querySelector("[data-slot=table-container]")?.parentElement ?? null

describe("regionClassName", () => {
  it("keeps the default region classes when omitted", () => {
    const { container } = setup()
    expect(region(container)).toHaveClass("min-h-0", "flex-1")
    expect(region(container)?.className).toBe("min-h-0 flex-1")
  })

  it("merges onto the region around the table, the loading state and the empty state", () => {
    const cls = "h-[60vh] overflow-hidden rounded-md border"
    const { container, rerender } = setup({ regionClassName: cls })
    expect(region(container)).toHaveClass("min-h-0", "flex-1", "h-[60vh]", "rounded-md", "border")

    rerender(<DataTable rows={[]} getRowId={(r: Row) => r.id} columns={COLUMNS} regionClassName={cls} empty={<p>Nothing</p>} />)
    expect(screen.getByText("Nothing").parentElement).toHaveClass("min-h-0", "flex-1", "h-[60vh]")

    rerender(<DataTable rows={[]} getRowId={(r: Row) => r.id} columns={COLUMNS} regionClassName={cls} loading />)
    expect(container.querySelector(".h-\\[60vh\\]")).not.toBeNull()
  })

  it("lets a later class win over a default one", () => {
    const { container } = setup({ regionClassName: "min-h-[10rem]" })
    expect(region(container)).toHaveClass("min-h-[10rem]")
    expect(region(container)).not.toHaveClass("min-h-0")
  })
})

describe("loadingContent", () => {
  it("replaces the default skeleton bars while loading", () => {
    const { container } = setup({ loading: true, loadingContent: <div data-testid="custom">loading…</div> })
    expect(screen.getByTestId("custom")).toBeInTheDocument()
    expect(container.querySelectorAll("[data-slot=skeleton]")).toHaveLength(0)
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("is ignored when not loading and the default bars are unchanged", () => {
    const { container, rerender } = setup({ loadingContent: <div data-testid="custom" /> })
    expect(screen.queryByTestId("custom")).toBeNull()
    expect(screen.getByRole("table")).toBeInTheDocument()

    rerender(<DataTable rows={ROWS} getRowId={(r: Row) => r.id} columns={COLUMNS} loading loadingRows={3} />)
    expect(container.querySelectorAll("[data-slot=skeleton]")).toHaveLength(3)
  })
})

describe("hideSinglePageFooter", () => {
  const pager = (page: number, total: number, onPageChange = vi.fn()) => ({
    page,
    pageSize: 5,
    total,
    onPageChange,
    itemLabel: LABEL,
  })

  it("still shows the footer by default, even for one page", () => {
    setup({ pageSize: 10, itemLabel: LABEL })
    expect(screen.getByText("5 items")).toBeInTheDocument()
  })

  it("client mode: hidden for one page, shown with the count and pager for several", () => {
    const { rerender } = setup({ pageSize: 10, itemLabel: LABEL, hideSinglePageFooter: true })
    expect(screen.queryByText("5 items")).toBeNull()
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull()

    const many = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: `Item ${i + 1}` }))
    rerender(<DataTable rows={many} getRowId={(r: Row) => r.id} columns={COLUMNS} pageSize={10} itemLabel={LABEL} hideSinglePageFooter />)
    expect(screen.getByText("12 items")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("12 items")).toBeInTheDocument()
  })

  it("controlled mode: hidden for one page, shown for several", () => {
    const { rerender } = setup({ pagination: pager(1, 5), hideSinglePageFooter: true })
    expect(screen.queryByText("5 items")).toBeNull()

    rerender(<DataTable rows={ROWS} getRowId={(r: Row) => r.id} columns={COLUMNS} pagination={pager(1, 6)} hideSinglePageFooter />)
    expect(screen.getByText("6 items")).toBeInTheDocument()
  })

  it("keeps the footer for a page past the end so it can snap back, then hides it", () => {
    const onPageChange = vi.fn()
    setup({ pagination: pager(2, 5, onPageChange), hideSinglePageFooter: true })
    expect(screen.getByText("5 items")).toBeInTheDocument()
    expect(onPageChange).toHaveBeenCalledWith(1)
  })
})

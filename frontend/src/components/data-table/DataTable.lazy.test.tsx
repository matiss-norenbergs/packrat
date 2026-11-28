import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { installLayoutMock } from "@/test/layoutMock"
import type { LayoutMock } from "@/test/layoutMock"
import { DataTable } from "./DataTable"

// The windowed body is its own module, imported on demand. The factory runs the first time something imports it, so
// `loaded` says whether any table asked for it.
const loaded = vi.hoisted(() => ({ count: 0 }))
vi.mock("./WindowedTableBody", async (importOriginal) => {
  loaded.count++
  return importOriginal()
})

let layout: LayoutMock
beforeEach(() => {
  layout = installLayoutMock({ viewportWidth: 1280, viewportHeight: 600, rowHeight: () => 50 })
})
afterEach(() => {
  layout.restore()
})

interface Row {
  id: number
}
const rows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: i + 1 }))
const columns = [{ key: "id", header: "Id", cell: (r: Row) => `row ${r.id}` }]
const table = (n: number, virtualize?: boolean) => <DataTable rows={rows(n)} getRowId={(r) => r.id} columns={columns} virtualize={virtualize} />
const trs = () => document.querySelectorAll("tbody tr[data-row-id]").length
const spacers = () => document.querySelectorAll("tbody tr[data-windowed-spacer]").length

// One file, in this order: the module is requested once for the whole file, and what it proves is the first state.
describe("the windowed body loads on demand", () => {
  it("is not requested by a plain table, one that is below the threshold, or one that does not opt in", () => {
    render(table(10, true))
    cleanup()
    render(table(1000, false))
    cleanup()
    render(table(1000))
    expect(trs()).toBe(1000)
    expect(loaded.count).toBe(0)
  })

  it("is requested when a table windows, which shows the first rows (never all of them) until it has loaded", async () => {
    render(table(1000, true))
    // the fallback: a first window, no spacers, no library
    expect(spacers()).toBe(0)
    expect(trs()).toBeGreaterThan(0)
    expect(trs()).toBeLessThan(100)
    expect(screen.getByRole("table")).toHaveAttribute("aria-rowcount", "1001")
    await waitFor(() => expect(spacers()).toBe(2))
    expect(loaded.count).toBe(1)
    expect(trs()).toBeLessThan(100)
  })
})

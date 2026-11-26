import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DataTable } from "@/components/data-table"
import { TooltipProvider } from "@/components/ui/tooltip"
import { resetFocusReturn } from "@/lib/focusReturn"
import { mockFetch } from "@/test/mockApi"
import type { LibraryItem } from "@/types/api"
import { LibraryItemActionsMenu } from "./LibraryItemActionsMenu"
import { LibraryItemActionsProvider } from "./LibraryItemActionsProvider"
import { toContextMenuItems, useLibraryItemActions } from "./libraryItemActions"

beforeEach(() => {
  resetFocusReturn()
  mockFetch((url) => {
    if (url.endsWith("/settings")) return { status: 200, body: {} }
    return { status: 200, body: [] }
  })
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const mk = (id: number): LibraryItem =>
  ({ id, title: `Title ${id}`, filename: `a${id}.mp4`, path: `m/a${id}.mp4`, mediaType: "video", status: "completed", originalUrl: "https://x/y", thumbnail: "t.jpg", tags: [], activeDownloadId: null }) as unknown as LibraryItem

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>
      <TooltipProvider>{ui}</TooltipProvider>
    </MemoryRouter>
  </QueryClientProvider>
)

function Grid({ items }: { items: LibraryItem[] }) {
  return (
    <div data-testid="grid" data-focus-region>
      <LibraryItemActionsProvider items={items}>
        {items.map((i) => (
          <div key={i.id} data-testid={`card-${i.id}`}>
            <LibraryItemActionsMenu item={i} />
          </div>
        ))}
      </LibraryItemActionsProvider>
    </div>
  )
}

const actionsButton = (id: number) => screen.getByTestId(`card-${id}`).querySelector("button[aria-label=Actions]") as HTMLElement

async function chooseAction(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement, name: RegExp | string) {
  await user.click(trigger)
  await user.click(await screen.findByRole("menuitem", { name }))
}

describe("focus returns after a dialog opened from a menu", () => {
  it("⋮ -> Edit -> Escape returns to that card's ⋮ button (shared host)", async () => {
    const user = userEvent.setup()
    render(wrap(<Grid items={[mk(1), mk(2)]} />))
    await chooseAction(user, actionsButton(2), "Edit")
    await screen.findByRole("dialog")
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(actionsButton(2)).toHaveFocus())
    expect(document.activeElement).not.toBe(document.body)
  })

  it("the same with a menu that owns its host (the item page)", async () => {
    const user = userEvent.setup()
    render(wrap(<LibraryItemActionsMenu item={mk(1)} />))
    await chooseAction(user, screen.getByRole("button", { name: "Actions" }), "Edit")
    await screen.findByRole("dialog")
    await user.click(screen.getByRole("button", { name: "Close" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Actions" })).toHaveFocus())
  })

  it("an alert dialog (Delete) returns on Cancel as well", async () => {
    const user = userEvent.setup()
    render(wrap(<Grid items={[mk(1)]} />))
    await chooseAction(user, actionsButton(1), "Delete")
    await user.click(await screen.findByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(actionsButton(1)).toHaveFocus())
  })

  it("an item that disappeared sends focus to the region, never body", async () => {
    const user = userEvent.setup()
    const { rerender } = render(wrap(<Grid items={[mk(1), mk(2)]} />))
    await chooseAction(user, actionsButton(1), "Edit")
    await screen.findByRole("dialog")
    rerender(wrap(<Grid items={[mk(2)]} />)) // the item left the page while its dialog was open
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(screen.getByTestId("grid")).toHaveFocus())
  })

  it("a trigger that cannot take focus (hidden during a selection) falls back to the region", async () => {
    const user = userEvent.setup()
    render(wrap(<Grid items={[mk(1)]} />))
    const trigger = actionsButton(1)
    await chooseAction(user, trigger, "Edit")
    await screen.findByRole("dialog")
    trigger.setAttribute("disabled", "") // stands in for display:none, which cannot be focused either
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.getByTestId("grid")).toHaveFocus())
  })

  it("a dialog not opened from a menu is left alone", async () => {
    const user = userEvent.setup()
    render(wrap(<Grid items={[mk(1)]} />))
    await chooseAction(user, actionsButton(1), "Copy URL")
    expect(actionsButton(1)).toBeInTheDocument()
    // Copy URL opens no dialog: the pending origin must not leak into a later, unrelated one.
    await new Promise((r) => setTimeout(r, 1600))
    await chooseAction(user, actionsButton(1), "Edit")
    await screen.findByRole("dialog")
    await user.keyboard("{Escape}")
    await waitFor(() => expect(actionsButton(1)).toHaveFocus())
  })
})

describe("DataTable context menu", () => {
  function Table({ rows }: { rows: LibraryItem[] }) {
    const { actionsFor, host } = useLibraryItemActions(undefined, rows)
    return (
      <>
        <DataTable
          rows={rows}
          getRowId={(r) => r.id}
          selection="multi"
          columns={[{ key: "t", header: "Title", cell: (r: LibraryItem) => r.title }]}
          contextMenu={(sel) => toContextMenuItems<LibraryItem>(actionsFor(sel[0]))}
        />
        {host}
      </>
    )
  }

  it("right-click -> Edit -> Escape returns to that row", async () => {
    const user = userEvent.setup()
    render(wrap(<Table rows={[mk(1), mk(2)]} />))
    const row = screen.getByText("Title 2").closest("tr")!
    fireEvent.contextMenu(row, { button: 2 })
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }))
    await screen.findByRole("dialog")
    await user.keyboard("{Escape}")
    await waitFor(() => expect(row).toHaveFocus())
  })

  it("a keyboard-opened menu returns to the focused element in the row", async () => {
    const user = userEvent.setup()
    render(wrap(<Table rows={[mk(1)]} />))
    const box = screen.getAllByRole("checkbox")[1]
    box.focus()
    fireEvent.contextMenu(box, { button: 0 })
    await user.click(await screen.findByRole("menuitem", { name: "Edit" }))
    await screen.findByRole("dialog")
    await user.keyboard("{Escape}")
    await waitFor(() => expect(box).toHaveFocus())
  })
})

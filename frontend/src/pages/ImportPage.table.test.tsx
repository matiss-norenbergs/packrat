import type { ComponentProps } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { tableLayoutsQueryKey } from "@/hooks/useTableLayout"
import { ImportPage } from "@/pages/ImportPage"
import type { ScannedFile, TableLayouts } from "@/types/api"

// Render counters: the scan hook is called once per render of the page, formatBytes once per render of a row's Size
// cell, and the Input wrapper once per render of an input (keyed by its aria-label).
const counters = vi.hoisted(() => ({ page: 0, bytes: 0, inputs: {} as Record<string, number> }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock("sonner", () => ({ toast: toasts, Toaster: () => null }))
vi.mock("@/hooks/useImport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useImport")>()
  return {
    ...actual,
    useImportScan: () => {
      counters.page++
      return actual.useImportScan()
    },
  }
})
vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>()
  return {
    ...actual,
    formatBytes: (n: number) => {
      counters.bytes++
      return actual.formatBytes(n)
    },
  }
})
vi.mock("@/components/ui/input", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/input")>()
  return {
    ...actual,
    Input: (props: ComponentProps<typeof actual.Input>) => {
      const label = props["aria-label"]
      if (label) counters.inputs[label] = (counters.inputs[label] ?? 0) + 1
      return <actual.Input {...props} />
    },
  }
})

beforeEach(() => {
  counters.page = 0
  counters.bytes = 0
  counters.inputs = {}
  toasts.success.mockReset()
  toasts.error.mockReset()
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const file = (n: number, over: Partial<ScannedFile> = {}): ScannedFile => ({
  path: `clip-${String(n).padStart(3, "0")}.mp4`,
  filename: `clip-${String(n).padStart(3, "0")}.mp4`,
  sizeBytes: 1_000_000 + n,
  durationSeconds: 60 + n,
  resolution: "1920x1080",
  collectionPath: "",
  newCollectionPath: "",
  ...over,
})
const many = (n: number) => Array.from({ length: n }, (_, i) => file(i + 1))

interface Server {
  fetch: ReturnType<typeof vi.fn>
  posts: { path: string; originalUrl?: string }[]
  patches: unknown[]
  scans: () => number
  /** Hold the next scan (a rescan) until `releaseScan()`. */
  holdScans: () => void
  releaseScan: () => void
  /** Hold every import POST until `releasePosts()`. */
  holdPosts: () => void
  releasePosts: () => void
  failPaths: Set<string>
}

function serve(files: ScannedFile[], opts: { scanStatus?: number } = {}): Server {
  const posts: Server["posts"] = []
  const patches: unknown[] = []
  let scans = 0
  let scanGate: Promise<void> | null = null
  let scanRelease = () => {}
  let postGate: Promise<void> | null = null
  let postRelease = () => {}
  const failPaths = new Set<string>()
  const res = (status: number, body?: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: () => null },
    json: async () => body ?? {},
  })
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET"
    if (url.endsWith("/import/scan")) {
      scans++
      if (scanGate) await scanGate
      return opts.scanStatus ? res(opts.scanStatus, { error: "scan exploded" }) : res(200, files)
    }
    if (url.endsWith("/import") && method === "POST") {
      const body = JSON.parse(init.body as string)
      posts.push(body)
      if (postGate) await postGate
      return failPaths.has(body.path) ? res(500, { error: "disk full" }) : res(200, { id: 1 })
    }
    if (url.endsWith("/settings")) {
      if (method === "PATCH") patches.push(JSON.parse(init.body as string))
      return res(200, { importIgnoredFolders: [] })
    }
    return res(404)
  })
  vi.stubGlobal("fetch", fn)
  return {
    fetch: fn,
    posts,
    patches,
    scans: () => scans,
    holdScans: () => {
      scanGate = new Promise<void>((r) => (scanRelease = r))
    },
    releaseScan: () => {
      scanGate = null
      scanRelease()
    },
    holdPosts: () => {
      postGate = new Promise<void>((r) => (postRelease = r))
    },
    releasePosts: () => {
      postGate = null
      postRelease()
    },
    failPaths,
  }
}

function renderPage(layouts: TableLayouts = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  client.setQueryData(tableLayoutsQueryKey, layouts)
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ImportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const row = (filename: string) => screen.getByText(filename).closest("tr")!
const press = (filename: string, init?: object) => {
  fireEvent.mouseDown(row(filename), init)
  fireEvent.mouseUp(window)
}
const isSelected = (filename: string) => row(filename).getAttribute("data-state") === "selected"
const names = () =>
  screen.getAllByRole("row").slice(1).map((tr) => tr.querySelector("td[data-col=name] p")!.textContent)
const toolbarButton = (name: string) => screen.getByRole("button", { name })
const rowButton = (filename: string) => within(row(filename)).getByRole("button", { name: /^(Import|Importing…|Imported)$/ })
const urlBox = (filename: string) => screen.getByLabelText(`Original URL for ${filename}`) as HTMLInputElement
const sortBy = (header: string) => fireEvent.click(screen.getByRole("button", { name: header }))
const sleep = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)))

describe("ImportPage table", () => {
  it("renders the columns with the right alignment, fixed widths and the Layout button", async () => {
    serve([file(1, { sizeBytes: 7_700_000, durationSeconds: 42, resolution: "1920x1080" })])
    renderPage()
    await screen.findByText("clip-001.mp4")
    const headers = screen.getAllByRole("columnheader")
    expect(headers.map((h) => h.textContent)).toEqual(["", "Name", "Size", "Duration", "Resolution", "Import"])
    expect(headers[1].className).not.toMatch(/text-(right|center)/)
    for (const h of headers.slice(2)) expect(h).toHaveClass("text-right")
    expect(screen.getByRole("table")).toHaveClass("table-fixed")
    expect(screen.getByRole("button", { name: /Table layout/i })).toBeInTheDocument()

    const cells = row("clip-001.mp4").querySelectorAll("td")
    expect(cells[2]).toHaveTextContent("7.3 MB")
    expect(cells[3]).toHaveTextContent("0:42")
    expect(cells[4]).toHaveTextContent("1920x1080")
    for (const i of [2, 3, 4]) expect(cells[i]).toHaveClass("text-right", "text-muted-foreground")
    expect(cells[5]).toHaveClass("text-right")

    // Size, Duration and Resolution are resizable; Name (flex) and Import are not.
    expect(screen.getByRole("separator", { name: "Resize Size column" })).toBeInTheDocument()
    expect(screen.getByRole("separator", { name: "Resize Duration column" })).toBeInTheDocument()
    expect(screen.getByRole("separator", { name: "Resize Resolution column" })).toBeInTheDocument()
    expect(screen.queryByRole("separator", { name: /Resize Name column/ })).toBeNull()
    expect(screen.queryByRole("separator", { name: /Resize Import column/ })).toBeNull()
    // The Import header is a plain label, not a sort button.
    expect(within(headers[5]).queryByRole("button")).toBeNull()
  })

  it("the Import column keeps the button at its natural width in every state; the input gives way", async () => {
    const server = serve(many(3))
    server.holdPosts()
    renderPage()
    await screen.findByText("clip-001.mp4")
    const col = Array.from(document.querySelectorAll("colgroup col")).at(-1) as HTMLElement
    expect(col.style.width).toBe("360px")
    const check = (name: string) => {
      expect(rowButton(name)).toHaveClass("min-w-28", "shrink-0", "justify-center", "whitespace-nowrap") // one fixed width in every state
      expect(urlBox(name)).toHaveClass("w-44", "min-w-0")
    }
    check("clip-001.mp4") // Import
    fireEvent.click(rowButton("clip-002.mp4"))
    check("clip-002.mp4") // Importing…
    expect(rowButton("clip-002.mp4")).toHaveTextContent("Importing…")
    server.releasePosts()
    await waitFor(() => expect(rowButton("clip-002.mp4")).toHaveTextContent("Imported"))
    check("clip-002.mp4") // Imported
  })

  it("shows the em dash for a missing duration and resolution", async () => {
    serve([file(1, { durationSeconds: null, resolution: null })])
    renderPage()
    await screen.findByText("clip-001.mp4")
    const cells = row("clip-001.mp4").querySelectorAll("td")
    expect(cells[3]).toHaveTextContent("—")
    expect(cells[4]).toHaveTextContent("—")
  })

  it("shows the folder line with the new-collection hint and the ignore button only for files in a folder", async () => {
    serve([
      file(1),
      file(2, { path: "Shows/b.mp4", filename: "b.mp4", collectionPath: "Shows" }),
      file(3, { path: "Shows/New/c.mp4", filename: "c.mp4", collectionPath: "Shows", newCollectionPath: "Shows/New" }),
    ])
    renderPage()
    await screen.findByText("b.mp4")
    expect(within(row("clip-001.mp4")).getByText("(media root)")).toBeInTheDocument()
    expect(row("clip-001.mp4").querySelectorAll("td")[1].querySelector("button")).toBeNull()
    expect(row("b.mp4").querySelectorAll("td")[1].querySelector("button")).not.toBeNull()
    expect(within(row("c.mp4")).getByText("Shows — new: Shows/New")).toBeInTheDocument()
  })

  describe("tooltips on the Name cell", () => {
    // jsdom has no layout: pretend the filename is cut off.
    const cutOff = (el: Element) => {
      Object.defineProperty(el, "scrollWidth", { value: 300, configurable: true })
      Object.defineProperty(el, "clientWidth", { value: 100, configurable: true })
    }

    it("shows the file name and folder over the text, and nothing over the ignore button", async () => {
      serve([file(1, { path: "Shows/a-long-name.mp4", filename: "a-long-name.mp4", collectionPath: "Shows" })])
      renderPage()
      await screen.findByText("a-long-name.mp4")
      const name = screen.getByText("a-long-name.mp4")
      cutOff(name)
      fireEvent.pointerOver(name)
      await sleep(300)
      expect(screen.getByRole("tooltip").textContent).toBe("a-long-name.mp4\nShows")
      fireEvent.pointerOver(row("a-long-name.mp4").querySelector("td[data-col=name] button")!)
      expect(screen.queryByRole("tooltip")).toBeNull()
      await sleep(300)
      expect(screen.queryByRole("tooltip")).toBeNull()
    })

    it("has no tooltip on the Import column", async () => {
      serve([file(1)])
      renderPage()
      await screen.findByText("clip-001.mp4")
      const cell = row("clip-001.mp4").querySelector("td[data-col=import]")!
      cutOff(cell)
      fireEvent.pointerOver(cell)
      await sleep(300)
      expect(screen.queryByRole("tooltip")).toBeNull()
    })
  })

  it("searches the file name and the path with a debounce, and the clear button resets it", async () => {
    serve([file(1, { path: "Shows/x.mp4", filename: "x.mp4", collectionPath: "Shows" }), file(2, { path: "Raw/y.mp4", filename: "y.mp4", collectionPath: "Raw" }), file(3)])
    renderPage()
    await screen.findByText("x.mp4")
    const box = screen.getByPlaceholderText("Search files…")

    fireEvent.change(box, { target: { value: "  X.MP4 " } })
    expect(screen.getByText("y.mp4")).toBeInTheDocument() // debounced: nothing is filtered right away
    await waitFor(() => expect(screen.queryByText("y.mp4")).toBeNull())
    expect(screen.getByText("1 file")).toBeInTheDocument()

    fireEvent.change(box, { target: { value: "raw/" } }) // the path, not the filename
    await waitFor(() => expect(screen.getByText("y.mp4")).toBeInTheDocument())
    expect(screen.queryByText("x.mp4")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }))
    expect(screen.getByText("3 files")).toBeInTheDocument()
    expect(box).toHaveValue("")
  })

  it("shows the empty message, the no-match message and the error, with the footer", async () => {
    serve([])
    renderPage()
    expect(await screen.findByText("Nothing new found. Rescan after placing files under your media root.")).toBeInTheDocument()
    expect(screen.getByText("0 files")).toBeInTheDocument()
    cleanup()

    serve([file(1)])
    renderPage()
    await screen.findByText("clip-001.mp4")
    fireEvent.change(screen.getByPlaceholderText("Search files…"), { target: { value: "zzz" } })
    expect(await screen.findByText("No files match your search.")).toBeInTheDocument()
    expect(screen.getByText("0 files")).toBeInTheDocument()
    expect(screen.queryByRole("table")).toBeNull()
    cleanup()

    serve([], { scanStatus: 500 })
    renderPage()
    expect(await screen.findByText("Failed to scan: scan exploded")).toBeInTheDocument()
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("shows the skeleton on the first load only, and the toolbar all along", async () => {
    const server = serve(many(2))
    server.holdScans()
    renderPage()
    expect(document.querySelectorAll("[data-slot=skeleton]").length).toBeGreaterThan(0)
    expect(toolbarButton("Import Selected")).toBeDisabled()
    expect(toolbarButton("Ignored Folders")).toBeInTheDocument()
    server.releaseScan()
    await screen.findByText("clip-001.mp4")
  })

  it("pages at 50 rows and clears the selection on a page change", async () => {
    serve(many(120))
    renderPage()
    await screen.findByText("clip-001.mp4")
    expect(screen.getAllByRole("row")).toHaveLength(51)
    press("clip-002.mp4")
    expect(screen.getByText("120 files · 1 selected")).toBeInTheDocument()
    expect(toolbarButton("Import Selected")).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: "2" }))
    expect(screen.getByText("clip-051.mp4")).toBeInTheDocument()
    expect(screen.getByText("120 files")).toBeInTheDocument()
    expect(toolbarButton("Import Selected")).toBeDisabled()
  })

  it("search resets to page 1 and clears the selection", async () => {
    serve(many(120))
    renderPage()
    await screen.findByText("clip-001.mp4")
    fireEvent.click(screen.getByRole("button", { name: "3" }))
    press("clip-101.mp4")
    expect(isSelected("clip-101.mp4")).toBe(true)
    fireEvent.change(screen.getByPlaceholderText("Search files…"), { target: { value: "clip-0" } })
    await waitFor(() => expect(screen.getByText("99 files")).toBeInTheDocument())
    expect(screen.getByText("clip-001.mp4")).toBeInTheDocument()
    expect(toolbarButton("Import Selected")).toBeDisabled()
  })

  describe("sorting", () => {
    const sortable = [
      file(1, { path: "zeta/a.mp4", filename: "a.mp4", sizeBytes: 300, durationSeconds: 60, resolution: "1280x720" }),
      file(2, { path: "alpha/b.mp4", filename: "b.mp4", sizeBytes: 100, durationSeconds: null, resolution: "1920x1080" }),
      file(3, { path: "c.mp4", filename: "c.mp4", sizeBytes: 200, durationSeconds: 30, resolution: null }),
      file(4, { path: "d.mp4", filename: "d.mp4", sizeBytes: 400, durationSeconds: 90, resolution: "640x360" }),
      file(5, { path: "e.mp4", filename: "e.mp4", sizeBytes: 500, durationSeconds: null, resolution: "garbage" }),
    ]

    it("keeps the scan order until a header is clicked", async () => {
      serve(sortable)
      renderPage()
      await screen.findByText("a.mp4")
      expect(names()).toEqual(["a.mp4", "b.mp4", "c.mp4", "d.mp4", "e.mp4"])
    })

    it("sorts by name (the file name, not the path)", async () => {
      serve(sortable)
      renderPage()
      await screen.findByText("a.mp4")
      sortBy("Name")
      expect(names()).toEqual(["a.mp4", "b.mp4", "c.mp4", "d.mp4", "e.mp4"])
      sortBy("Name")
      expect(names()).toEqual(["e.mp4", "d.mp4", "c.mp4", "b.mp4", "a.mp4"])
      sortBy("Name") // back to the scan order
      expect(names()).toEqual(["a.mp4", "b.mp4", "c.mp4", "d.mp4", "e.mp4"])
    })

    it("sorts by size", async () => {
      serve(sortable)
      renderPage()
      await screen.findByText("a.mp4")
      sortBy("Size")
      expect(names()).toEqual(["b.mp4", "c.mp4", "a.mp4", "d.mp4", "e.mp4"])
      sortBy("Size")
      expect(names()).toEqual(["e.mp4", "d.mp4", "a.mp4", "c.mp4", "b.mp4"])
    })

    it("sorts by duration with the missing ones last in both directions", async () => {
      serve(sortable)
      renderPage()
      await screen.findByText("a.mp4")
      sortBy("Duration")
      expect(names()).toEqual(["c.mp4", "a.mp4", "d.mp4", "b.mp4", "e.mp4"])
      sortBy("Duration")
      expect(names()).toEqual(["d.mp4", "a.mp4", "c.mp4", "b.mp4", "e.mp4"])
    })

    it("sorts by resolution on the pixel count; a missing or unparsable one comes last in both directions", async () => {
      serve(sortable)
      renderPage()
      await screen.findByText("a.mp4")
      sortBy("Resolution")
      expect(names()).toEqual(["d.mp4", "a.mp4", "b.mp4", "c.mp4", "e.mp4"])
      sortBy("Resolution")
      expect(names()).toEqual(["b.mp4", "a.mp4", "d.mp4", "c.mp4", "e.mp4"])
    })

    it("goes back to page 1 and clears the selection when the sort changes", async () => {
      serve(many(120))
      renderPage()
      await screen.findByText("clip-001.mp4")
      fireEvent.click(screen.getByRole("button", { name: "2" }))
      press("clip-051.mp4")
      sortBy("Size")
      expect(screen.getByText("clip-001.mp4")).toBeInTheDocument()
      expect(screen.getByText("120 files")).toBeInTheDocument()
    })
  })

  describe("a saved layout", () => {
    it("applies its sort and widths", async () => {
      serve([file(1, { sizeBytes: 100 }), file(2, { sizeBytes: 300 }), file(3, { sizeBytes: 200 })])
      renderPage({ import: { v: 1, sort: { key: "size", dir: "desc" }, widths: { size: 160 } } })
      await screen.findByText("clip-001.mp4")
      expect(names()).toEqual(["clip-002.mp4", "clip-003.mp4", "clip-001.mp4"])
      expect(screen.getByRole("columnheader", { name: "Size" })).toHaveAttribute("aria-sort", "descending")
      const widths = Array.from(document.querySelectorAll("colgroup col")).map((c) => (c as HTMLElement).style.width)
      // selection, Name (flex: no width), Size (the saved 160), Duration, Resolution, Import; no filler (Name is flex)
      expect(widths).toEqual(["32px", "", "160px", "110px", "110px", "360px"])
    })
  })

  describe("imported rows", () => {
    async function importFirst(server: Server) {
      renderPage()
      await screen.findByText("clip-003.mp4")
      fireEvent.click(rowButton("clip-003.mp4"))
      await waitFor(() => expect(rowButton("clip-003.mp4")).toHaveTextContent("Imported"))
      expect(server.posts).toHaveLength(1)
    }

    it("are dimmed, kept, with a disabled checkbox and a disabled button", async () => {
      await importFirst(serve(many(6)))
      expect(row("clip-003.mp4")).toHaveClass("opacity-50")
      expect(row("clip-004.mp4")).not.toHaveClass("opacity-50")
      expect(within(row("clip-003.mp4")).getByRole("checkbox")).toBeDisabled()
      expect(rowButton("clip-003.mp4")).toBeDisabled()
      expect(urlBox("clip-003.mp4")).toBeDisabled()
      expect(row("clip-003.mp4").querySelector("td[data-col=name] button")).toBeNull()
      expect(screen.getByText("6 files")).toBeInTheDocument()
    })

    it("are skipped by a click, ctrl click, shift range, drag and select-all", async () => {
      const user = userEvent.setup()
      await importFirst(serve(many(6)))
      press("clip-003.mp4")
      press("clip-003.mp4", { ctrlKey: true })
      expect(isSelected("clip-003.mp4")).toBe(false)
      expect(screen.queryByText(/selected/)).toBeNull()

      press("clip-001.mp4")
      press("clip-005.mp4", { shiftKey: true })
      expect(["clip-001.mp4", "clip-002.mp4", "clip-003.mp4", "clip-004.mp4", "clip-005.mp4"].map(isSelected)).toEqual([true, true, false, true, true])
      expect(screen.getByText("6 files · 4 selected")).toBeInTheDocument()

      fireEvent.mouseDown(row("clip-001.mp4")) // drag from 1 across 3 to 5
      for (const n of ["clip-002.mp4", "clip-003.mp4", "clip-004.mp4", "clip-005.mp4"]) fireEvent.mouseEnter(row(n))
      fireEvent.mouseUp(window)
      expect(["clip-001.mp4", "clip-002.mp4", "clip-003.mp4", "clip-004.mp4", "clip-005.mp4", "clip-006.mp4"].map(isSelected)).toEqual([true, true, false, true, true, false])

      await user.click(screen.getByRole("checkbox", { name: "Select all" }))
      expect(screen.getByText("6 files · 5 selected")).toBeInTheDocument()
      expect(isSelected("clip-003.mp4")).toBe(false)
      expect(screen.getByRole("checkbox", { name: "Select all" })).toBeChecked()
    })
  })

  describe("importing", () => {
    it("imports one file: Importing…, the success toast and Imported, with no confirmation", async () => {
      const server = serve(many(3))
      server.holdPosts()
      renderPage()
      await screen.findByText("clip-001.mp4")
      fireEvent.click(rowButton("clip-002.mp4"))
      expect(rowButton("clip-002.mp4")).toHaveTextContent("Importing…")
      expect(rowButton("clip-002.mp4")).toBeDisabled()
      expect(rowButton("clip-001.mp4")).toHaveTextContent("Import")
      expect(screen.queryByRole("alertdialog")).toBeNull()
      server.releasePosts()
      await waitFor(() => expect(rowButton("clip-002.mp4")).toHaveTextContent("Imported"))
      expect(toasts.success).toHaveBeenCalledWith("Imported clip-002.mp4")
      expect(server.posts).toEqual([{ path: "clip-002.mp4" }])
      expect(rowButton("clip-002.mp4")).toBeDisabled()
    })

    it("a failure shows the error toast and leaves the button usable", async () => {
      const server = serve(many(3))
      server.failPaths.add("clip-002.mp4")
      renderPage()
      await screen.findByText("clip-001.mp4")
      fireEvent.click(rowButton("clip-002.mp4"))
      await waitFor(() => expect(toasts.error).toHaveBeenCalledWith("Failed to import clip-002.mp4: disk full"))
      expect(rowButton("clip-002.mp4")).toHaveTextContent("Import")
      expect(rowButton("clip-002.mp4")).toBeEnabled()
      expect(toasts.success).not.toHaveBeenCalled()
      expect(row("clip-002.mp4")).not.toHaveClass("opacity-50")
    })

    it("Import Selected asks first, shows the count and imports only the selected files", async () => {
      const server = serve(many(5))
      renderPage()
      await screen.findByText("clip-001.mp4")
      press("clip-002.mp4")
      press("clip-004.mp4", { ctrlKey: true })
      fireEvent.click(toolbarButton("Import Selected"))
      const dialog = await screen.findByRole("alertdialog")
      expect(within(dialog).getByText("Import 2 files?")).toBeInTheDocument()
      expect(within(dialog).getByText("Adds the selected files to your library.")).toBeInTheDocument()
      expect(server.posts).toHaveLength(0)
      fireEvent.click(within(dialog).getByRole("button", { name: "Import" }))
      await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("2 files imported"))
      expect(server.posts.map((p) => p.path).sort()).toEqual(["clip-002.mp4", "clip-004.mp4"])
      expect(rowButton("clip-002.mp4")).toHaveTextContent("Imported")
      expect(rowButton("clip-004.mp4")).toHaveTextContent("Imported")
      expect(rowButton("clip-001.mp4")).toHaveTextContent("Import")
      // The imported files left the selection.
      expect(screen.queryByText(/selected/)).toBeNull()
      expect(toolbarButton("Import Selected")).toBeDisabled()
    })

    it("Import Selected can be cancelled", async () => {
      const server = serve(many(3))
      renderPage()
      await screen.findByText("clip-001.mp4")
      press("clip-001.mp4")
      fireEvent.click(toolbarButton("Import Selected"))
      fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }))
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
      expect(server.posts).toHaveLength(0)
      expect(isSelected("clip-001.mp4")).toBe(true)
    })

    it("Import All asks first, counts the pending files on every page and skips the imported ones", async () => {
      const server = serve(many(60))
      renderPage()
      await screen.findByText("clip-001.mp4")
      fireEvent.click(rowButton("clip-001.mp4"))
      await waitFor(() => expect(rowButton("clip-001.mp4")).toHaveTextContent("Imported"))
      server.posts.length = 0

      fireEvent.click(toolbarButton("Import All"))
      const dialog = await screen.findByRole("alertdialog")
      expect(within(dialog).getByText("Import 59 files?")).toBeInTheDocument()
      expect(within(dialog).getByText("Adds every pending file to your library.")).toBeInTheDocument()
      fireEvent.click(within(dialog).getByRole("button", { name: "Import" }))
      await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("59 files imported"))
      expect(server.posts).toHaveLength(59)
      expect(toolbarButton("Import All")).toBeDisabled()
    })

    it("a partly failed bulk import reports both counts, and only the failed file stays importable", async () => {
      const server = serve(many(3))
      server.failPaths.add("clip-002.mp4")
      renderPage()
      await screen.findByText("clip-001.mp4")
      fireEvent.click(toolbarButton("Import All"))
      fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Import" }))
      await waitFor(() => expect(toasts.error).toHaveBeenCalledWith("2 imported, 1 failed"))
      expect(rowButton("clip-002.mp4")).toBeEnabled()
      expect(rowButton("clip-001.mp4")).toHaveTextContent("Imported")
      expect(toolbarButton("Import All")).toBeEnabled()
    })

    it("importing one selected file removes just it from the selection", async () => {
      serve(many(5))
      renderPage()
      await screen.findByText("clip-001.mp4")
      press("clip-001.mp4")
      press("clip-003.mp4", { shiftKey: true })
      expect(screen.getByText("5 files · 3 selected")).toBeInTheDocument()
      fireEvent.click(rowButton("clip-002.mp4"))
      await waitFor(() => expect(screen.getByText("5 files · 2 selected")).toBeInTheDocument())
      expect(isSelected("clip-001.mp4")).toBe(true)
      expect(isSelected("clip-002.mp4")).toBe(false)
      expect(isSelected("clip-003.mp4")).toBe(true)
    })
  })

  describe("the Original URL inputs", () => {
    it("typing re-renders that input only: no other input, no row, not the page", async () => {
      const user = userEvent.setup()
      serve(many(30))
      renderPage()
      await screen.findByText("clip-001.mp4")
      const box = urlBox("clip-005.mp4")
      await user.click(box)
      counters.page = 0
      counters.bytes = 0
      counters.inputs = {}
      await user.type(box, "https://x.test/abc")
      expect(box).toHaveValue("https://x.test/abc")
      expect(counters.inputs["Original URL for clip-005.mp4"]).toBe("https://x.test/abc".length)
      expect(Object.keys(counters.inputs)).toEqual(["Original URL for clip-005.mp4"])
      expect(counters.bytes).toBe(0) // no row's cells re-rendered
      expect(counters.page).toBe(0)
    })

    it("an import event re-renders the cells, typing afterwards still does not", async () => {
      const user = userEvent.setup()
      const server = serve(many(5))
      renderPage()
      await screen.findByText("clip-001.mp4")
      fireEvent.click(rowButton("clip-001.mp4"))
      await waitFor(() => expect(rowButton("clip-001.mp4")).toHaveTextContent("Imported"))
      expect(server.posts).toHaveLength(1)
      counters.page = 0
      counters.bytes = 0
      await user.type(urlBox("clip-002.mp4"), "abc")
      expect(counters.bytes).toBe(0)
      expect(counters.page).toBe(0)
    })

    it("keeps what was typed through paging and sorting, and sends it, trimmed, with the import", async () => {
      const user = userEvent.setup()
      const server = serve(many(120))
      renderPage()
      await screen.findByText("clip-001.mp4")
      await user.type(urlBox("clip-002.mp4"), "  https://x.test/two  ")
      await user.type(urlBox("clip-003.mp4"), "https://x.test/three")

      fireEvent.click(screen.getByRole("button", { name: "2" }))
      expect(screen.queryByLabelText("Original URL for clip-002.mp4")).toBeNull()
      fireEvent.click(screen.getByRole("button", { name: "1" }))
      expect(urlBox("clip-002.mp4")).toHaveValue("  https://x.test/two  ")

      sortBy("Size")
      sortBy("Size") // descending: the first page is now the biggest files
      expect(screen.queryByLabelText("Original URL for clip-002.mp4")).toBeNull()
      sortBy("Size") // back to the scan order
      expect(urlBox("clip-003.mp4")).toHaveValue("https://x.test/three")

      fireEvent.click(rowButton("clip-002.mp4"))
      await waitFor(() => expect(server.posts).toHaveLength(1))
      expect(server.posts[0]).toEqual({ path: "clip-002.mp4", originalUrl: "https://x.test/two" })
      fireEvent.click(rowButton("clip-004.mp4"))
      await waitFor(() => expect(server.posts).toHaveLength(2))
      expect(server.posts[1]).toEqual({ path: "clip-004.mp4" }) // nothing typed: no originalUrl
    })

    it("a bulk import sends each file's own URL", async () => {
      const user = userEvent.setup()
      const server = serve(many(3))
      renderPage()
      await screen.findByText("clip-001.mp4")
      await user.type(urlBox("clip-001.mp4"), "https://x.test/one")
      fireEvent.click(toolbarButton("Import All"))
      fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Import" }))
      await waitFor(() => expect(server.posts).toHaveLength(3))
      const byPath = Object.fromEntries(server.posts.map((p) => [p.path, p.originalUrl]))
      expect(byPath).toEqual({ "clip-001.mp4": "https://x.test/one", "clip-002.mp4": undefined, "clip-003.mp4": undefined })
    })

    it("pressing the input, the Import button or the ignore button does not select the row", async () => {
      const user = userEvent.setup()
      const server = serve([file(1, { path: "Shows/a.mp4", filename: "a.mp4", collectionPath: "Shows" })])
      renderPage()
      await screen.findByText("a.mp4")
      fireEvent.mouseDown(urlBox("a.mp4"))
      fireEvent.mouseUp(window)
      expect(isSelected("a.mp4")).toBe(false)
      await user.click(urlBox("a.mp4"))
      expect(isSelected("a.mp4")).toBe(false)

      const ignore = row("a.mp4").querySelector("td[data-col=name] button")!
      fireEvent.mouseDown(ignore)
      fireEvent.mouseUp(window)
      expect(isSelected("a.mp4")).toBe(false)
      await user.click(ignore)
      await waitFor(() => expect(server.patches).toEqual([{ importIgnoredFolders: ["Shows"] }]))
      expect(isSelected("a.mp4")).toBe(false)

      fireEvent.mouseDown(rowButton("a.mp4"))
      fireEvent.mouseUp(window)
      expect(isSelected("a.mp4")).toBe(false)
    })
  })

  it("Rescan keeps the table while it scans and spins its icon meanwhile", async () => {
    const server = serve(many(3))
    renderPage()
    await screen.findByText("clip-001.mp4")
    const rescan = toolbarButton("Rescan")
    expect(rescan.querySelector("svg")).not.toHaveClass("animate-spin")
    server.holdScans()
    fireEvent.click(rescan)
    await waitFor(() => expect(rescan.querySelector("svg")).toHaveClass("animate-spin"))
    expect(rescan).toBeDisabled()
    expect(screen.getByText("clip-001.mp4")).toBeInTheDocument()
    expect(document.querySelector("[data-slot=skeleton]")).toBeNull()
    server.releaseScan()
    await waitFor(() => expect(rescan.querySelector("svg")).not.toHaveClass("animate-spin"))
    expect(server.scans()).toBe(2)
  })

  it("the Ignored Folders dialog opens from the toolbar, before the search", async () => {
    serve(many(2))
    renderPage()
    await screen.findByText("clip-001.mp4")
    const trigger = toolbarButton("Ignored Folders")
    const search = screen.getByPlaceholderText("Search files…")
    expect(trigger.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(trigger)
    expect(await screen.findByRole("dialog", { name: "Ignored Folders" })).toBeInTheDocument()
  })
})

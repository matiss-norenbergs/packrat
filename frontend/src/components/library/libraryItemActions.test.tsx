import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mockFetch } from "@/test/mockApi"
import type { LibraryItem } from "@/types/api"
import { toContextMenuItems, useLibraryItemActions, type LibraryItemAction } from "./libraryItemActions"

beforeEach(() => {
  mockFetch((url) => {
    if (url.endsWith("/settings")) return { status: 200, body: { thumbnailEnhancementEnabled: true, featureCompareListEnabled: true, featureFrameMatchingEnabled: true } }
    if (url.includes("compare")) return { status: 200, body: [] }
    return { status: 200, body: {} }
  })
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const base = { id: 1, title: "T", filename: "a.mp4", path: "m/a.mp4", mediaType: "video", status: "complete", originalUrl: "https://x/y", thumbnail: "t.jpg", generateNfo: true, nfoExists: true, tags: [] }
const make = (over: Partial<LibraryItem> = {}) => ({ ...base, ...over }) as LibraryItem

function actions(item: LibraryItem) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
  )
  return renderHook(() => useLibraryItemActions(item), { wrapper }).result.current.actionsFor(item)
}
const tree = (list: LibraryItemAction[]): unknown[] =>
  list.map((a) => ("separator" in a ? "---" : "items" in a ? [a.label, tree(a.items)] : a.label + (a.disabled ? " (disabled)" : "") + (a.destructive ? " (destructive)" : "")))

describe("library item actions", () => {
  it("lists the actions of a downloaded video in the dropdown's order, with submenus and separators", async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useLibraryItemActions(make()), { wrapper })
    const labels = tree(result.current.actionsFor(make()))
    expect(labels.slice(0, 3)).toEqual(["Edit", "Move", "Trim…"])
    expect(labels).toContain("---")
    expect(labels.at(-2)).toBe("Delete file… (destructive)")
    expect(labels.at(-1)).toBe("Delete (destructive)")
    expect(labels).toContainEqual(["Metadata", ["Compare", "Refresh"]])
    expect(labels).toContainEqual(["Redownload", ["From Current URL", "From Different URL…"]])
  })

  describe("NFO › View Contents", () => {
    const viewEntry = (it: LibraryItem) => {
      const nfo = actions(it).find((a) => "items" in a && a.key === "nfo")
      const entry = nfo && "items" in nfo ? nfo.items.find((i) => i.key === "nfo-view") : undefined
      return entry && "disabled" in entry ? entry : undefined
    }

    // List responses only check the disk for items with Generate NFO on, so nfoExists=false is
    // "missing" only there; with the flag off it is "not checked" and the entry must stay usable.
    it("is disabled only when Generate NFO is on and the file is missing", () => {
      expect(viewEntry(make({ generateNfo: true, nfoExists: false }))?.disabled).toBe(true)
      expect(viewEntry(make({ generateNfo: true, nfoExists: true }))?.disabled).toBeFalsy()
      expect(viewEntry(make({ generateNfo: false, nfoExists: false }))?.disabled).toBeFalsy()
      expect(viewEntry(make({ generateNfo: false, nfoExists: true }))?.disabled).toBeFalsy()
    })
  })

  it("relabels Redownload for a ghost and hides the file-dependent actions", () => {
    const list = tree(actions(make({ status: "ghost" })))
    expect(list).not.toContain("Move")
    expect(list).not.toContain("Trim…")
    expect(list).not.toContain("Delete file… (destructive)")
    expect(list).toContainEqual(["Redownload", ["Download now", "From Different URL…"]])
  })

  describe("while a download is in progress for the item", () => {
    const only = ["Copy URL", ["Metadata", ["Compare"]], "---", "Delete (destructive)"]

    it("offers only Copy URL, the read-only compare and Delete — everything else is hidden, not disabled", () => {
      for (const status of ["ghost", "completed"]) {
        const list = tree(actions(make({ status, activeDownloadId: 7 })))
        expect(list).toEqual(only)
        const flat = JSON.stringify(list)
        for (const hidden of ["Edit", "Move", "Trim", "Redownload", "Download now", "From Current URL", "NFO", "Thumbnail", "Match", "Refresh", "Delete file", "compare list"]) {
          expect(flat).not.toContain(hidden)
        }
        expect(flat).not.toContain("(disabled)")
      }
    })

    it("has no dangling separator at either end, in the menu or a submenu", () => {
      const walk = (list: unknown[]) => {
        expect(list[0]).not.toBe("---")
        expect(list.at(-1)).not.toBe("---")
        list.forEach((e, i) => {
          if (e === "---") expect(list[i - 1]).not.toBe("---")
          if (Array.isArray(e)) walk(e[1] as unknown[])
        })
      }
      walk(tree(actions(make({ activeDownloadId: 7 }))))
      walk(tree(actions(make({ status: "ghost" }))))
      walk(tree(actions(make({ mediaType: "image", status: "ghost" }))))
    })

    it("converts to the same short context menu for the list view", () => {
      const items = toContextMenuItems(actions(make({ activeDownloadId: 7 })))
      expect(items.map((i) => i.key)).toEqual(["copy-url", "metadata", "sep-1", "delete"])
      expect(items.map((i) => ("items" in i ? i.items.map((x) => x.key) : null))).toEqual([null, ["metadata-compare"], null, null])
    })

    it("restores the full menu once the download is gone", () => {
      const list = tree(actions(make({ status: "ghost", activeDownloadId: null })))
      expect(list.length).toBeGreaterThan(only.length)
      expect(list).toContainEqual(["Redownload", ["Download now", "From Different URL…"]])
      expect(list[0]).toBe("Edit")
    })
  })

  it("disables the URL-dependent actions when there is no source URL", () => {
    const list = tree(actions(make({ originalUrl: "" })))
    expect(list).toContain("Copy URL (disabled)")
    expect(list).toContainEqual(["Metadata", ["Compare (disabled)", "Refresh (disabled)"]])
  })

  it("hides Trim for an image and the frame-grab thumbnail actions for audio", () => {
    expect(tree(actions(make({ mediaType: "image", filename: "a.png" })))).not.toContain("Trim…")
    const thumb = (tree(actions(make({ filename: "a.mp3" }))) as [string, unknown][]).find((e) => Array.isArray(e) && e[0] === "Thumbnail")![1] as string[]
    expect(thumb).not.toContain("Quick Grab")
    expect(thumb).toContain("Redownload from URL")
  })

  it("hides Redownload from URL and Delete in the Thumbnail submenu for an image, but not for a video", () => {
    const thumbOf = (item: LibraryItem) =>
      (tree(actions(item)) as [string, unknown][]).find((e) => Array.isArray(e) && e[0] === "Thumbnail")![1] as string[]
    const image = thumbOf(make({ mediaType: "image", filename: "a.png" }))
    expect(image).not.toContain("Redownload from URL")
    expect(image).not.toContain("Delete (destructive)")
    expect(image).toContain("Save in Thumbnail Gallery")
    expect(image).toContain("View Gallery…")
    expect(image[0]).not.toBe("---")
    expect(image.at(-1)).not.toBe("---")
    image.forEach((e, i) => e === "---" && expect(image[i - 1]).not.toBe("---"))

    const video = thumbOf(make())
    expect(video).toContain("Redownload from URL")
    expect(video).toContain("Delete (destructive)")
  })

  it("converts to context menu items with the same keys, submenus, separators and flags", () => {
    const defs = toContextMenuItems(actions(make()))
    const sub = defs.find((d) => d.key === "metadata")
    expect(sub && "items" in sub && sub.items.map((i) => i.key)).toEqual(["metadata-compare", "metadata-refresh"])
    expect(defs.some((d) => "separator" in d)).toBe(true)
    const del = defs.at(-1)
    expect(del && "onSelect" in del && del.destructive).toBe(true)
  })
})

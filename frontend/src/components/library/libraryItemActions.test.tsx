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

  it("relabels Redownload for a ghost and hides the file-dependent actions", () => {
    const list = tree(actions(make({ status: "ghost" })))
    expect(list).not.toContain("Move")
    expect(list).not.toContain("Trim…")
    expect(list).not.toContain("Delete file… (destructive)")
    expect(list).toContainEqual(["Redownload", ["Download now", "From Different URL…"]])
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

  it("converts to context menu items with the same keys, submenus, separators and flags", () => {
    const defs = toContextMenuItems(actions(make()))
    const sub = defs.find((d) => d.key === "metadata")
    expect(sub && "items" in sub && sub.items.map((i) => i.key)).toEqual(["metadata-compare", "metadata-refresh"])
    expect(defs.some((d) => "separator" in d)).toBe(true)
    const del = defs.at(-1)
    expect(del && "onSelect" in del && del.destructive).toBe(true)
  })
})

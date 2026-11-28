import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { toast } from "sonner"
import { notifyCollectionRestore } from "@/lib/backupCollections"
import type { BackupImportLibraryResult, LibraryImportPreview } from "@/types/api"
import { CollectionRestoreNotices } from "./CollectionRestoreNotices"
import { PreviewItemList } from "./PreviewItemList"

vi.mock("sonner", () => ({ toast: { info: vi.fn(), warning: vi.fn(), success: vi.fn(), error: vi.fn() } }))


const cleanResult: BackupImportLibraryResult = {
  collectionsEnsured: 2,
  tagsCreated: 0,
  artistsCreated: 0,
  downloadsQueued: 1,
  ghostsCreated: 0,
}

const preview = (over: Partial<LibraryImportPreview> = {}): LibraryImportPreview => ({
  collections: [],
  collectionsNew: 0,
  tags: [],
  tagsNew: 0,
  artists: [],
  artistsNew: 0,
  items: [],
  alreadyInLibrary: 0,
  ...over,
})

describe("CollectionRestoreNotices", () => {
  it("renders nothing for a clean restore", () => {
    const { container } = render(<CollectionRestoreNotices matchedByNameCount={0} unresolved={[]} nameKept={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("shows an info line with the renamed collections", () => {
    render(
      <CollectionRestoreNotices
        matchedByNameCount={1}
        matched={[{ path: ["concerts"], name: "Concerts", existingPath: ["live"] }]}
      />,
    )
    const info = screen.getByTestId("matched-by-name")
    expect(info).toHaveTextContent("1 collection will use an existing collection")
    expect(info).toHaveTextContent("concerts → live")
    expect(screen.queryByTestId("unresolved-collections")).not.toBeInTheDocument()
  })

  it("lists unresolved collections in a warning that uses the warning tokens", () => {
    render(
      <CollectionRestoreNotices
        unresolved={[{ path: ["Shows", "Anime"], reason: "the name \"Shows\" is already used", items: 3 }]}
      />,
    )
    const warning = screen.getByRole("alert")
    expect(warning).toHaveTextContent("1 collection can't be restored")
    expect(warning).toHaveTextContent('Shows / Anime: the name "Shows" is already used (3 items uncategorized)')
    expect(warning.className).toContain("bg-warning/10")
    expect(screen.getByText("1 collection can't be restored")).toHaveAttribute("data-variant", "warning")
  })

  it("reports a name kept after a clash", () => {
    render(<CollectionRestoreNotices nameKept={[{ path: ["b"], wantedName: "Same", keptName: "b" }]} />)
    expect(screen.getByTestId("name-kept")).toHaveTextContent("Same → b")
  })
})

describe("PreviewItemList collection notices", () => {
  it("shows the matched-by-name line from the preview's per-entry flags", () => {
    render(
      <PreviewItemList
        mode="download"
        preview={preview({
          collections: [{ path: ["concerts"], name: "Concerts", isNew: false, matchedByName: true, existingPath: ["live"] }],
          collectionsMatchedByName: 1,
        })}
      />,
    )
    expect(screen.getByTestId("matched-by-name")).toHaveTextContent("concerts → live")
  })

  it("does not render notices for a preview from an older server (no new fields)", () => {
    render(<PreviewItemList mode="download" preview={preview({ collections: [{ path: ["a"], name: "A", isNew: true }], collectionsNew: 1 })} />)
    expect(screen.queryByTestId("matched-by-name")).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.getByText(/1 new/)).toBeInTheDocument()
  })

  it("shows the unresolved warning", () => {
    render(
      <PreviewItemList
        mode="ghostOnly"
        preview={preview({ unresolvedCollections: [{ path: ["Dup"], reason: "name already used", items: 2 }] })}
      />,
    )
    expect(screen.getByRole("alert")).toHaveTextContent("Dup: name already used (2 items uncategorized)")
  })
})

describe("notifyCollectionRestore", () => {
  beforeEach(() => vi.clearAllMocks())

  it("is silent for a clean result and for one from an older server", () => {
    notifyCollectionRestore(cleanResult)
    notifyCollectionRestore({ ...cleanResult, matchedByName: null, unresolvedCollections: null })
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it("shows an info toast for collections matched by name", () => {
    notifyCollectionRestore({
      ...cleanResult,
      collectionsMatchedByName: 1,
      matchedByName: [{ path: ["concerts"], name: "Concerts", existingPath: ["live"] }],
    })
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("1 collection matched by name"), {
      description: "concerts → live",
    })
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it("shows a warning toast listing unresolved collections", () => {
    notifyCollectionRestore({
      ...cleanResult,
      unresolvedCollections: [{ path: ["Dup"], reason: "name already used", items: 2 }],
    })
    expect(toast.warning).toHaveBeenCalledWith(
      "1 collection could not be restored",
      expect.objectContaining({ description: "Dup: name already used (2 items uncategorized)" }),
    )
  })
})

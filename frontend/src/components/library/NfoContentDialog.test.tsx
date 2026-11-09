import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { mockFetch } from "@/test/mockApi"
import type { LibraryItem } from "@/types/api"
import { NfoContentDialog } from "./NfoContentDialog"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const item = { id: 7, title: "T", generateNfo: false, nfoExists: false } as LibraryItem

function renderDialog() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NfoContentDialog item={item} open onOpenChange={() => {}} />
    </QueryClientProvider>,
  )
}

describe("NfoContentDialog", () => {
  it("says there is no NFO file when the server answers 404", async () => {
    mockFetch(() => ({ status: 404, body: { error: "no .nfo file has been generated for this item" } }))
    renderDialog()
    expect(await screen.findByText("No NFO file for this item")).toBeTruthy()
  })

  it("shows the file contents when it exists", async () => {
    mockFetch(() => ({ status: 200, body: { content: "<movie><title>Hi</title></movie>" } }))
    renderDialog()
    expect(await screen.findByText(/<title>Hi<\/title>/)).toBeTruthy()
  })

  it("shows other errors with the server's message, not as a missing file", async () => {
    mockFetch(() => ({ status: 500, body: { error: "disk exploded" } }))
    renderDialog()
    expect(await screen.findByText("disk exploded")).toBeTruthy()
    expect(screen.queryByText("No NFO file for this item")).toBeNull()
  })
})

import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"
import { downloadPreviewQueryKey, downloadsQueryKey } from "./useDownloads"
import { libraryMetadataPreviewQueryKey, libraryQueryKey } from "./useLibrary"

// Previews run yt-dlp on the server, so the sockets' prefix invalidations must never reach them.
describe("preview query keys", () => {
  it("are not refetched by invalidating the downloads or library prefixes, but a normal library list is", async () => {
    const client = new QueryClient()
    const preview = vi.fn().mockResolvedValue("p")
    const metadata = vi.fn().mockResolvedValue("m")
    const list = vi.fn().mockResolvedValue("l")
    const observe = (queryKey: readonly unknown[], queryFn: () => Promise<string>) =>
      client.getQueryCache().build(client, { queryKey, queryFn }).fetch().then(() => {
        client.getQueryCache().find({ queryKey })!.addObserver({ onQueryUpdate() {}, options: { queryKey, queryFn }, getCurrentResult() {} } as never)
      })
    await observe(downloadPreviewQueryKey("https://x/y"), preview)
    await observe(libraryMetadataPreviewQueryKey(7), metadata)
    await observe([...libraryQueryKey, "query", {}], list)

    await client.invalidateQueries({ queryKey: downloadsQueryKey })
    await client.invalidateQueries({ queryKey: libraryQueryKey })

    expect(preview).toHaveBeenCalledTimes(1)
    expect(metadata).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledTimes(2)
  })
})

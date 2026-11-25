import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useSettings } from "@/hooks/useSettings"
import { useArtistNameMask } from "@/hooks/useArtistNameMask"
import { useTagNameMask } from "@/hooks/useTagNameMask"
import type { LibraryItem } from "@/types/api"
import { LibraryItemActionsProvider } from "./LibraryItemActionsProvider"

interface LibraryCardEnv {
  // Settings -> Library "details" card mode.
  detailsMode: boolean
  maskTag: ReturnType<typeof useTagNameMask>
  maskArtist: ReturnType<typeof useArtistNameMask>
}

const LibraryCardEnvContext = createContext<LibraryCardEnv | null>(null)

/** What every card needs that does not depend on its item, read once for the whole grid instead of once per card. */
export function useLibraryCardEnv(): LibraryCardEnv {
  const env = useContext(LibraryCardEnvContext)
  if (!env) throw new Error("LibraryCard must be rendered inside a LibraryCardsProvider")
  return env
}

/**
 * Everything the cards of the Library grid and the Folders view share: the one item-actions host and the
 * item-independent settings (card mode, the tag / artist privacy masks), so a card subscribes to no query itself and
 * stays memoizable. `items` are the cards currently rendered.
 */
export function LibraryCardsProvider({ items, children }: { items: readonly LibraryItem[] | undefined; children: ReactNode }) {
  const { data: settings } = useSettings()
  const maskTag = useTagNameMask()
  const maskArtist = useArtistNameMask()
  const detailsMode = settings?.libraryMode === "details"
  const env = useMemo(() => ({ detailsMode, maskTag, maskArtist }), [detailsMode, maskTag, maskArtist])
  return (
    <LibraryCardEnvContext.Provider value={env}>
      <LibraryItemActionsProvider items={items}>{children}</LibraryItemActionsProvider>
    </LibraryCardEnvContext.Provider>
  )
}

import { createContext, useContext, useState, type ReactNode } from "react"
import type { LibraryItem } from "@/types/api"

interface MiniPlayerState {
  item: LibraryItem
  startTime: number
  paused: boolean
}

interface MiniPlayerContextValue {
  miniPlayer: MiniPlayerState | null
  minimize: (item: LibraryItem, startTime: number, paused: boolean) => void
  close: () => void
}

const MiniPlayerContext = createContext<MiniPlayerContextValue | null>(null)

// Lets a playing item keep playing in a small floating dock while the user
// navigates back to browsing — YouTube-minimize style. Scoped to the Browse
// area only (provided by BrowseLayout): the management area has no
// equivalent, since "keep watching while you browse elsewhere" isn't its
// use case.
export function MiniPlayerProvider({ children }: { children: ReactNode }) {
  const [miniPlayer, setMiniPlayer] = useState<MiniPlayerState | null>(null)

  const minimize = (item: LibraryItem, startTime: number, paused: boolean) =>
    setMiniPlayer({ item, startTime, paused })
  const close = () => setMiniPlayer(null)

  return <MiniPlayerContext.Provider value={{ miniPlayer, minimize, close }}>{children}</MiniPlayerContext.Provider>
}

export function useMiniPlayer() {
  const ctx = useContext(MiniPlayerContext)
  if (!ctx) throw new Error("useMiniPlayer must be used within a MiniPlayerProvider")
  return ctx
}

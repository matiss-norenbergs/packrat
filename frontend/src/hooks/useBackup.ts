import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  exportLibraryBackup,
  exportSettingsBackup,
  importLibraryBackup,
  importSettingsBackup,
} from "@/lib/api"
import { downloadJson } from "@/lib/utils"
import { artistsQueryKey } from "./useArtists"
import { collectionsQueryKey } from "./useCollections"
import { downloadsQueryKey } from "./useDownloads"
import { libraryQueryKey } from "./useLibrary"
import { settingsQueryKey } from "./useSettings"
import { tagsQueryKey } from "./useTags"

function timestampedFilename(prefix: string): string {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}.json`
}

export function useExportSettings() {
  return useMutation({
    mutationFn: (password: string) => exportSettingsBackup(password),
    onSuccess: (envelope) => {
      downloadJson(timestampedFilename("packrat-settings"), envelope)
      toast.success("Settings exported")
    },
    onError: (err: Error) => {
      toast.error(`Export failed: ${err.message}`)
    },
  })
}

export function useExportLibrary() {
  return useMutation({
    mutationFn: (password: string) => exportLibraryBackup(password),
    onSuccess: (envelope) => {
      downloadJson(timestampedFilename("packrat-library"), envelope)
      toast.success("Library data exported")
    },
    onError: (err: Error) => {
      toast.error(`Export failed: ${err.message}`)
    },
  })
}

export function useImportSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ data, password }: { data: string; password: string }) => importSettingsBackup(data, password),
    onSuccess: (result) => {
      toast.success(`Imported ${result.applied} setting${result.applied === 1 ? "" : "s"}`)
      queryClient.invalidateQueries({ queryKey: settingsQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Import failed: ${err.message}`)
    },
  })
}

export function useImportLibrary() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ data, password }: { data: string; password: string }) => importLibraryBackup(data, password),
    onSuccess: (result) => {
      toast.success(
        `Queued ${result.downloadsQueued} download${result.downloadsQueued === 1 ? "" : "s"} — ` +
          `${result.collectionsEnsured} collection${result.collectionsEnsured === 1 ? "" : "s"}, ` +
          `${result.tagsCreated} new tag${result.tagsCreated === 1 ? "" : "s"}, ` +
          `${result.artistsCreated} new artist${result.artistsCreated === 1 ? "" : "s"}`,
      )
      queryClient.invalidateQueries({ queryKey: collectionsQueryKey })
      queryClient.invalidateQueries({ queryKey: tagsQueryKey })
      queryClient.invalidateQueries({ queryKey: artistsQueryKey })
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
      queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Import failed: ${err.message}`)
    },
  })
}

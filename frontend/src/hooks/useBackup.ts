import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  deleteBackupHistoryEntry,
  exportLibraryBackup,
  exportSettingsBackup,
  fetchBackupHistory,
  fetchBackupPreview,
  importFullBackup,
  importLibraryBackup,
  importSettingsBackup,
  previewFullImport,
  previewLibraryImport,
  restoreFullBackup,
  runManualBackup,
} from "@/lib/api"
import { downloadJson } from "@/lib/utils"
import type { LibraryImportMode } from "@/types/api"
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

export function useLibraryImportPreview() {
  return useMutation({
    mutationFn: ({ data, password }: { data: string; password: string }) => previewLibraryImport(data, password),
    onError: (err: Error) => {
      toast.error(`Preview failed: ${err.message}`)
    },
  })
}

export function useImportLibrary() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ data, password, mode }: { data: string; password: string; mode?: LibraryImportMode }) =>
      importLibraryBackup(data, password, mode),
    onSuccess: (result) => {
      toast.success(
        `Queued ${result.downloadsQueued} download${result.downloadsQueued === 1 ? "" : "s"}` +
          (result.ghostsCreated > 0 ? `, restored ${result.ghostsCreated} ghost item${result.ghostsCreated === 1 ? "" : "s"}` : "") +
          ` — ${result.collectionsEnsured} collection${result.collectionsEnsured === 1 ? "" : "s"}, ` +
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

export const backupHistoryQueryKey = ["backup-history"] as const

export function useBackupHistory() {
  return useQuery({ queryKey: backupHistoryQueryKey, queryFn: fetchBackupHistory })
}

export function useRunManualBackup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: runManualBackup,
    onSuccess: (entry) => {
      queryClient.invalidateQueries({ queryKey: backupHistoryQueryKey })
      if (entry.status === "success") {
        toast.success("Backup completed")
      } else {
        toast.error(`Backup failed: ${entry.errorMessage ?? "unknown error"}`)
      }
    },
    onError: (err: Error) => {
      toast.error(`Backup failed: ${err.message}`)
    },
  })
}

export function useDeleteBackupHistoryEntry() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteBackupHistoryEntry,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: backupHistoryQueryKey })
      toast.success("Backup deleted")
    },
    onError: (err: Error) => {
      toast.error(`Delete failed: ${err.message}`)
    },
  })
}

export function useBackupPreview(id: number | null) {
  return useQuery({
    queryKey: ["backup-preview", id],
    queryFn: () => fetchBackupPreview(id as number),
    enabled: id != null,
  })
}

export function useFullImportPreview() {
  return useMutation({
    mutationFn: ({ data, password }: { data: string; password: string }) => previewFullImport(data, password),
    onError: (err: Error) => {
      toast.error(`Preview failed: ${err.message}`)
    },
  })
}

export function useImportFullBackup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ data, password, mode }: { data: string; password: string; mode: LibraryImportMode }) =>
      importFullBackup(data, password, mode),
    onSuccess: (result) => {
      toast.success(
        `Restored ${result.settingsApplied} setting${result.settingsApplied === 1 ? "" : "s"}, ` +
          `queued ${result.library.downloadsQueued} download${result.library.downloadsQueued === 1 ? "" : "s"}` +
          (result.library.ghostsCreated > 0
            ? `, restored ${result.library.ghostsCreated} ghost item${result.library.ghostsCreated === 1 ? "" : "s"}`
            : ""),
      )
      queryClient.invalidateQueries({ queryKey: settingsQueryKey })
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

export function useRestoreFullBackup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, mode }: { id: number; mode: LibraryImportMode }) => restoreFullBackup(id, mode),
    onSuccess: (result) => {
      toast.success(
        `Restored ${result.settingsApplied} setting${result.settingsApplied === 1 ? "" : "s"}, ` +
          `queued ${result.library.downloadsQueued} download${result.library.downloadsQueued === 1 ? "" : "s"}` +
          (result.library.ghostsCreated > 0
            ? `, restored ${result.library.ghostsCreated} ghost item${result.library.ghostsCreated === 1 ? "" : "s"}`
            : ""),
      )
      queryClient.invalidateQueries({ queryKey: settingsQueryKey })
      queryClient.invalidateQueries({ queryKey: collectionsQueryKey })
      queryClient.invalidateQueries({ queryKey: tagsQueryKey })
      queryClient.invalidateQueries({ queryKey: artistsQueryKey })
      queryClient.invalidateQueries({ queryKey: libraryQueryKey })
      queryClient.invalidateQueries({ queryKey: downloadsQueryKey })
    },
    onError: (err: Error) => {
      toast.error(`Restore failed: ${err.message}`)
    },
  })
}
